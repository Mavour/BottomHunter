import { GmgnKline, SuperTrendResult } from '../types';

/**
 * Wilder's Relative Moving Average
 * Same smoothing method as TradingView's built-in ATR
 */
function rma(values: number[], period: number): number {
  if (values.length < period) return 0;
  let avg = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    avg = (avg * (period - 1) + values[i]) / period;
  }
  return avg;
}

/**
 * True Range — max of:
 *   1. high - low
 *   2. |high - prevClose|
 *   3. |low - prevClose|
 */
function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * Calculate SuperTrend indicator.
 *
 * Reference: Mavour/meridian/tools/chart-indicators.js calcSupertrend()
 *
 * Formula:
 *   hl2     = (high + low) / 2
 *   ATR     = rma(true_range, period)
 *   lower   = hl2 - multiplier × ATR
 *   upper   = hl2 + multiplier × ATR
 *   prevLower = prev_hl2 - multiplier × ATR
 *   direction = close > prevLower ? bullish : bearish
 *   value     = direction === bullish ? lower : upper
 *
 * @param klines  OHLCV candles, oldest first (min length: period + 1)
 * @param period  ATR period (default: 10)
 * @param multiplier  ATR multiplier (default: 3)
 */
export function calculateSuperTrend(
  klines: GmgnKline[],
  period = 10,
  multiplier = 3
): SuperTrendResult {
  if (klines.length < period + 1) {
    return { value: 0, direction: 'bearish', priceAbove: false, price: 0, line: 0 };
  }

  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);

  // Build True Range series
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    trs.push(trueRange(highs[i], lows[i], closes[i - 1]));
  }

  // ATR via Wilder's smoothing
  const atr = rma(trs, period);

  const lastIdx = klines.length - 1;
  const prevIdx = lastIdx - 1;

  const hl2 = (highs[lastIdx] + lows[lastIdx]) / 2;
  const prevHl2 = (highs[prevIdx] + lows[prevIdx]) / 2;
  const close = closes[lastIdx];
  const prevClose = closes[prevIdx];

  const lower = hl2 - multiplier * atr;
  const upper = hl2 + multiplier * atr;
  const prevLower = prevHl2 - multiplier * atr;

  const direction: 'bullish' | 'bearish' = close > prevLower ? 'bullish' : 'bearish';
  const stValue = direction === 'bullish' ? lower : upper;

  return {
    value: stValue,
    direction,
    priceAbove: close > stValue,
    price: close,
    line: stValue,
  };
}

/**
 * Valid signal: SuperTrend is bullish AND price is near/reclaimed the ST line (not too far above).
 * Price should be within 5% above the ST line to be considered "near bottom".
 */
export function validateSuperTrendSignal(result: SuperTrendResult): boolean {
  if (result.direction !== 'bullish' || !result.priceAbove) return false;

  // Check if price is near the ST line (within 5% above)
  // This ensures we're catching dips near support, not pumps far above
  const distancePercent = ((result.price - result.line) / result.line) * 100;
  return distancePercent <= 5;
}

export default { calculateSuperTrend, validateSuperTrendSignal };