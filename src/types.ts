// ─── GMGN API Response Types ────────────────────────────────────────────────

/** GMGN market kline candle */
export interface GmgnKline {
  time: number;        // timestamp in milliseconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;      // USD volume
  amount?: number;     // token amount
}

/** GMGN token info response */
export interface GmgnTokenInfo {
  address: string;
  symbol: string;
  name: string;
  price: { price: number };
  liquidity: number;
  holder_count: number;
  creation_timestamp: number;
  open_timestamp: number;
  ath_price: number;
  stat: {
    top_10_holder_rate: number;
    dev_team_hold_rate: number;
    fresh_wallet_rate: number;
    bot_degen_count: number;
  };
  wallet_tags_stat: {
    smart_wallets: number;
    sniper_wallets: number;
    bundler_wallets: number;
  };
  link: {
    twitter_username?: string;
    telegram?: string;
    website?: string;
  };
  has_at_least_one_social: boolean;
  is_honeypot: boolean;
}

/** GMGN token security response */
export interface GmgnTokenSecurity {
  renounced_mint: boolean;
  renounced_freeze_account: boolean;
  top_10_holder_rate: number;
  dev_team_hold_rate: number;
  creator_balance_rate: number;
  rug_ratio: number;
  is_wash_trading: boolean;
  suspected_insider_hold_rate: number;
  rat_trader_amount_rate: number;
  bundler_trader_amount_rate: number;
  sniper_count: number;
  buy_tax: number;
  sell_tax: number;
  burn_status: string;
}

/** GMGN trending token (from market trending) */
export interface GmgnTrending {
  address: string;
  symbol: string;
  name: string;
  price: number;
  price_change_5m: number;
  price_change_1h: number;
  price_change_24h: number;
  market_cap: number;
  liquidity: number;
  volume_24h: number;
  swaps: number;
  holder_count: number;
  top_10_holder_rate: number;
  dev_team_hold_rate: number;
  suspected_insider_hold_rate: number;
  rat_trader_amount_rate: number;
  bundler_trader_amount_rate: number;
  smart_degen_count: number;
  bot_degen_count: number;
  renowned_count: number;
  sniper_count: number;
  renounced_mint: boolean;
  renounced_freeze_account: boolean;
  is_wash_trading: boolean;
  open_timestamp: number;
  created_timestamp: number;
  is_honeypot: boolean;
  has_at_least_one_social: boolean;
  rug_ratio: number;
}

/** GMGN smart money signal (from market signal --signal-type 12) */
export interface GmgnSignal {
  token_address: string;
  signal_type: number;
  trigger_at: number;
  trigger_mc: number;
  market_cap: number;
  chain: string;
}

// ─── Indicator Types ───────────────────────────────────────────────────────

export interface SuperTrendResult {
  value: number;        // ST line value
  direction: 'bullish' | 'bearish';
  priceAbove: boolean;  // current close > ST line
  price: number;
  line: number;         // alias for value
}

export interface StochRSIResult {
  k: number;            // %K value
  d: number;            // %D value
  crossedAbove: boolean; // %K crossed above %D on last candle
  overbought: boolean;  // %K >= 80
}

// ─── Filter Config ─────────────────────────────────────────────────────────

export interface FilterConfig {
  // Rug check — must pass BOTH to pass
  rug_check: {
    renounced_mint: boolean;
    renounced_freeze_account: boolean;
  };
  // Concentration limits (%)
  top_10_holder_rate_max: number;
  // Market
  vol24h_min: number;
  mcap_min: number;
  mcap_max: number;
  min_liquidity_usd: number;
  min_holders: number;
  // Fee
  min_fee_sol: number;
  // ATH
  vs_ath_pct_min: number;
  vs_ath_pct_max: number;
  // Boolean flags
  require_not_wash_trading: boolean;
  require_has_social: boolean;
  require_not_honeypot: boolean;
  // Token age
  min_token_age_hours: number;
}

// ─── App Config ────────────────────────────────────────────────────────────

export interface AppConfig {
  gmgnApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  telegramSendEnabled: boolean;
  pollIntervalMs: number;
  heartbeatEveryNCycles: number;
  filters: FilterConfig;
  scan: {
    minAgeHours: number;
    cooldownMinutes: number;
  };
  supertrend: {
    period: number;
    multiplier: number;
  };
  stochrsi: {
    period: number;
    kPeriod: number;
    dPeriod: number;
    smoothK: number;
  };
}

export interface ScanStats {
  cycle: number;
  signalsChecked: number;
  poolsChecked: number;
  alertsSent: number;
  durationMs: number;
  error?: string;
  circuitSkipped?: number;
}

// ─── Alert Signal ──────────────────────────────────────────────────────────

export type SignalSource = 'signal' | 'trending';
export type DataSource = 'dexscreener' | 'meteora_estimate';

export interface AlertSignal {
  mint: string;
  symbol: string;
  name?: string;
  marketCap: number;
  volume24h: number;
  volumeSource: DataSource;
  liquidity: number;
  liquiditySource: DataSource;
  holders: number;
  priceChange5m: number;
  priceChange1h: number;
  vsAthPct: number;
  // Safety
  rug: boolean;
  top10HolderRate: number;
  renouncedMint: boolean;
  renouncedFreeze: boolean;
  isWashTrading: boolean;
  social: boolean;
  // Indicators
  supertrend: SuperTrendResult;
  stochrsi: StochRSIResult;
  // EMA Support Zone
  ema: {
    ema25: number;
    ema50: number;
    ema100: number;
    ema200: number;
    nearEmaLevel: { period: number; value: number } | null;
    supportZone: boolean;
    triggered: boolean;
  };
  // Fee info (for display only)
  feeSol: number;
  feeRatioLabel: string;
  // Timeframe that triggered the signal
  timeframe: string;
  // Meta
  source: SignalSource;
  chartUrl: string;
  dexScreenerUrl: string;
}