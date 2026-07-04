import { AppConfig, GmgnSignal, GmgnTrending, GmgnKline, GmgnTokenInfo, GmgnTokenSecurity, AlertSignal, SignalSource } from './types';
import {
  getSignalBuys,
  getMarketKline,
  getTokenInfo,
  getTokenSecurity,
  getTokenFeesSol,
  setConcurrencyLimit,
  RateLimitError,
} from './adapters/gmgn';
import { discoverPools } from './adapters/meteora';
import { calculateSuperTrend, validateSuperTrendSignal } from './indicators/supertrend';
import { calculateStochRSI, validateStochRSISignal } from './indicators/stochrsi';
import { calculateAllEMAs, validateEMASignal } from './indicators/ema';
import { checkTokenAge, buildAlertFromTrending } from './filters';
import { Alerter } from './alerter';

// ─── Price change from klines ───────────────────────────────────────────────

/**
 * Calculate price change percentage over `minutes` using kline data.
 * GMGN kline timestamp is in milliseconds.
 */
function calcPriceChange(klines: GmgnKline[], minutes: number): number {
  if (klines.length < 2) return 0;
  const cutoff = Date.now() - minutes * 60 * 1000;
  let past = klines[0];
  for (const k of klines) {
    if (k.time <= cutoff) past = k;
    else break;
  }
  const cur = klines[klines.length - 1].close;
  const prev = past.close;
  if (!prev) return 0;
  return ((cur - prev) / prev) * 100;
}

// ─── Shared cooldown map ────────────────────────────────────────────────────

/** Mint address (lowercase) → cooldown expiry timestamp (ms) */
const cooldownMap = new Map<string, number>();

function isOnCooldown(mint: string): boolean {
  const expiry = cooldownMap.get(mint.toLowerCase());
  if (!expiry) return false;
  if (Date.now() > expiry) {
    cooldownMap.delete(mint.toLowerCase());
    return false;
  }
  return true;
}

function setCooldown(mint: string, minutes: number): void {
  cooldownMap.set(mint.toLowerCase(), Date.now() + minutes * 60 * 1000);
}

// ─── Token enrichment (concurrent-safe) ─────────────────────────────────────

interface EnrichedToken {
  trending: GmgnTrending;
  info: GmgnTokenInfo | null;
  security: GmgnTokenSecurity | null;
  klines: GmgnKline[];
  priceChange5m: number;
  priceChange1h: number;
  vsAthPct: number;
}

async function enrichToken(trending: GmgnTrending): Promise<EnrichedToken> {
  const [info, security, klines] = await Promise.all([
    getTokenInfo(trending.address),
    getTokenSecurity(trending.address),
    getMarketKline(trending.address, '5m', 200),
  ]);

  const priceChange5m = calcPriceChange(klines, 5);
  const priceChange1h = calcPriceChange(klines, 60);

  let vsAthPct = 0;
  if (info?.ath_price && info?.price?.price) {
    vsAthPct = (1 - info.price.price / info.ath_price) * 100;
  }

  return { trending, info, security, klines, priceChange5m, priceChange1h, vsAthPct };
}

// ─── Check indicators on enriched token (multi-timeframe) ────────────────────

interface IndicatorCheck {
  signal: AlertSignal;
  passed: boolean;
  reason: string;
  timeframe: string;
}

const TIMEFRAMES = ['5m', '15m', '1h', '4h'];

async function checkIndicatorsMultiTF(
  mint: string,
  trendingData: { symbol: string; trending: GmgnTrending; info: GmgnTokenInfo | null; security: GmgnTokenSecurity | null; priceChange5m: number; priceChange1h: number; vsAthPct: number },
  cfg: AppConfig,
  feeSol?: number
): Promise<IndicatorCheck> {
  // Try each timeframe until one passes
  for (const tf of TIMEFRAMES) {
    let klines: GmgnKline[];
    try {
      klines = await getMarketKline(mint, tf, 200);
    } catch {
      console.log(`[SCAN] ${trendingData.symbol} failed to fetch ${tf} klines, skipping`);
      continue;
    }
    if (klines.length < 15) continue;

    // StochRSI - required for both paths
    const sr = calculateStochRSI(
      klines,
      cfg.stochrsi.period,
      cfg.stochrsi.kPeriod,
      cfg.stochrsi.dPeriod,
      cfg.stochrsi.smoothK
    );

    if (!validateStochRSISignal(sr)) continue;

    // SuperTrend check
    const st = calculateSuperTrend(klines, cfg.supertrend.period, cfg.supertrend.multiplier);
    const stValid = validateSuperTrendSignal(st);

    // EMA check (alternative to SuperTrend)
    const ema = calculateAllEMAs(klines);
    const emaValid = validateEMASignal(ema);

    // OR logic: SuperTrend OR EMA must trigger
    if (!stValid && !emaValid) continue;

    const triggeredBy = stValid ? 'SuperTrend' : 'EMA';
    console.log(`[SCAN] ${trendingData.symbol} Signal triggered on ${tf} by: ${triggeredBy}`);

    // Build alert signal
    const alertSignal = buildAlertFromTrending(
      trendingData.trending,
      trendingData.info,
      trendingData.security,
      st,
      sr,
      trendingData.priceChange5m,
      trendingData.priceChange1h,
      'trending',
      ema,
      emaValid,
      feeSol
    );

    alertSignal.timeframe = tf;

    return { signal: alertSignal, passed: true, reason: `Indicator conditions met on ${tf} (${triggeredBy})`, timeframe: tf };
  }

  return { signal: null as unknown as AlertSignal, passed: false, reason: 'No timeframe passed indicator check', timeframe: '' };
}

