import { execFileSync } from 'child_process';
import { GmgnKline, GmgnTokenInfo, GmgnTokenSecurity, GmgnTrending, GmgnSignal } from '../types';
import { cacheGet, cacheSet } from '../cache';

const GMGN_API_BASE = 'https://openapi.gmgn.ai';

// ─── Resolution helpers ───────────────────────────────────────────────────

function resolutionToMs(resolution: string): number {
  const n = parseInt(resolution, 10);
  if (resolution.endsWith('m')) return n * 60_000;
  if (resolution.endsWith('h')) return n * 60 * 60_000;
  if (resolution.endsWith('d')) return n * 24 * 60 * 60_000;
  return 5 * 60_000;
}

function candleTimeMs(time: number): number {
  return time < 1_000_000_000_000 ? time * 1000 : time;
}

/**
 * Filter out unclosed candles (masih forming) — ported from bravonoid.
 * Candle dianggap closed jika startTime + intervalDuration <= now.
 */
export function closedCandlesOnly(klines: GmgnKline[], resolution: string, now = Date.now()): GmgnKline[] {
  const durationMs = resolutionToMs(resolution);
  return klines.filter((c) => {
    const startMs = candleTimeMs(c.time);
    return startMs + durationMs <= now;
  });
}

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

// ─── Serial request queue with 750ms min gap (bravonoid pattern) ───────────

const MIN_REQUEST_GAP_MS = 750;
let lastRequestTime = 0;
let requestChain = Promise.resolve();

async function acquireSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_GAP_MS) {
    const waitMs = MIN_REQUEST_GAP_MS - elapsed;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastRequestTime = Date.now();
}

function releaseSlot(): void {
  // No-op under serial queue — gap is enforced pre-request
}

export function setConcurrencyLimit(_n: number): void {
  // Ignored — bravonoid pattern uses serial queue with min gap
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
  limit = 200
): Promise<GmgnKline[]> {
  const cacheKey = `kline:${mint}:${resolution}`;
  const cached = cacheGet<GmgnKline[]>(cacheKey);
  if (cached) return cached;

  const now = Math.floor(Date.now() / 1000);
  const lookbackSec = resolution.endsWith('m')
    ? parseInt(resolution, 10) * limit * 60 * 2
    : resolution.endsWith('h')
      ? parseInt(resolution, 10) * limit * 60 * 60 * 2
      : 24 * 60 * 60;
  const from = now - lookbackSec;

  await acquireSlot();
  try {
    const raw = execGmgn([
      'market', 'kline',
      '--chain', 'sol',
      '--address', mint,
      '--resolution', resolution,
      '--from', String(Math.max(from, 0)),
      '--to', String(now),
      '--raw',
    ]);
    const data = parseJson<{ data?: { list?: GmgnKline[] } }>(raw, 'kline');
    const klines = data.data?.list ?? [];
    const closedKlines = closedCandlesOnly(klines, resolution);
    cacheSet(cacheKey, closedKlines, 60_000); // cache 1 menit
    return closedKlines;
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
  const cacheKey = `token:info:${mint}`;
  const cached = cacheGet<GmgnTokenInfo | null>(cacheKey);
  if (cached !== null) return cached;

  await acquireSlot();
  try {
    const raw = execGmgn(['token', 'info', '--chain', 'sol', '--address', mint, '--raw']);
    const data = parseJson<{ data?: GmgnTokenInfo }>(raw, 'token info');
    const result = data.data ?? null;
    cacheSet(cacheKey, result, 300_000); // cache 5 menit
    return result;
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
  const cacheKey = `token:security:${mint}`;
  const cached = cacheGet<GmgnTokenSecurity | null>(cacheKey);
  if (cached !== null) return cached;

  await acquireSlot();
  try {
    const raw = execGmgn(['token', 'security', '--chain', 'sol', '--address', mint, '--raw']);
    const data = parseJson<{ data?: GmgnTokenSecurity }>(raw, 'token security');
    const result = data.data ?? null;
    cacheSet(cacheKey, result, 300_000); // cache 5 menit
    return result;
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
    const data = parseJson<{ data?: { rank?: GmgnTrending[] } }>(raw, 'trending');
    return data.data?.rank ?? [];
  } catch {
    return [];
  } finally {
    releaseSlot();
  }
}

// ─── Direct GMGN API — Token fee in SOL ───────────────────────────────────

/**
 * Fetch token fee in SOL langsung dari GMGN REST API.
 * Mengikuti pola dari bravonoid: cari pool_fees_sol di pool data,
 * fallback ke total_fees_sol di token level.
 * 
 * GMGN API: GET /v1/token/info?chain=sol&address=<mint>
 * Requires GMGN_API_KEY env var.
 */
export async function getTokenFeesSol(mint: string): Promise<{ feeSol: number | null; source: string | null }> {
  const cacheKey = `token:fees:${mint}`;
  const cached = cacheGet<{ feeSol: number | null; source: string | null }>(cacheKey);
  if (cached !== null) return cached;

  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) {
    return { feeSol: null, source: 'no_api_key' };
  }

  let result: { feeSol: number | null; source: string | null } = { feeSol: null, source: 'unknown' };

  try {
    const res = await fetch(`${GMGN_API_BASE}/v1/token/info?chain=sol&address=${mint}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      result = { feeSol: null, source: `http_${res.status}` };
    } else {
      const json: any = await res.json();
      const info = json?.data ?? json;

      const poolFee = info?.pool_fees_sol ?? info?.poolFeesSol ?? null;
      if (poolFee != null) {
        result = { feeSol: Number(poolFee), source: 'pool' };
      } else {
        const totalFee = info?.total_fees_sol ?? info?.totalFeesSol ?? info?.total_fee ?? info?.totalFee ?? null;
        if (totalFee != null) {
          result = { feeSol: Number(totalFee), source: 'total' };
        } else {
          const genericFee = info?.fees_sol ?? info?.feesSol ?? info?.fee_sol ?? info?.feeSol ?? null;
          if (genericFee != null) {
            result = { feeSol: Number(genericFee), source: 'generic' };
          } else if (Array.isArray(info?.pools)) {
            let found = false;
            for (const pool of info.pools) {
              const pf = pool?.pool_fees_sol ?? pool?.poolFeesSol ?? null;
              if (pf != null) {
                result = { feeSol: Number(pf), source: 'pool' };
                found = true;
                break;
              }
            }
            if (!found) result = { feeSol: null, source: 'not_found' };
          } else {
            result = { feeSol: null, source: 'not_found' };
          }
        }
      }
    }
  } catch {
    result = { feeSol: null, source: 'fetch_failed' };
  }

  cacheSet(cacheKey, result, 300_000); // cache 5 menit
  return result;
}

export { RateLimitError };