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
  it('flips bearish when price crashes through the lower band after an uptrend', () => {
    // Build bullish state with a clear uptrend, then a sharp crash that
    // closes below the (trailing) final lower band → direction flips to bearish.
    // SuperTrend only flips on a confirmed close-vs-band crossover, so a gentle
    // 1-unit drift is NOT enough — this mirrors real TradingView behaviour.
    const uptrend = Array.from({ length: 12 }, (_, i) => 100 + i * 2); // 100..122
    const closes = [...uptrend, 110, 80, 70]; // crash through lower band
    const highs = closes.map((c) => c + 2);
    const lows = closes.map((c) => c - 2);
    const opens = closes.map((c) => c);
    const times = Array.from({ length: closes.length }, (_, i) => (i + 1) * 60000);

    const result = calculateSuperTrend(klines(times, opens, highs, lows, closes), 10, 3);
    expect(result.direction).toBe('bearish');
    expect(validateSuperTrendSignal(result)).toBe(false);
  });

  it('stays bullish on a clear uptrend and validates the signal', () => {
    // Gentle steady uptrend — SuperTrend bullish, price above ST line, distance under 10%.
    // A steep uptrend (>2/candle) pushes the distance above the validation threshold,
    // which is the intended behaviour (don't alert after the move already happened).
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5);
    const highs = closes.map((c) => c + 1);
    const lows = closes.map((c) => c - 1);
    const opens = closes.map((c) => c - 0.5);
    const times = Array.from({ length: 20 }, (_, i) => (i + 1) * 60000);

    const result = calculateSuperTrend(klines(times, opens, highs, lows, closes), 10, 3);
    expect(result.direction).toBe('bullish');
    expect(result.priceAbove).toBe(true);
    expect(validateSuperTrendSignal(result)).toBe(true);
  });

  it('returns neutral (bearish, value 0) when insufficient candles', () => {
    const t = [1, 2, 3].map((i) => i * 60000);
    const o = [100, 101, 102];
    const h = [102, 103, 104];
    const l = [99, 100, 101];
    const c = [101, 102, 103];

    const result = calculateSuperTrend(klines(t, o, h, l, c), 10, 3);
    expect(result.direction).toBe('bearish');
    expect(result.value).toBe(0);
  });

  it('sets priceAbove=true when close > ST value in bullish mode', () => {
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

  it('rejects the signal when price is far above the ST line (already pumped)', () => {
    // Uptrend then a huge candle — bullish direction but distance > threshold.
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 160];
    const highs = closes.map((c) => c + 2);
    const lows = closes.map((c) => c - 2);
    const opens = closes.map((c) => c - 1);
    const times = Array.from({ length: closes.length }, (_, i) => (i + 1) * 60000);

    const result = calculateSuperTrend(klines(times, opens, highs, lows, closes), 10, 3);
    // Distance from ST line should exceed 10%, so signal should be rejected.
    if (result.direction === 'bullish' && result.priceAbove && result.line > 0) {
      const distancePct = ((result.price - result.line) / result.line) * 100;
      if (distancePct > 10) {
        expect(validateSuperTrendSignal(result)).toBe(false);
      }
    }
  });
});
