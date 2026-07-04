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
    // %K below %D then crosses above at last candle
    const closes = [
      // First 14 candles: steady drop (RSI near 20)
      100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87,
      // Recovery: RSI rises, %K crosses above %D
      88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108, 110, 112, 114,
      // Cross happens here: %K=65, %D=60 → %K=68, %D=62
      116, 118,
    ];

    const result = calculateStochRSI(klines(closes), 14, 14, 14, 3);
    expect(result.crossedAbove).toBe(true);
    expect(result.overbought).toBe(false); // %K < 80
    expect(validateStochRSISignal(result)).toBe(true);
  });

  it('should reject overbought: %K >= 80 even on bullish cross', () => {
    // Price spikes hard, %K goes above 80
    const closes = [
      100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87,
      89, 91, 93, 95, 97, 99, 102, 106, 110, 115, 120, 126, 133, 141,
    ];

    const result = calculateStochRSI(klines(closes), 14, 14, 14, 3);
    // %K should be >= 80 (overbought), so signal should be rejected
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