import { getTokenVolume24h, getDexScreenerMarketData } from '../src/adapters/dexscreener';
import { cacheClear } from '../src/cache';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('getDexScreenerMarketData', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cacheClear();
  });

  it('returns volume+liquidity from pair with highest liquidity when multiple pairs exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [
          { volume: { h24: 1000 }, liquidity: { usd: 50000 } },
          { volume: { h24: 5000 }, liquidity: { usd: 200000 } },
          { volume: { h24: 2000 }, liquidity: { usd: 10000 } },
        ],
      }),
    });

    const data = await getDexScreenerMarketData('test-mint');
    expect(data).not.toBeNull();
    expect(data!.volume24h).toBe(5000);
    expect(data!.liquidityUsd).toBe(200000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on 404 without throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const data = await getDexScreenerMarketData('test-mint-404');
    expect(data).toBeNull();
  });

  it('returns null on empty pairs without throwing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ pairs: [] }),
    });

    const data = await getDexScreenerMarketData('empty-pairs');
    expect(data).toBeNull();
  });

  it('uses cache within 60s, only fetches once', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [{ volume: { h24: 10000 }, liquidity: { usd: 100000 } }],
      }),
    });

    const data1 = await getDexScreenerMarketData('cached-mint');
    expect(data1).not.toBeNull();
    expect(data1!.volume24h).toBe(10000);
    expect(data1!.liquidityUsd).toBe(100000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const data2 = await getDexScreenerMarketData('cached-mint');
    expect(data2).not.toBeNull();
    expect(data2!.volume24h).toBe(10000);
    expect(data2!.liquidityUsd).toBe(100000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429 and returns null if retry also 429', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    const data = await getDexScreenerMarketData('rate-limited');
    expect(data).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('getTokenVolume24h (wrapper)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cacheClear();
  });

  it('returns only volume from wrapped getDexScreenerMarketData', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [{ volume: { h24: 5000 }, liquidity: { usd: 200000 } }],
      }),
    });

    const vol = await getTokenVolume24h('test-wrapper');
    expect(vol).toBe(5000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when DexScreener returns null', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const vol = await getTokenVolume24h('test-wrapper-404');
    expect(vol).toBeNull();
  });
});
