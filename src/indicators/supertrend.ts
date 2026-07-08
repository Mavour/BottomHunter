import { GmgnKline, SuperTrendResult } from '../types';

function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/**
 * SuperTrend (TradingView Pine Script reference implementation).
 *
 * Formula:
 *   atr   = Wilder's RMA(true_range, period)
 *   hl2   = (high + low) / 2
 *   up    = hl2 + multiplier * atr      (basic upper band)
 *   dn    = hl2 - multiplier * atr      (basic lower band)
 *   finalUpper[i] = (up < finalUpper[i-1] OR close[i-1] > finalUpper[i-1]) ? up : finalUpper[i-1]
 *   finalLower[i] = (dn > finalLower[i-1] OR close[i-1] < finalLower[i-1]) ? dn : finalLower[i-1]
 *
 *   Direction (only flips on confirmed close-vs-band crossover):
 *     prevBear AND close > finalUpper[i-1]  → bullish
 *     prevBull AND close < finalLower[i-1]  → bearish
 *     else                                  → keep prev direction
 *   SuperTrend line = bullish ? finalLower : finalUpper
 *
 * The previous implementation initialised direction on the first candle using
 * only `close <= basicLower`, which is almost never true under normal ATR — so
 * SuperTrend got stuck bullish through real downtrends and emitted false
 * bullish signals. This version seeds direction by comparing close against
 * BOTH basic bands, matching TradingView behaviour.
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

  // True Range (index 0 is undefined → 0)
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

  // Final bands (with carry-over) + direction + SuperTrend line
  const upperBand = new Array(len).fill(0);
  const lowerBand = new Array(len).fill(0);
  const directions = new Array<'bullish' | 'bearish'>(len).fill('bullish');
  const values = new Array(len).fill(0);

  for (let i = period; i < len; i++) {
    const hl2 = (klines[i].high + klines[i].low) / 2;
    const basicUpper = hl2 + multiplier * atr[i];
    const basicLower = hl2 - multiplier * atr[i];

    if (i === period) {
      // Seed bands with their basic values.
      upperBand[i] = basicUpper;
      lowerBand[i] = basicLower;
      // Seed direction using BOTH bands (TradingView: start trend from where
      // price sits relative to the seeded bands).
      directions[i] = klines[i].close >= basicUpper
        ? 'bullish'
        : klines[i].close <= basicLower
          ? 'bearish'
          : 'bullish';
      values[i] = directions[i] === 'bullish' ? lowerBand[i] : upperBand[i];
      continue;
    }

    const prevClose = klines[i - 1].close;

    // Band carry-over (TradingView final upper/lower)
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

    // Direction — only flips on a confirmed close crossover of the prior band
    const prevDir = directions[i - 1];
    const close = klines[i].close;
    if (prevDir === 'bearish' && close > upperBand[i - 1]) {
      directions[i] = 'bullish';
    } else if (prevDir === 'bullish' && close < lowerBand[i - 1]) {
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
 * Valid signal: SuperTrend bullish AND price reclaimed the ST line.
 * Price must be above the ST line AND not more than `maxDistancePercent`
 * above it (avoid alerting after the move already happened).
 * Default 10% — recoveries routinely exceed the old 5% threshold.
 */
const ST_MAX_DISTANCE_PERCENT = 10;

export function validateSuperTrendSignal(result: SuperTrendResult): boolean {
  if (result.direction !== 'bullish' || !result.priceAbove) return false;
  if (result.line <= 0) return false;
  const distancePercent = ((result.price - result.line) / result.line) * 100;
  return distancePercent <= ST_MAX_DISTANCE_PERCENT;
}

export default { calculateSuperTrend, validateSuperTrendSignal };