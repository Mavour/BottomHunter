import { FilterConfig, GmgnTrending, GmgnTokenInfo, GmgnTokenSecurity, AlertSignal } from './types';

/**
 * Check token age using open_timestamp (time trading opened).
 * Skip tokens with open_timestamp = 0 (never opened).
 */
export function checkTokenAge(
  openTimestamp: number,
  minAgeHours: number
): { ok: boolean; reason: string } {
  if (openTimestamp === 0) {
    return { ok: false, reason: 'open_timestamp is 0 (token never opened for trading)' };
  }
  const ageMs = Date.now() - openTimestamp * 1000; // GMGN timestamps are in seconds
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours < minAgeHours) {
    return { ok: false, reason: `Token age ${ageHours.toFixed(1)}h < min ${minAgeHours}h` };
  }
  return { ok: true, reason: '' };
}

/**
 * Apply filters to a trending token.
 * Returns { passed: false, reason: '...' } on first failure.
 * Returns { passed: true } when all configured thresholds pass.
 */
export function filterTrending(
  t: GmgnTrending,
  cfg: FilterConfig
): { passed: boolean; reason: string } {
  // Rug checks
  if (cfg.rug_check.renounced_mint && !t.renounced_mint) {
    return { passed: false, reason: 'Mint authority not renounced' };
  }
  if (cfg.rug_check.renounced_freeze_account && !t.renounced_freeze_account) {
    return { passed: false, reason: 'Freeze authority not renounced' };
  }

  // Concentration
  if (t.top_10_holder_rate > cfg.top_10_holder_rate_max) {
    return { passed: false, reason: `top10 ${t.top_10_holder_rate}% > max ${cfg.top_10_holder_rate_max}%` };
  }
  if (t.dev_team_hold_rate > cfg.dev_team_hold_rate_max) {
    return { passed: false, reason: `dev ${t.dev_team_hold_rate}% > max ${cfg.dev_team_hold_rate_max}%` };
  }
  if (t.suspected_insider_hold_rate > cfg.suspected_insider_hold_rate_max) {
    return { passed: false, reason: `insider ${t.suspected_insider_hold_rate}% > max ${cfg.suspected_insider_hold_rate_max}%` };
  }
  if (t.rat_trader_amount_rate > cfg.rat_trader_amount_rate_max) {
    return { passed: false, reason: `entrapment ${t.rat_trader_amount_rate}% > max ${cfg.rat_trader_amount_rate_max}%` };
  }
  if (t.bundler_trader_amount_rate > cfg.bundler_trader_amount_rate_max) {
    return { passed: false, reason: `bundler ${t.bundler_trader_amount_rate}% > max ${cfg.bundler_trader_amount_rate_max}%` };
  }

  // Wallet counts
  if (t.sniper_count > cfg.sniper_count_max) {
    return { passed: false, reason: `sniper ${t.sniper_count} > max ${cfg.sniper_count_max}` };
  }
  if (t.bot_degen_count > cfg.bot_degen_count_max) {
    return { passed: false, reason: `bot_degen ${t.bot_degen_count} > max ${cfg.bot_degen_count_max}` };
  }
  if (t.smart_degen_count < cfg.smart_degen_count_min) {
    return { passed: false, reason: `smart_degen ${t.smart_degen_count} < min ${cfg.smart_degen_count_min}` };
  }
  if (t.renowned_count < cfg.renowned_count_min) {
    return { passed: false, reason: `renowned ${t.renowned_count} < min ${cfg.renowned_count_min}` };
  }

  // Market
  if (t.volume_24h < cfg.vol24h_min) {
    return { passed: false, reason: `vol24h $${t.volume_24h} < min $${cfg.vol24h_min}` };
  }
  if (t.market_cap < cfg.mcap_min) {
    return { passed: false, reason: `mcap $${t.market_cap} < min $${cfg.mcap_min}` };
  }
  if (cfg.mcap_max > 0 && t.market_cap > cfg.mcap_max) {
    return { passed: false, reason: `mcap $${t.market_cap} > max $${cfg.mcap_max}` };
  }
  if (t.liquidity < cfg.min_liquidity_usd) {
    return { passed: false, reason: `liq $${t.liquidity} < min $${cfg.min_liquidity_usd}` };
  }
  if (t.holder_count < cfg.min_holders) {
    return { passed: false, reason: `holders ${t.holder_count} < min ${cfg.min_holders}` };
  }

  // Boolean flags
  if (cfg.require_not_wash_trading && t.is_wash_trading) {
    return { passed: false, reason: 'Wash trading detected' };
  }
  if (cfg.require_has_social && !t.has_at_least_one_social) {
    return { passed: false, reason: 'No social links' };
  }
  if (cfg.require_not_honeypot && t.is_honeypot) {
    return { passed: false, reason: 'Token is honeypot' };
  }

  return { passed: true, reason: '' };
}

