import { cacheGet, cacheSet } from '../cache';

// DexScreener sumber UTAMA vol24h DAN liquidity — field Meteora terbukti salah label
// lihat: CHANCE vol $5356 vs real $1.8M, liq $17 vs real $225.5K
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

interface DexScreenerMarketData {
  volume24h: number;
  liquidityUsd: number;
}

async function fetchMarketData(mint: string): Promise<DexScreenerMarketData | null> {
  const url = `${DEXSCREENER_API}/${mint}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

      if (res.status === 429) {
        if (attempt === 1) {
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
          continue;
        }
        return null;
      }

      if (!res.ok) return null;

      const data: any = await res.json();
      const pairs: any[] = data?.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) return null;

      let bestVol = 0;
      let bestLiq = -1;
      for (const p of pairs) {
        const liq = p?.liquidity?.usd ?? 0;
        const vol = p?.volume?.h24 ?? 0;
        if (liq > bestLiq) {
          bestLiq = liq;
          bestVol = vol;
        }
      }

      if (bestLiq <= 0 && bestVol <= 0) return null;
      return { volume24h: bestVol, liquidityUsd: bestLiq };
    } catch {
      return null;
    }
  }

  return null;
}

export async function getDexScreenerMarketData(mint: string): Promise<DexScreenerMarketData | null> {
  const cacheKey = `dexscreener:market:${mint}`;
  const cached = cacheGet<DexScreenerMarketData>(cacheKey);
  if (cached !== null) return cached;

  const result = await fetchMarketData(mint);
  if (result !== null) cacheSet(cacheKey, result, 60_000);
  return result;
}

export async function getTokenVolume24h(mint: string): Promise<number | null> {
  const data = await getDexScreenerMarketData(mint);
  return data?.volume24h ?? null;
}
