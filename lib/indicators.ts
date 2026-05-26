// =============================================================================
// lib/indicators.ts — Pure TypeScript technical analysis library
// No side effects, no API calls, no imports beyond types.
// All functions return arrays aligned to the input length (leading nulls where
// the indicator needs a warm-up period).
// =============================================================================

import type { Candle } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[], avg?: number): number {
  const m = avg ?? mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// ---------------------------------------------------------------------------
// SMA — Simple Moving Average
// ---------------------------------------------------------------------------

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      const slice = values.slice(i - period + 1, i + 1);
      out.push(mean(slice));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// EMA — Exponential Moving Average
// ---------------------------------------------------------------------------

export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(period - 1).fill(null);

  // Seed with SMA of first `period` values
  const seed = mean(values.slice(0, period));
  out.push(seed);

  for (let i = period; i < values.length; i++) {
    const prev = out[i - 1] as number;
    out.push(values[i] * k + prev * (1 - k));
  }
  return out;
}

// ---------------------------------------------------------------------------
// WMA — Weighted Moving Average
// ---------------------------------------------------------------------------

export function wma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const weightSum = (period * (period + 1)) / 2;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      let weighted = 0;
      for (let j = 0; j < period; j++) {
        weighted += values[i - period + 1 + j] * (j + 1);
      }
      out.push(weighted / weightSum);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// RSI — Relative Strength Index (Wilder smoothing)
// ---------------------------------------------------------------------------

export function rsi(closes: number[], period = 14): (number | null)[] {
  if (closes.length < period + 1) return closes.map(() => null);

  const out: (number | null)[] = new Array(period).fill(null);

  // Seed: average gain/loss over first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  const calcRsi = (ag: number, al: number) =>
    al === 0 ? 100 : 100 - 100 / (1 + ag / al);

  out.push(calcRsi(avgGain, avgLoss));

  // Wilder smoothing from period+1 onward
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push(calcRsi(avgGain, avgLoss));
  }
  return out;
}

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);

  const macdLine: (number | null)[] = fastEma.map((f, i) => {
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });

  // Signal = EMA of MACD values (ignore leading nulls)
  const macdValues = macdLine.filter((v): v is number => v !== null);
  const signalRaw = ema(macdValues, signal);

  // Re-align signalLine to original length
  const leadingNulls = macdLine.findIndex((v) => v !== null) + (signal - 1);
  const signalLine: (number | null)[] = [
    ...new Array(leadingNulls).fill(null),
    ...signalRaw.filter((v): v is number => v !== null),
  ];

  const histogram: (number | null)[] = macdLine.map((m, i) => {
    const s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });

  return { macdLine, signalLine, histogram };
}

// ---------------------------------------------------------------------------
// KDJ (Stochastic)
// K = SMA(rawK, 3), D = SMA(K, 3), J = 3K - 2D
// ---------------------------------------------------------------------------

export function kdj(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 9,
): { k: (number | null)[]; d: (number | null)[]; j: (number | null)[] } {
  const n = closes.length;
  const rawK: (number | null)[] = [];

  for (let i = 0; i < n; i++) {
    if (i < period - 1) {
      rawK.push(null);
      continue;
    }
    const periodHighs = highs.slice(i - period + 1, i + 1);
    const periodLows = lows.slice(i - period + 1, i + 1);
    const hh = Math.max(...periodHighs);
    const ll = Math.min(...periodLows);
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }

  // K = SMA(rawK, 3) — only over non-null values
  const rawKValues = rawK.filter((v): v is number => v !== null);
  const kSmoothed = sma(rawKValues, 3);

  const leadingNullsK = rawK.findIndex((v) => v !== null) + 2; // SMA adds 2 more nulls
  const k: (number | null)[] = [
    ...new Array(leadingNullsK).fill(null),
    ...kSmoothed.filter((v): v is number => v !== null),
  ];

  // D = SMA(K, 3)
  const kValues = k.filter((v): v is number => v !== null);
  const dSmoothed = sma(kValues, 3);
  const leadingNullsD = k.findIndex((v) => v !== null) + 2;
  const d: (number | null)[] = [
    ...new Array(leadingNullsD).fill(null),
    ...dSmoothed.filter((v): v is number => v !== null),
  ];

  // J = 3K - 2D
  const j: (number | null)[] = k.map((kv, i) => {
    const dv = d[i];
    return kv !== null && dv !== null ? 3 * kv - 2 * dv : null;
  });

  return { k, d, j };
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export function bollingerBands(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = sma(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
    } else {
      const slice = closes.slice(i - period + 1, i + 1);
      const m = middle[i] as number;
      const sd = stddev(slice, m);
      upper.push(m + mult * sd);
      lower.push(m - mult * sd);
    }
  }
  return { upper, middle, lower };
}

