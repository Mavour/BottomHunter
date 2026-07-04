import { execFileSync } from 'child_process';
import { GmgnKline, GmgnTokenInfo, GmgnTokenSecurity, GmgnTrending, GmgnSignal } from '../types';

// ─── CLI exec helper ────────────────────────────────────────────────────────

const CLI_TIMEOUT_MS = 30_000;

function execGmgn(args: string[]): string {
  try {
    const result = execFileSync('gmgn-cli', args, {
      timeout: CLI_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GMGN_API_KEY: process.env.GMGN_API_KEY || '' },
    });
    return result.trim();
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string; stderr?: string };
    if (error.status === 429) {
      // Rate limited — throw with signal so caller can retry after backoff
      const reset = error.stderr?.match(/X-RateLimit-Reset:\s*(\d+)/)?.[1];
      const waitMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) : 5_000;
      throw new RateLimitError(waitMs);
    }
    throw new Error(`gmgn-cli failed: ${error.message ?? String(error)}`);
  }
}

class RateLimitError extends Error {
  waitMs: number;
  constructor(waitMs: number) {
    super(`GMGN rate limited, back off ${Math.round(waitMs / 1000)}s`);
    this.waitMs = waitMs;
  }
}

// ─── Concurrency limiter ────────────────────────────────────────────────────

let concurrencyLimit = 10;
let activeCount = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeCount < concurrencyLimit) {
      activeCount++;
      resolve();
    } else {
      waitQueue.push(resolve);
    }
  });
}

function releaseSlot(): void {
  activeCount--;
  const next = waitQueue.shift();
  if (next) {
    activeCount++;
    next();
  }
}

export function setConcurrencyLimit(n: number): void {
  concurrencyLimit = Math.max(1, n);
}

// ─── JSON parser helper ─────────────────────────────────────────────────────

function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Failed to parse ${context} response: ${raw.slice(0, 200)}`);
  }
}

// ─── Startup validation ─────────────────────────────────────────────────────

/**
 * Check if gmgn-cli is installed and has a valid API key configured.
 * Runs before the main loop starts.
 */
export async function validateGmgnConfig(): Promise<boolean> {
  try {
    // Check gmgn-cli is runnable
    execGmgn(['--version']);
  } catch {
    console.error('[GMGN] gmgn-cli not found or not installed. Run: npm install -g gmgn-cli');
    return false;
  }

  // Check API key is configured by running a simple query
  try {
    execGmgn(['market', 'trending', '--chain', 'sol', '--interval', '24h', '--limit', '1', '--raw']);
    return true;
  } catch (err) {
    const msg = String(err);
    if (msg.includes('401') || msg.includes('403') || msg.includes('API')) {
      console.error('[GMGN] GMGN_API_KEY not set or invalid. Run: gmgn-cli config --apply <YOUR_KEY>');
    } else {
      console.error(`[GMGN] Config check failed: ${msg}`);
    }
    return false;
  }
}

// ─── Market klines ──────────────────────────────────────────────────────────

/**
 * Fetch 5m OHLCV candles for a token.
 * GMGN CLI: gmgn-cli market kline --chain sol --address <mint> --resolution 5m --from <unix_s> --to <unix_s> --raw
 */
export async function getMarketKline(
  mint: string,
  resolution = '5m',
  limit = 100
): Promise<GmgnKline[]> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - 3 * 60 * 60; // 3h back

  await acquireSlot();
  try {
    const raw = execGmgn([
      'market', 'kline',
      '--chain', 'sol',
      '--address', mint,
      '--resolution', resolution,
      '--from', String(from),
      '--to', String(now),
      '--raw',
    ]);
    const data = parseJson<{ data?: { list?: GmgnKline[] } }>(raw, 'kline');
    return data.data?.list ?? [];
  } finally {
    releaseSlot();
  }
}

// ─── Token info ─────────────────────────────────────────────────────────────

/**
 * Get token overview info.
 * GMGN CLI: gmgn-cli token info --chain sol --address <mint> --raw
 */
export async function getTokenInfo(mint: string): Promise<GmgnTokenInfo | null> {
  await acquireSlot();
  try {
    const raw = execGmgn(['token', 'info', '--chain', 'sol', '--address', mint, '--raw']);
    const data = parseJson<{ data?: GmgnTokenInfo }>(raw, 'token info');
    return data.data ?? null;
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

// ─── Token security ─────────────────────────────────────────────────────────

/**
 * Get token security details.
 * GMGN CLI: gmgn-cli token security --chain sol --address <mint> --raw
 */
export async function getTokenSecurity(mint: string): Promise<GmgnTokenSecurity | null> {
  await acquireSlot();
  try {
    const raw = execGmgn(['token', 'security', '--chain', 'sol', '--address', mint, '--raw']);
    const data = parseJson<{ data?: GmgnTokenSecurity }>(raw, 'token security');
    return data.data ?? null;
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

// ─── Smart money signals ────────────────────────────────────────────────────

/**
 * Fetch smart money buy signals (signal_type 12 = smart degen buy).
 * GMGN CLI: gmgn-cli market signal --chain sol --signal-type 12 --raw
 */
export async function getSignalBuys(limit = 50): Promise<GmgnSignal[]> {
  await acquireSlot();
  try {
    const raw = execGmgn(['market', 'signal', '--chain', 'sol', '--signal-type', '12', '--raw']);
    const data = parseJson<{ data?: GmgnSignal[] }>(raw, 'signal');
    return data.data ?? [];
  } catch {
    return [];
  } finally {
    releaseSlot();
  }
}

// ─── Trending tokens ────────────────────────────────────────────────────────

/**
 * Fetch trending Solana tokens.
 * GMGN CLI: gmgn-cli market trending --chain sol --interval 24h --order-by volume --limit 100 --min-created 3h --filter renounced --filter frozen --raw
 */
export async function getTrending(minCreatedHours = 3, limit = 100): Promise<GmgnTrending[]> {
  await acquireSlot();
  try {
    const raw = execGmgn([
      'market', 'trending',
      '--chain', 'sol',
      '--interval', '24h',
      '--order-by', 'volume',
      '--limit', String(limit),
      '--min-created', `${minCreatedHours}h`,
      '--filter', 'renounced',
      '--filter', 'frozen',
      '--raw',
    ]);
    const data = parseJson<{ data?: GmgnTrending[] }>(raw, 'trending');
    return data.data ?? [];
  } catch {
    return [];
  } finally {
    releaseSlot();
  }
}

export { RateLimitError };