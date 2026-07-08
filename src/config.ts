import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AppConfig, FilterConfig } from './types';

// Load .env file if present
dotenv.config();

export type { AppConfig } from './types';

// ─── Env helpers ────────────────────────────────────────────────────────────

function env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function envBool(key: string, fallback = false): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  return val.toLowerCase() === 'true';
}

function envNum(key: string, fallback = 0): number {
  const val = process.env[key];
  if (val === undefined || val === null || val.trim() === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Default filter config ──────────────────────────────────────────────────

const DEFAULT_FILTERS: FilterConfig = {
  rug_check: {
    renounced_mint: true,
    renounced_freeze_account: true,
  },
  top_10_holder_rate_max: 60,
  vol24h_min: 500000,
  mcap_min: 350000,
  mcap_max: 30_000_000,
  min_liquidity_usd: 5000,
  min_holders: 0,
  min_fee_sol: 30,
  vs_ath_pct_min: 0,
  vs_ath_pct_max: 95,
  require_not_wash_trading: false,
  require_has_social: false,
  require_not_honeypot: false,
  min_token_age_hours: 6,
};

// ─── Load filter config from JSON file ─────────────────────────────────────

function loadFilterConfig(configPath: string): FilterConfig {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[CONFIG] filters.config.json not found at ${resolved}, using defaults`);
    return DEFAULT_FILTERS;
  }

  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);

    // Merge with defaults — user-provided values override
    return {
      rug_check: {
        renounced_mint: parsed.filters?.rug_check?.renounced_mint ?? DEFAULT_FILTERS.rug_check.renounced_mint,
        renounced_freeze_account: parsed.filters?.rug_check?.renounced_freeze_account ?? DEFAULT_FILTERS.rug_check.renounced_freeze_account,
      },
      top_10_holder_rate_max: parsed.filters?.top_10_holder_rate_max ?? DEFAULT_FILTERS.top_10_holder_rate_max,
      vol24h_min: parsed.filters?.vol24h_min ?? DEFAULT_FILTERS.vol24h_min,
      mcap_min: parsed.filters?.mcap_min ?? DEFAULT_FILTERS.mcap_min,
      mcap_max: parsed.filters?.mcap_max ?? DEFAULT_FILTERS.mcap_max,
      min_liquidity_usd: parsed.filters?.min_liquidity_usd ?? DEFAULT_FILTERS.min_liquidity_usd,
      min_holders: parsed.filters?.min_holders ?? DEFAULT_FILTERS.min_holders,
      min_fee_sol: parsed.filters?.min_fee_sol ?? DEFAULT_FILTERS.min_fee_sol,
      vs_ath_pct_min: parsed.filters?.vs_ath_pct_min ?? DEFAULT_FILTERS.vs_ath_pct_min,
      vs_ath_pct_max: parsed.filters?.vs_ath_pct_max ?? DEFAULT_FILTERS.vs_ath_pct_max,
      require_not_wash_trading: parsed.filters?.require_not_wash_trading ?? DEFAULT_FILTERS.require_not_wash_trading,
      require_has_social: parsed.filters?.require_has_social ?? DEFAULT_FILTERS.require_has_social,
      require_not_honeypot: parsed.filters?.require_not_honeypot ?? DEFAULT_FILTERS.require_not_honeypot,
      min_token_age_hours: parsed.filters?.min_token_age_hours ?? DEFAULT_FILTERS.min_token_age_hours,
    };
  } catch (err) {
    console.error(`[CONFIG] Failed to parse filters.config.json: ${err}`);
    return DEFAULT_FILTERS;
  }
}

// ─── Main config loader ─────────────────────────────────────────────────────

export function loadConfig(): AppConfig {
  const botToken = env('TELEGRAM_BOT_TOKEN');
  const chatId = env('TELEGRAM_CHAT_ID');

  if (!botToken || !chatId) {
    throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required in .env');
  }

  const configPath = env('FILTERS_CONFIG_PATH', './filters.config.json');
  const filters = loadFilterConfig(configPath);

  const pollIntervalMs = envNum('POLL_INTERVAL_MS', 60_000);
  const heartbeatDefault = pollIntervalMs >= 300_000 ? 1 : 5;
  const heartbeatEveryNCycles = envNum('HEARTBEAT_EVERY_N_CYCLES', heartbeatDefault);

  return {
    gmgnApiKey: env('GMGN_API_KEY', ''),
    telegramBotToken: botToken,
    telegramChatId: chatId,
    telegramSendEnabled: envBool('TELEGRAM_SEND_ENABLED', false),
    pollIntervalMs,
    heartbeatEveryNCycles,
    filters,
    scan: {
      minAgeHours: filters.min_token_age_hours ?? 6,
      cooldownMinutes: 60,
    },
    supertrend: {
      period: 10,
      multiplier: 3,
    },
    stochrsi: {
      period: 14,
      kPeriod: 14,
      dPeriod: 14,
      smoothK: 3,
    },
  };
}

// ─── OS helpers ─────────────────────────────────────────────────────────────

/**
 * Cross-platform npm command
 * PowerShell on Windows blocks .ps1 scripts, so we use npm.cmd
 */
export function getNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export default { loadConfig, getNpmCommand };