// ---------------------------------------------------------------------------
// ATR — Average True Range (Wilder smoothing)
// ---------------------------------------------------------------------------

export function atr(candles: Candle[], period = 14): (number | null)[] {
  if (candles.length < 2) return candles.map(() => null);

  const trueRanges: number[] = [candles[1].high - candles[1].low]; // first TR = simple range
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trueRanges.push(
      Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)),
    );
  }

  const out: (number | null)[] = [null]; // index 0 has no TR

  // Seed with simple average
  if (trueRanges.length < period) return candles.map(() => null);

  let atrVal = mean(trueRanges.slice(0, period));
  // Fill nulls up to the seed point
  for (let i = 1; i < period; i++) out.push(null);
  out.push(atrVal);

  for (let i = period; i < trueRanges.length; i++) {
    atrVal = (atrVal * (period - 1) + trueRanges[i]) / period;
    out.push(atrVal);
  }
  return out;
}

// ---------------------------------------------------------------------------
// OBV — On-Balance Volume
// ---------------------------------------------------------------------------

export function obv(candles: Candle[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].volume ?? 0;
    const prev = out[i - 1];
    if (candles[i].close > candles[i - 1].close) out.push(prev + vol);
    else if (candles[i].close < candles[i - 1].close) out.push(prev - vol);
    else out.push(prev);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volume Ratio — today / average of last N days
// ---------------------------------------------------------------------------

export function volumeRatio(volumes: number[], period = 5): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < period) {
      out.push(null);
    } else {
      const avg = mean(volumes.slice(i - period, i));
      out.push(avg === 0 ? null : volumes[i] / avg);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Price Position — (close - periodLow) / (periodHigh - periodLow) * 100
// ---------------------------------------------------------------------------

export function pricePosition(candles: Candle[], period = 20): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else {
      const slice = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...slice.map((c) => c.high));
      const low = Math.min(...slice.map((c) => c.low));
      out.push(high === low ? 50 : ((candles[i].close - low) / (high - low)) * 100);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detect Box (consolidation zone)
// isBox = high range < 8% AND low range < 8% over lookback candles
// ---------------------------------------------------------------------------

export function detectBox(
  candles: Candle[],
  lookback = 20,
): { upper: number; lower: number; isBox: boolean; duration: number } | null {
  if (candles.length < lookback) return null;

  const window = candles.slice(-lookback);
  const highs = window.map((c) => c.high);
  const lows = window.map((c) => c.low);
  const maxHigh = Math.max(...highs);
  const minHigh = Math.min(...highs);
  const maxLow = Math.max(...lows);
  const minLow = Math.min(...lows);

  const highRange = maxHigh === 0 ? 0 : (maxHigh - minHigh) / maxHigh;
  const lowRange = minLow === 0 ? 0 : (maxLow - minLow) / minLow;
  const isBox = highRange < 0.08 && lowRange < 0.08;

  // Duration = how many consecutive candles from the end satisfy box bounds
  const upper = maxHigh;
  const lower = minLow;
  let duration = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].high <= upper * 1.01 && candles[i].low >= lower * 0.99) {
      duration++;
    } else {
      break;
    }
  }

  return { upper, lower, isBox, duration };
}
