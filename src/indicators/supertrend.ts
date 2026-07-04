import { GmgnKline, SuperTrendResult } from '../types';

function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * SuperTrend full array-based dengan band carry-over (TradingView-style).
 * Ported from bravonoid tools/chart-indicators.js calcSupertrend()
 */
export function calculateSuperTrend(
  klines: GmgnKline[],
  period = 10,
  multiplier = 3
): SuperTrendResult {
  if (klines.length < period + 1) {
    return { value: 0, direction: 'bearish', priceAbove: false, price: 0, line: 0 };
  }

  const len = klines.length;

  // True Range
  const tr = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    tr[i] = trueRange(klines[i].high, klines[i].low, klines[i - 1].close);
  }

  // ATR — Wilder's smoothing
  const atr = new Array(len).fill(0);
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;
  for (let i = period + 1; i < len; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  // Bands + directions + values
  const upperBand = new Array(len).fill(0);
  const lowerBand = new Array(len).fill(0);
  const directions = new Array<'bullish' | 'bearish'>(len).fill('bullish');
  const values = new Array(len).fill(0);

  for (let i = period; i < len; i++) {
    const hl2 = (klines[i].high + klines[i].low) / 2;
    const basicUpper = hl2 + multiplier * atr[i];
    const basicLower = hl2 - multiplier * atr[i];

    if (i === period) {
      upperBand[i] = basicUpper;
      lowerBand[i] = basicLower;
      directions[i] = klines[i].close <= basicLower ? 'bearish' : 'bullish';
      values[i] = directions[i] === 'bullish' ? lowerBand[i] : upperBand[i];
      continue;
    }

    const prevClose = klines[i - 1].close;

    // Band carry-over
    if (basicUpper < upperBand[i - 1] || prevClose > upperBand[i - 1]) {
      upperBand[i] = basicUpper;
    } else {
      upperBand[i] = upperBand[i - 1];
    }

    if (basicLower > lowerBand[i - 1] || prevClose < lowerBand[i - 1]) {
      lowerBand[i] = basicLower;
    } else {
      lowerBand[i] = lowerBand[i - 1];
    }

    // Direction — only changes when price crosses prior band
    const prevDir = directions[i - 1];
    const close = klines[i].close;
    if (prevDir === 'bearish' && close >= upperBand[i - 1]) {
      directions[i] = 'bullish';
    } else if (prevDir === 'bullish' && close <= lowerBand[i - 1]) {
      directions[i] = 'bearish';
    } else {
      directions[i] = prevDir;
    }
    values[i] = directions[i] === 'bullish' ? lowerBand[i] : upperBand[i];
  }

  const last = len - 1;
  const direction = directions[last];
  const stValue = values[last];

  return {
    value: stValue,
    direction,
    priceAbove: klines[last].close > stValue,
    price: klines[last].close,
    line: stValue,
  };
}

/**
 * Valid signal: SuperTrend bullish AND price near ST line (within 5%).
 */
export function validateSuperTrendSignal(result: SuperTrendResult): boolean {
  if (result.direction !== 'bullish' || !result.priceAbove) return false;
  const distancePercent = ((result.price - result.line) / result.line) * 100;
  return distancePercent <= 5;
}

export default { calculateSuperTrend, validateSuperTrendSignal };