/**
 * Calculate vsATH percentage.
 * vsAthPct = (1 - currentPrice / athPrice) * 100
 * Returns 0 if athPrice is missing or 0.
 */
export function calcVsAthPct(currentPrice: number, athPrice: number): number {
  if (!athPrice || !currentPrice) return 0;
  return (1 - currentPrice / athPrice) * 100;
}

/**
 * Build AlertSignal from trending token + enrichment data.
 * All indicator data (supertrend, stochrsi, ema) must be computed separately and passed in.
 */
export function buildAlertFromTrending(
  t: GmgnTrending,
  info: GmgnTokenInfo | null,
  security: GmgnTokenSecurity | null,
  supertrend: { direction: 'bullish' | 'bearish'; value: number; priceAbove: boolean; price: number },
  stochrsi: { k: number; d: number; crossedAbove: boolean; overbought: boolean },
  priceChange5m: number,
  priceChange1h: number,
  source: 'signal' | 'trending',
  ema?: { ema25: number; ema50: number; ema100: number; ema200: number; nearEmaLevel: { period: number; value: number } | null; supportZone: boolean },
  emaTriggered?: boolean
): AlertSignal {
  const currentPrice = info?.price?.price ?? t.price;
  const athPrice = info?.ath_price ?? 0;

  // Calculate fee ratio for display (fee SOL / mcap)
  // Using rug_ratio as proxy for fee data when available
  const feeSol = security?.rug_ratio ?? 0;
  const mcap = t.market_cap || 0;
  const feeRatioLabel = mcap > 0
    ? `${feeSol.toFixed(2)} SOL / $${(mcap / 1000).toFixed(0)}K mcap`
    : 'N/A';

  return {
    mint: t.address,
    symbol: t.symbol,
    name: t.name,
    marketCap: t.market_cap,
    volume24h: t.volume_24h,
    liquidity: t.liquidity,
    holders: t.holder_count,
    priceChange5m,
    priceChange1h,
    vsAthPct: calcVsAthPct(currentPrice, athPrice),
    // Safety
    rug: t.rug_ratio > 0,
    top10HolderRate: t.top_10_holder_rate,
    devTeamHoldRate: t.dev_team_hold_rate,
    insiderRate: t.suspected_insider_hold_rate,
    bundlerRate: t.bundler_trader_amount_rate,
    entrampmentRate: t.rat_trader_amount_rate,
    sniperCount: t.sniper_count,
    botDegenCount: t.bot_degen_count,
    smartDegenCount: t.smart_degen_count,
    renownedCount: t.renowned_count,
    renouncedMint: t.renounced_mint,
    renouncedFreeze: t.renounced_freeze_account,
    isWashTrading: t.is_wash_trading,
    social: t.has_at_least_one_social,
    // Indicators
    supertrend: {
      value: supertrend.value,
      direction: supertrend.direction,
      priceAbove: supertrend.priceAbove,
      price: supertrend.price,
      line: supertrend.value,
    },
    stochrsi: {
      k: stochrsi.k,
      d: stochrsi.d,
      crossedAbove: stochrsi.crossedAbove,
      overbought: stochrsi.overbought,
    },
    // EMA Support Zone
    ema: {
      ema25: ema?.ema25 ?? 0,
      ema50: ema?.ema50 ?? 0,
      ema100: ema?.ema100 ?? 0,
      ema200: ema?.ema200 ?? 0,
      nearEmaLevel: ema?.nearEmaLevel ?? null,
      supportZone: ema?.supportZone ?? false,
      triggered: emaTriggered ?? false,
    },
    // Fee info
    feeSol,
    feeRatioLabel,
    // Meta
    source,
    chartUrl: `https://gmgn.ai/sol/token/${t.address}`,
    dexScreenerUrl: `https://dexscreener.com/solana/${t.address}`,
  };
}