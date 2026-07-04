import { AppConfig, GmgnSignal, GmgnTrending, GmgnKline, GmgnTokenInfo, GmgnTokenSecurity, AlertSignal, SignalSource } from './types';
import {
  getSignalBuys,
  getTrending,
  getMarketKline,
  getTokenInfo,
  getTokenSecurity,
  setConcurrencyLimit,
  RateLimitError,
} from './adapters/gmgn';
import { calculateSuperTrend, validateSuperTrendSignal } from './indicators/supertrend';
import { calculateStochRSI, validateStochRSISignal } from './indicators/stochrsi';
import { calculateAllEMAs, validateEMASignal } from './indicators/ema';
import { filterTrending, checkTokenAge, buildAlertFromTrending } from './filters';
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
    getMarketKline(trending.address, '5m', 100),
  ]);

  const priceChange5m = calcPriceChange(klines, 5);
  const priceChange1h = calcPriceChange(klines, 60);

  let vsAthPct = 0;
  if (info?.ath_price && info?.price?.price) {
    vsAthPct = (1 - info.price.price / info.ath_price) * 100;
  }

  return { trending, info, security, klines, priceChange5m, priceChange1h, vsAthPct };
}

// ─── Check indicators on enriched token ─────────────────────────────────────

interface IndicatorCheck {
  signal: AlertSignal;
  passed: boolean;
  reason: string;
}

