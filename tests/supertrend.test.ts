import { calculateSuperTrend, validateSuperTrendSignal } from '../src/indicators/supertrend';
import { GmgnKline } from '../src/types';

/** Helper: build a simple list of klines from arrays */
function klines(times: number[], opens: number[], highs: number[], lows: number[], closes: number[]): GmgnKline[] {
  return times.map((time, i) => ({
    time,
    open: opens[i],
    high: highs[i],
    low: lows[i],
    close: closes[i],
    volume: 1000,
  }));
}

describe('SuperTrend (10, 3)', () => {
  it('should return bearish when close < prevLower (downtrend)', () => {
    // Steady downtrend — no recovery above prevLower
    const t = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => i * 60000);
    const o = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86];
    const h = [101, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87];
    const l = [98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85, 84];
    const c = [99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 86];

    const result = calculateSuperTrend(klines(t, o, h, l, c), 10, 3);
    expect(result.direction).toBe('bearish');
    expect(validateSuperTrendSignal(result)).toBe(false);
  });

  it('should return bullish when close > prevLower (upward breakout)', () => {
    // Downtrend then strong push above prevLower on last candle
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, // bearish phase
                    92, 93, 94, 95, 96]; // recovery
    const highs = closes.map((c, i) => c + 1.5);
    const lows = closes.map((c, i) => c - 1.5);
    const opens = closes.map((c) => c - 0.5);
    const times = Array.from({ length: 15 }, (_, i) => (i + 1) * 60000);

    const result = calculateSuperTrend(klines(times, opens, highs, lows, closes), 10, 3);
    expect(result.direction).toBe('bullish');
    expect(result.priceAbove).toBe(true);
    expect(validateSuperTrendSignal(result)).toBe(true);
  });

  it('should return neutral (bearish) when insufficient candles', () => {
    const t = [1, 2, 3].map((i) => i * 60000);
    const o = [100, 101, 102];
    const h = [102, 103, 104];
    const l = [99, 100, 101];
    const c = [101, 102, 103];

    const result = calculateSuperTrend(klines(t, o, h, l, c), 10, 3);
    expect(result.direction).toBe('bearish');
    expect(result.value).toBe(0);
  });

  it('should set priceAbove=true when close > ST value in bullish mode', () => {
    // Clear uptrend
    const closes = Array.from({ length: 15 }, (_, i) => 100 + i * 2);
    const highs = closes.map((c) => c + 2);
    const lows = closes.map((c) => c - 2);
    const opens = closes.map((c) => c - 1);
    const times = Array.from({ length: 15 }, (_, i) => (i + 1) * 60000);

    const result = calculateSuperTrend(klines(times, opens, highs, lows, closes), 10, 3);
    expect(result.direction).toBe('bullish');
    expect(result.priceAbove).toBe(true);
    expect(result.price).toBeGreaterThan(result.line);
  });
});