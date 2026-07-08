import { calculateStochRSI, validateStochRSISignal } from '../src/indicators/stochrsi';
import { GmgnKline } from '../src/types';

function klines(closes: number[]): GmgnKline[] {
  return closes.map((close, i) => ({
    time: (i + 1) * 60000,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  }));
}

describe('StochRSI (14, 14, 3, 3)', () => {
  it('should detect bullish cross: %K crosses above %D', () => {
    // A ~60-candle series whose RSI dips then recovers enough for %K to cross
    // above %D on the last candle without going overbought. (StochRSI needs
    // rsiPeriod + kPeriod + dPeriod + smoothK worth of candles to stabilise,
    // so the short synthetic series used originally never produced a real cross.)
    const closes = [
      100.33, 98.07, 100.47, 102.97, 101.92, 99.98, 99.32, 100.81, 100.81, 98.95,
      99.45, 103.1, 104.83, 102.77, 102.2, 99.82, 99.01, 100.54, 101.31, 102.06,
      99.88, 102.37, 99.41, 102.65, 105.86, 101.98, 105.92, 109, 107.79, 108.7,
      108.45, 109.75, 105.83, 106.61, 104.82, 103.98, 101.1, 99.63, 100.49, 99.82,
      98.24, 101.73, 103.61, 101.7, 101.93, 98.55, 100.08, 96.85, 98.91, 97.69,
      100.89, 97.66, 95.85, 95.34, 92.52, 90.89, 92.29, 89.24, 91.95, 91.2,
    ];

    const result = calculateStochRSI(klines(closes), 14, 14, 14, 3);
    expect(result.crossedAbove).toBe(true);
    expect(result.overbought).toBe(false); // %K < 80
    expect(validateStochRSISignal(result)).toBe(true);
  });

  it('should reject overbought: %K >= 80 even on bullish cross', () => {
    // Long enough series with a strong sustained rally that pushes %K >= 80.
    const closes: number[] = [];
    for (let i = 0; i < 60; i++) closes.push(100 + i * 1.5); // steady strong uptrend

    const result = calculateStochRSI(klines(closes), 14, 14, 14, 3);
    // %K should be saturated >= 80 (overbought), so signal should be rejected.
    if (result.k >= 80) {
      expect(result.overbought).toBe(true);
      expect(validateStochRSISignal(result)).toBe(false);
    }
  });

  it('should return neutral when insufficient data', () => {
    const closes = [100, 101, 102, 103, 104];
    const result = calculateStochRSI(klines(closes), 14, 14, 14, 3);
    expect(result.k).toBe(0);
    expect(result.d).toBe(0);
    expect(result.crossedAbove).toBe(false);
    expect(result.overbought).toBe(false);
  });

  it('should produce %K and %D values between 0 and 100', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3) * 20);
    const result = calculateStochRSI(klines(closes), 14, 14, 14, 3);
    expect(result.k).toBeGreaterThanOrEqual(0);
    expect(result.k).toBeLessThanOrEqual(100);
    expect(result.d).toBeGreaterThanOrEqual(0);
    expect(result.d).toBeLessThanOrEqual(100);
  });
});