function checkIndicators(enriched: EnrichedToken, cfg: AppConfig): IndicatorCheck {
  const { trending, klines, info, security, priceChange5m, priceChange1h, vsAthPct } = enriched;

  if (klines.length < 15) {
    return { signal: null as unknown as AlertSignal, passed: false, reason: 'Insufficient kline data' };
  }

  // StochRSI - required for both paths
  const sr = calculateStochRSI(
    klines,
    cfg.stochrsi.period,
    cfg.stochrsi.kPeriod,
    cfg.stochrsi.dPeriod,
    cfg.stochrsi.smoothK
  );
  console.log(`[SCAN] ${trending.symbol} StochRSI: %K=${sr.k.toFixed(2)}, %D=${sr.d.toFixed(2)}, cross=${sr.crossedAbove}, overbought=${sr.overbought}`);

  if (!validateStochRSISignal(sr)) {
    return {
      signal: null as unknown as AlertSignal,
      passed: false,
      reason: `StochRSI cross=${sr.crossedAbove}, overbought=${sr.overbought} — conditions not met`,
    };
  }

  // SuperTrend check
  const st = calculateSuperTrend(klines, cfg.supertrend.period, cfg.supertrend.multiplier);
  console.log(`[SCAN] ${trending.symbol} SuperTrend: ${st.direction} (close=${st.price.toExponential(2)}, line=${st.value.toExponential(2)}, above=${st.priceAbove})`);

  const stValid = validateSuperTrendSignal(st);

  // EMA check (alternative to SuperTrend)
  const ema = calculateAllEMAs(klines);
  const emaValid = validateEMASignal(ema);
  console.log(`[SCAN] ${trending.symbol} EMA: 25=${ema.ema25.toFixed(6)}, 50=${ema.ema50.toFixed(6)}, 100=${ema.ema100.toFixed(6)}, 200=${ema.ema200.toFixed(6)}, supportZone=${ema.supportZone}`);

  // OR logic: SuperTrend OR EMA must trigger
  if (!stValid && !emaValid) {
    const reason = stValid
      ? `EMA supportZone=${ema.supportZone} — not near support`
      : `SuperTrend ${st.direction}, priceAbove=${st.priceAbove} — not bullish reclaim`;
    return {
      signal: null as unknown as AlertSignal,
      passed: false,
      reason: `Both indicators failed: ST=${st.direction}/${st.priceAbove}, EMA support=${ema.supportZone}`,
    };
  }

  const triggeredBy = stValid ? 'SuperTrend' : 'EMA';
  console.log(`[SCAN] ${trending.symbol} Signal triggered by: ${triggeredBy}`);

  // Build alert signal
  const alertSignal = buildAlertFromTrending(
    trending,
    info,
    security,
    st,
    sr,
    priceChange5m,
    priceChange1h,
    'trending',
    ema,
    emaValid
  );

  return { signal: alertSignal, passed: true, reason: `Indicator conditions met (${triggeredBy})` };
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

    // We need to find this token in trending data to get full filter data
    // For now, just try to enrich and check indicators directly
    // The filter engine will validate safety metrics
    try {
      const [info, security, klines] = await Promise.all([
        getTokenInfo(mint),
        getTokenSecurity(mint),
        getMarketKline(mint, '5m', 100),
      ]);

      if (klines.length < 15) continue;

      const priceChange5m = calcPriceChange(klines, 5);
      const priceChange1h = calcPriceChange(klines, 60);

      // Basic safety check from security data
      if (security) {
        if (cfg.filters.rug_check.renounced_mint && !security.renounced_mint) continue;
        if (cfg.filters.rug_check.renounced_freeze_account && !security.renounced_freeze_account) continue;
        if (security.top_10_holder_rate > cfg.filters.top_10_holder_rate_max) continue;
        if (security.dev_team_hold_rate > cfg.filters.dev_team_hold_rate_max) continue;
        if (security.suspected_insider_hold_rate > cfg.filters.suspected_insider_hold_rate_max) continue;
      }

      const st = calculateSuperTrend(klines, cfg.supertrend.period, cfg.supertrend.multiplier);
      const stValid = validateSuperTrendSignal(st);

      const sr = calculateStochRSI(klines, cfg.stochrsi.period, cfg.stochrsi.kPeriod, cfg.stochrsi.dPeriod, cfg.stochrsi.smoothK);
      if (!validateStochRSISignal(sr)) continue;

      // EMA check (alternative to SuperTrend)
      const ema = calculateAllEMAs(klines);
      const emaValid = validateEMASignal(ema);

      // OR logic: SuperTrend OR EMA must trigger
      if (!stValid && !emaValid) continue;

      // Synthesize a GmgnTrending-like object for buildAlertFromTrending
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

      const alertSignal = buildAlertFromTrending(syntheticTrending, info, security, st, sr, priceChange5m, priceChange1h, 'signal', ema, emaValid);

      setCooldown(mint, cfg.scan.cooldownMinutes);
      await alerter.sendAlert(alertSignal, 'signal');
    } catch (err) {
      if (err instanceof RateLimitError) {
        console.log(`[SCAN] Rate limited, waiting ${Math.round(err.waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, err.waitMs));
      }
    }
  }
}

// ─── Process trending stream (slow path) ────────────────────────────────────

async function processTrendingStream(cfg: AppConfig, alerter: Alerter, seenMints: Set<string>): Promise<void> {
  console.log('[SCAN] Fetching trending tokens...');

  let trending: GmgnTrending[];
  try {
    trending = await getTrending(cfg.scan.minAgeHours, 100);
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.log(`[SCAN] Rate limited, waiting ${Math.round(err.waitMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, err.waitMs));
    }
    console.error('[SCAN] Failed to fetch trending:', err);
    return;
  }

  console.log(`[SCAN] Got ${trending.length} trending tokens`);

  // Add all seen mints to cooldown map to prevent re-processing
  for (const t of trending) {
    if (isOnCooldown(t.address)) {
      seenMints.add(t.address.toLowerCase());
    }
  }

  // Filter + age check + enrich concurrently
  const candidates: GmgnTrending[] = [];
  for (const t of trending) {
    const mintKey = t.address.toLowerCase();
    if (seenMints.has(mintKey)) continue;
    if (isOnCooldown(mintKey)) continue;

    const age = checkTokenAge(t.open_timestamp, cfg.scan.minAgeHours);
    if (!age.ok) {
      console.log(`[SCAN] ${t.symbol} age check failed: ${age.reason}`);
      continue;
    }

    const filterResult = filterTrending(t, cfg.filters);
    if (!filterResult.passed) {
      console.log(`[SCAN] ${t.symbol} filter failed: ${filterResult.reason}`);
      continue;
    }

    seenMints.add(mintKey);
    candidates.push(t);
  }

  console.log(`[SCAN] ${candidates.length} candidates after filters`);

  // Enrich candidates concurrently (respects rate limit via gmgn adapter)
  const enrichedResults = await Promise.allSettled(
    candidates.map((t) => enrichToken(t))
  );

  for (let i = 0; i < enrichedResults.length; i++) {
    const result = enrichedResults[i];
    const trendingToken = candidates[i];

    if (result.status === 'rejected') {
      const err = result.reason;
      if (err instanceof RateLimitError) {
        console.log(`[SCAN] Rate limited, waiting ${Math.round(err.waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, err.waitMs));
      }
      console.error(`[SCAN] Failed to enrich ${trendingToken.symbol}: ${err}`);
      continue;
    }

    const enriched = result.value as EnrichedToken;

    const check = checkIndicators(enriched, cfg);
    if (!check.passed) {
      console.log(`[SCAN] ${trendingToken.symbol} indicator check: ${check.reason}`);
      continue;
    }

    setCooldown(trendingToken.address, cfg.scan.cooldownMinutes);
    await alerter.sendAlert(check.signal, 'trending');
  }
}

// ─── Main scan loop ─────────────────────────────────────────────────────────

export async function runScan(cfg: AppConfig, alerter: Alerter): Promise<void> {
  setConcurrencyLimit(10);
  const seenMints = new Set<string>();

  console.log('[SCAN] === Starting scan cycle ===');

  // Fast path: smart money signals first
  await processSignalStream(cfg, alerter);

  // Slow path: trending scan
  await processTrendingStream(cfg, alerter, seenMints);

  console.log('[SCAN] === Scan cycle complete ===');
}

export default { runScan };