import { GmgnKline } from '../types';

// ─── EMA Result Types ───────────────────────────────────────────────────────

export interface EMALevel {
  period: number;
  value: number;
}

export interface EMAResult {
  ema25: number;
  ema50: number;
  ema100: number;
  ema200: number;
  currentPrice: number;
  nearEmaLevel: EMALevel | null;  // closest EMA level that price is near
  supportZone: boolean;           // price near support (at or below EMA)
}

// ─── EMA Calculation ────────────────────────────────────────────────────────

/**
 * Calculate EMA (Exponential Moving Average)
 * Using Wilder's smoothing method (standard for EMA)
 */
export function calculateEMA(klines: GmgnKline[], period: number): number[] {
  if (klines.length < period) return [];

  const emaValues: number[] = [];
  const multiplier = 2 / (period + 1);

  // First EMA is SMA of first `period` candles
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += klines[i].close;
  }
  let ema = sum / period;
  emaValues.push(ema);

  // Subsequent EMAs use multiplier
  for (let i = period; i < klines.length; i++) {
    ema = (klines[i].close - ema) * multiplier + ema;
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Calculate all EMA levels (25, 50, 100, 200)
 */
export function calculateAllEMAs(klines: GmgnKline[]): EMAResult {
  if (klines.length < 200) {
    return {
      ema25: 0,
      ema50: 0,
      ema100: 0,
      ema200: 0,
      currentPrice: klines.length > 0 ? klines[klines.length - 1].close : 0,
      nearEmaLevel: null,
      supportZone: false,
    };
  }

  const ema25Values = calculateEMA(klines, 25);
  const ema50Values = calculateEMA(klines, 50);
  const ema100Values = calculateEMA(klines, 100);
  const ema200Values = calculateEMA(klines, 200);

  const ema25 = ema25Values[ema25Values.length - 1] || 0;
  const ema50 = ema50Values[ema50Values.length - 1] || 0;
  const ema100 = ema100Values[ema100Values.length - 1] || 0;
  const ema200 = ema200Values[ema200Values.length - 1] || 0;
  const currentPrice = klines[klines.length - 1].close;

  // Find nearest EMA level (support zone)
  const levels: EMALevel[] = [
    { period: 25, value: ema25 },
    { period: 50, value: ema50 },
    { period: 100, value: ema100 },
    { period: 200, value: ema200 },
  ];

  let nearestLevel: EMALevel | null = null;
  let minDistance = Infinity;

  for (const level of levels) {
    if (level.value > 0) {
      const distance = Math.abs(currentPrice - level.value);
      if (distance < minDistance) {
        minDistance = distance;
        nearestLevel = level;
      }
    }
  }

  // Support zone: price is within 2% of an EMA level or below it
  const supportZone = nearestLevel
    ? (currentPrice <= nearestLevel.value * 1.02)
    : false;

  return {
    ema25,
    ema50,
    ema100,
    ema200,
    currentPrice,
    nearEmaLevel: nearestLevel,
    supportZone,
  };
}

/**
 * Validate EMA signal
 * Returns true if price is near support zone (near or below EMA levels)
 * This is used as an alternative to SuperTrend for bullish bounce detection
 */
export function validateEMASignal(ema: EMAResult): boolean {
  // Must have valid data
  if (ema.ema25 === 0 || ema.ema50 === 0) return false;

  // Support zone detected: price near or below EMA levels
  return ema.supportZone;
}
