import { GmgnKline, StochRSIResult } from '../types';

/**
 * Relative Strength Index using Wilder's smoothing.
 * @returns RSI values array, one per candle after the first `period` candles
 */
function calculateRSI(klines: GmgnKline[], period: number): number[] {
  if (klines.length < period + 1) return [];

  const changes: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    changes.push(klines[i].close - klines[i - 1].close);
  }

  // First RSI: simple average
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const rsiValues: number[] = [];
  rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // Subsequent RSI: Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    rsiValues.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }

  return rsiValues;
}

/**
 * Calculate Stochastic RSI.
 *
 * Formula:
 *   StochRSI_K = (RSI - min_RSI) / (max_RSI - min_RSI) × 100
 *   %K = SMA(StochRSI_K, smoothK)    [TradingView applies SMA smoothK to raw %K]
 *   %D = SMA(%K, dPeriod)
 *   Bullish cross = prior %K ≤ prior %D AND current %K > current %D
 *
 * @param klines     OHLCV candles, oldest first
 * @param rsiPeriod  RSI lookback period (default: 14)
 * @param kPeriod    Stochastic %K lookback (default: 14)
 * @param dPeriod    %D smoothing period (default: 14)
 * @param smoothK    Additional smoothing for %K (default: 3 — TradingView default)
 */
export function calculateStochRSI(
  klines: GmgnKline[],
  rsiPeriod = 14,
  kPeriod = 14,
  dPeriod = 14,
  smoothK = 3
): StochRSIResult {
  const rsiValues = calculateRSI(klines, rsiPeriod);

  if (rsiValues.length < kPeriod + dPeriod + smoothK - 2) {
    return { k: 0, d: 0, crossedAbove: false, overbought: false };
  }

  // Raw StochRSI %K for each RSI value in the rolling window
  const rawKValues: number[] = [];
  for (let i = kPeriod - 1; i < rsiValues.length; i++) {
    const window = rsiValues.slice(i - kPeriod + 1, i + 1);
    const minRSI = Math.min(...window);
    const maxRSI = Math.max(...window);
    const rsi = rsiValues[i];
    rawKValues.push(maxRSI === minRSI ? 50 : ((rsi - minRSI) / (maxRSI - minRSI)) * 100);
  }

  // Smooth raw %K with SMA(smoothK) — TradingView convention
  const kValues: number[] = [];
  for (let i = smoothK - 1; i < rawKValues.length; i++) {
    const window = rawKValues.slice(i - smoothK + 1, i + 1);
    kValues.push(window.reduce((s, v) => s + v, 0) / smoothK);
  }

  if (kValues.length < dPeriod) {
    return { k: 0, d: 0, crossedAbove: false, overbought: false };
  }

  // %D = SMA(%K, dPeriod)
  const dValues: number[] = [];
  for (let i = dPeriod - 1; i < kValues.length; i++) {
    const window = kValues.slice(i - dPeriod + 1, i + 1);
    dValues.push(window.reduce((s, v) => s + v, 0) / dPeriod);
  }

  const curK = kValues[kValues.length - 1];
  const curD = dValues[dValues.length - 1];
  const prevK = kValues.length > 1 ? kValues[kValues.length - 2] : curK;
  const prevD = dValues.length > 1 ? dValues[dValues.length - 2] : curD;

  const crossedAbove = prevK <= prevD && curK > curD;
  const overbought = curK >= 80;

  return { k: curK, d: curD, crossedAbove, overbought };
}

/**
 * Valid signal: %K crossed above %D AND %K < 80 (not overbought).
 */
export function validateStochRSISignal(result: StochRSIResult): boolean {
  return result.crossedAbove && !result.overbought;
}

export default { calculateRSI, calculateStochRSI, validateStochRSISignal };