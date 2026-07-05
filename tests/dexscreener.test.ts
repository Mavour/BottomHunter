import { getTokenVolume24h } from '../src/adapters/dexscreener';
import { cacheClear } from '../src/cache';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('getTokenVolume24h', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    cacheClear();
  });

  it('returns volume from pair with highest liquidity when multiple pairs exist', async () => {
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

    const vol = await getTokenVolume24h('test-mint');
    expect(vol).toBe(5000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null on 404 without throwing', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const vol = await getTokenVolume24h('test-mint-404');
    expect(vol).toBeNull();
  });

  it('returns null on empty pairs without throwing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ pairs: [] }),
    });

    const vol = await getTokenVolume24h('empty-pairs');
    expect(vol).toBeNull();
  });

  it('uses cache within 60s, only fetches once', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        pairs: [{ volume: { h24: 10000 }, liquidity: { usd: 100000 } }],
      }),
    });

    const vol1 = await getTokenVolume24h('cached-mint');
    expect(vol1).toBe(10000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const vol2 = await getTokenVolume24h('cached-mint');
    expect(vol2).toBe(10000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429 and returns null if retry also 429', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    const vol = await getTokenVolume24h('rate-limited');
    expect(vol).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
