import { cacheGet, cacheSet } from '../cache';

// vol24h dari DexScreener — field Meteora terbukti salah label, lihat: CHANCE $5356 vs real $1.8M
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

export async function getTokenVolume24h(mint: string): Promise<number | null> {
  const cacheKey = `dexscreener:vol24h:${mint}`;
  const cached = cacheGet<number>(cacheKey);
  if (cached !== null) return cached;

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

      if (bestVol > 0) cacheSet(cacheKey, bestVol, 60_000);
      return bestVol > 0 ? bestVol : null;
    } catch {
      return null;
    }
  }

  return null;
}
