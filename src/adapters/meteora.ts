const POOL_DISCOVERY_BASE = 'https://pool-discovery-api.datapi.meteora.ag';

export interface MeteoraPool {
  pool: string;
  name: string;
  base: { symbol: string; mint: string; organic: number; warnings: number };
  quote: { symbol: string; mint: string };
  pool_type: string;
  bin_step: number | null;
  active_tvl: number;
  volume_window: number;
  mcap: number;
  holders: number;
  price: number;
  price_change_pct: number;
  token_age_hours: number | null;
}

interface RawPool {
  pool_address: string;
  name: string;
  token_x: { symbol: string; address: string; organic_score?: number; warnings?: string[]; market_cap?: number; created_at?: number };
  token_y: { symbol: string; address: string };
  pool_type: string;
  dlmm_params?: { bin_step?: number };
  active_tvl: number;
  volume: number;
  base_token_holders?: number;
  pool_price?: number;
  pool_price_change_pct?: number;
}

function condense(p: RawPool): MeteoraPool {
  return {
    pool: p.pool_address,
    name: p.name,
    base: {
      symbol: p.token_x?.symbol ?? '',
      mint: p.token_x?.address ?? '',
      organic: Math.round(p.token_x?.organic_score ?? 0),
      warnings: p.token_x?.warnings?.length ?? 0,
    },
    quote: {
      symbol: p.token_y?.symbol ?? '',
      mint: p.token_y?.address ?? '',
    },
    pool_type: p.pool_type,
    bin_step: p.dlmm_params?.bin_step ?? null,
    active_tvl: Math.round(p.active_tvl),
    volume_window: Math.round(p.volume),
    mcap: Math.round(p.token_x?.market_cap ?? 0),
    holders: p.base_token_holders ?? 0,
    price: p.pool_price ?? 0,
    price_change_pct: p.pool_price_change_pct ?? 0,
    token_age_hours: p.token_x?.created_at
      ? Math.floor((Date.now() - p.token_x.created_at) / 3_600_000)
      : null,
  };
}

/**
 * Cari pool dari Meteora dengan filter mcap range.
 * Server-side filtering, jadi cuma return pool yang memenuhi.
 */
export async function discoverPools(minMcap: number, maxMcap = 100_000_000, pageSize = 10): Promise<MeteoraPool[]> {
  const filters = [
    'base_token_has_critical_warnings=false',
    'quote_token_has_critical_warnings=false',
    'base_token_has_high_single_ownership=false',
    'pool_type=dlmm',
    `base_token_market_cap>=${minMcap}`,
    `base_token_market_cap<=${maxMcap}`,
    'base_token_organic_score>=60',
    'quote_token_organic_score>=60',
  ].join('&&');

  const url = `${POOL_DISCOVERY_BASE}/pools?page_size=${pageSize}&filter_by=${encodeURIComponent(filters)}&timeframe=5m&category=trending`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.log(`[METEORA] API error: ${res.status}`);
      return [];
    }
  } catch {
    console.log('[METEORA] Fetch failed');
    return [];
  }

  const data: any = await res.json();
  const rawPools: RawPool[] = data?.data ?? [];
  return rawPools.map(condense);
}