// ─── Process signal stream (fast path) ──────────────────────────────────────

async function processSignalStream(cfg: AppConfig, alerter: Alerter): Promise<void> {
  console.log('[SCAN] Fetching smart money signals...');
  const signals = await getSignalBuys(50);
  console.log(`[SCAN] Got ${signals.length} signals`);

  if (signals.length === 0) return;

  for (const sig of signals) {
    const mint = sig.token_address;

    if (isOnCooldown(mint)) {
      console.log(`[SCAN] ${mint.slice(0, 8)} on cooldown, skipping signal`);
      continue;
    }

    try {
      // Skip kalo mcap/volume terlalu kecil — filter dulu sebelum API calls
      if (sig.market_cap != null && sig.market_cap < cfg.filters.mcap_min) {
        continue;
      }

      // Fee check dulu sebelum enrichment
      let tokenFeeSol: number | undefined;
      if (cfg.filters.min_fee_sol > 0) {
        const feeResult = await getTokenFeesSol(mint);
        if (feeResult.feeSol == null) {
          console.log(`[SCAN] ${mint.slice(0, 8)} fee unavailable (${feeResult.source}), skipping`);
          continue;
        }
        if (feeResult.feeSol < cfg.filters.min_fee_sol) {
          console.log(`[SCAN] ${mint.slice(0, 8)} fee ${feeResult.feeSol.toFixed(2)} SOL < min ${cfg.filters.min_fee_sol} SOL`);
          continue;
        }
        tokenFeeSol = feeResult.feeSol;
      }

      const [info, security, klines] = await Promise.all([
        getTokenInfo(mint),
        getTokenSecurity(mint),
        getMarketKline(mint, '5m', 200),
      ]);

      if (klines.length < 15) continue;

      const priceChange5m = calcPriceChange(klines, 5);
      const priceChange1h = calcPriceChange(klines, 60);

      // Basic safety check from security data
      if (security) {
        if (cfg.filters.rug_check.renounced_mint && !security.renounced_mint) continue;
        if (cfg.filters.rug_check.renounced_freeze_account && !security.renounced_freeze_account) continue;
        if (security.top_10_holder_rate > cfg.filters.top_10_holder_rate_max) continue;
      }

      // Synthesize a GmgnTrending-like object for multi-TF check
      const syntheticTrending: GmgnTrending = {
        address: mint,
        symbol: info?.symbol ?? mint.slice(0, 8),
        name: info?.name ?? '',
        price: info?.price?.price ?? 0,
        price_change_5m: priceChange5m,
        price_change_1h: priceChange1h,
        price_change_24h: 0,
        market_cap: sig.market_cap,
        liquidity: info?.liquidity ?? 0,
        volume_24h: 0,
        swaps: 0,
        holder_count: info?.holder_count ?? 0,
        top_10_holder_rate: security?.top_10_holder_rate ?? 0,
        dev_team_hold_rate: security?.dev_team_hold_rate ?? 0,
        suspected_insider_hold_rate: security?.suspected_insider_hold_rate ?? 0,
        rat_trader_amount_rate: security?.rat_trader_amount_rate ?? 0,
        bundler_trader_amount_rate: security?.bundler_trader_amount_rate ?? 0,
        smart_degen_count: 0,
        bot_degen_count: info?.stat?.bot_degen_count ?? 0,
        renowned_count: 0,
        sniper_count: security?.sniper_count ?? 0,
        renounced_mint: security?.renounced_mint ?? false,
        renounced_freeze_account: security?.renounced_freeze_account ?? false,
        is_wash_trading: security?.is_wash_trading ?? false,
        open_timestamp: info?.open_timestamp ?? 0,
        created_timestamp: info?.creation_timestamp ?? 0,
        is_honeypot: info?.is_honeypot ?? false,
        has_at_least_one_social: info?.has_at_least_one_social ?? false,
        rug_ratio: security?.rug_ratio ?? 0,
      };

      const vsAthPct = info?.ath_price && info?.price?.price
        ? (1 - info.price.price / info.ath_price) * 100
        : 0;

      const check = await checkIndicatorsMultiTF(mint, {
        symbol: syntheticTrending.symbol,
        trending: syntheticTrending,
        info,
        security,
        priceChange5m,
        priceChange1h,
        vsAthPct,
      }, cfg, tokenFeeSol);
      if (!check.passed) continue;

      setCooldown(mint, cfg.scan.cooldownMinutes);
      await alerter.sendAlert(check.signal, 'signal');
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.log(`[SCAN] Rate limited, waiting ${Math.round(err.waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, err.waitMs));
      } else {
        console.error(`[SCAN] Error processing signal ${mint.slice(0, 8)}:`, err);
      }
    }
  }
}

// ─── Process pools from Meteora (server-side filtered by mcap) ─────────────

async function processMeteoraPools(cfg: AppConfig, alerter: Alerter, seenMints: Set<string>): Promise<void> {
  console.log(`[SCAN] Fetching Meteora pools (mcap >= ${cfg.filters.mcap_min})...`);

  const maxMcap = cfg.filters.mcap_max > 0 ? cfg.filters.mcap_max : 100_000_000;
  const pools = await discoverPools(cfg.filters.mcap_min, maxMcap, 10);
  console.log(`[SCAN] Meteora returned ${pools.length} pools`);

  for (const pool of pools) {
    const mintKey = pool.base.mint.toLowerCase();
    if (seenMints.has(mintKey)) continue;
    if (isOnCooldown(mintKey)) continue;

    const symbol = pool.base.symbol || mintKey.slice(0, 8);

    // Build synthetic GmgnTrending
    const trending: GmgnTrending = {
      address: pool.base.mint,
      symbol,
      name: pool.name,
      price: pool.price,
      price_change_5m: 0,
      price_change_1h: pool.price_change_pct,
      price_change_24h: 0,
      market_cap: pool.mcap,
      liquidity: pool.active_tvl,
      volume_24h: pool.volume_window,
      swaps: 0,
      holder_count: pool.holders,
      top_10_holder_rate: 0,
      dev_team_hold_rate: 0,
      suspected_insider_hold_rate: 0,
      rat_trader_amount_rate: 0,
      bundler_trader_amount_rate: 0,
      smart_degen_count: 0,
      bot_degen_count: 0,
      renowned_count: 0,
      sniper_count: 0,
      renounced_mint: true,
      renounced_freeze_account: true,
      is_wash_trading: false,
      open_timestamp: 0,
      created_timestamp: 0,
      is_honeypot: false,
      has_at_least_one_social: false,
      rug_ratio: 0,
    };

    seenMints.add(mintKey);

    // Fee check (cuma 1-5 pool, aman dari rate limit)
    let tokenFeeSol: number | undefined;
    if (cfg.filters.min_fee_sol > 0) {
      const feeResult = await getTokenFeesSol(trending.address);
      if (feeResult.feeSol == null) {
        console.log(`[SCAN] ${symbol} fee unavailable (${feeResult.source}), skipping`);
        continue;
      }
      if (feeResult.feeSol < cfg.filters.min_fee_sol) {
        console.log(`[SCAN] ${symbol} fee ${feeResult.feeSol.toFixed(2)} SOL < min ${cfg.filters.min_fee_sol} SOL`);
        continue;
      }
      tokenFeeSol = feeResult.feeSol;
    }

    // Enrich
    const enriched = await enrichToken(trending).catch((err) => {
      console.error(`[SCAN] Failed to enrich ${symbol}: ${err}`);
      return null;
    });
    if (!enriched) continue;

    // Age check
    const age = checkTokenAge(enriched.info?.open_timestamp ?? 0, cfg.scan.minAgeHours);
    if (!age.ok) {
      console.log(`[SCAN] ${symbol} age check failed: ${age.reason}`);
      continue;
    }

    // Multi-TF indicator check
    try {
      const check = await checkIndicatorsMultiTF(trending.address, {
          symbol,
          trending,
          info: enriched.info,
          security: enriched.security,
          priceChange5m: enriched.priceChange5m,
          priceChange1h: enriched.priceChange1h,
          vsAthPct: enriched.vsAthPct,
        }, cfg, tokenFeeSol);
      if (!check.passed) {
        console.log(`[SCAN] ${symbol} indicator check: ${check.reason}`);
        continue;
      }

      setCooldown(trending.address, cfg.scan.cooldownMinutes);
      await alerter.sendAlert(check.signal, 'trending');
    } catch (err) {
      console.error(`[SCAN] Error checking ${symbol}:`, err);
    }
  }
}

// ─── Main scan loop ─────────────────────────────────────────────────────────

export async function runScan(cfg: AppConfig, alerter: Alerter): Promise<void> {
  setConcurrencyLimit(10);
  const seenMints = new Set<string>();

  console.log('[SCAN] === Starting scan cycle ===');

  // Fast path: smart money signals first
  await processSignalStream(cfg, alerter);

  // Meteora path: server-side mcap filter, cuma dapet pool berkualitas
  await processMeteoraPools(cfg, alerter, seenMints);

  console.log('[SCAN] === Scan cycle complete ===');
}

export default { runScan };