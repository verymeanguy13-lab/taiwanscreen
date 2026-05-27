// =============================================================================
// lib/breakouts.ts — Breakout signal detection for 台股雷達
// =============================================================================

import type { Candle } from '@/types';
import { sma, ema, rsi, macd } from '@/lib/indicators';
import { detectBox } from '@/lib/indicators';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BreakoutType = '上漲趨勢突破' | '箱型整理突破' | '下跌V轉突破';

export interface BreakoutSignal {
  type: BreakoutType;
  candleIndex: number;
  date: string;
  price: number;
  confidence: number;           // 0–100
  triggerDescription: string;   // Chinese
  volumeConfirmed: boolean;
  keyLevels: {
    support?: number;
    resistance?: number;
    boxUpper?: number;
    boxLower?: number;
    vBottom?: number;
  };
}

// ---------------------------------------------------------------------------
// Indicator snapshot (pre-computed values passed in)
// ---------------------------------------------------------------------------

export interface IndicatorSnapshot {
  sma5:   (number | null)[];
  sma20:  (number | null)[];
  sma60:  (number | null)[];
  rsi14:  (number | null)[];
  macd:   { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function last<T>(arr: (T | null)[], offset = 0): T | null {
  const idx = arr.length - 1 - offset;
  return idx >= 0 ? arr[idx] : null;
}

function avgVolume(candles: Candle[], period = 5, endOffset = 1): number {
  const end = candles.length - endOffset;
  const start = Math.max(0, end - period);
  const slice = candles.slice(start, end);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + (c.volume ?? 0), 0) / slice.length;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// 1. detectUptrendBreakout
// Required: 5MA>20MA>60MA for 5+ days, close > prior 20-day high,
//           volume > 1.5x avg, RSI 45-75, up candle.
// ---------------------------------------------------------------------------

export function detectUptrendBreakout(
  candles: Candle[],
  indicators: IndicatorSnapshot,
): BreakoutSignal | null {
  const n = candles.length;
  if (n < 61) return null;

  const { sma5, sma20, sma60, rsi14, macd: macdData } = indicators;
  const today = candles[n - 1];
  const closes = candles.map((c) => c.close);

  // Up candle
  if (today.close <= today.open) return null;

  // RSI 45-75
  const rsiVal = last(rsi14) as number | null;
  if (rsiVal === null || rsiVal < 45 || rsiVal > 75) return null;

  // 5MA > 20MA > 60MA for last 5 days
  let trendDays = 0;
  for (let i = 0; i < 5; i++) {
    const m5  = last(sma5, i)  as number | null;
    const m20 = last(sma20, i) as number | null;
    const m60 = last(sma60, i) as number | null;
    if (m5 !== null && m20 !== null && m60 !== null && m5 > m20 && m20 > m60) trendDays++;
  }
  if (trendDays < 5) return null;

  // Close > prior 20-day high (exclude today)
  const prior20Highs = closes.slice(Math.max(0, n - 21), n - 1);
  const prior20High = Math.max(...prior20Highs);
  if (today.close <= prior20High) return null;

  // Volume > 1.5x avg
  const avgVol = avgVolume(candles, 5, 1);
  const todayVol = today.volume ?? 0;
  const volumeConfirmed = todayVol > 1.5 * avgVol;
  if (!volumeConfirmed) return null;

  // Confidence scoring
  let confidence = 60;

  // Volume bonus
  if (todayVol > 2 * avgVol) confidence += 15;
  else if (todayVol > 1.5 * avgVol) confidence += 8;

  // RSI ideal zone 50-70
  if (rsiVal >= 50 && rsiVal <= 70) confidence += 10;

  // MACD above signal
  const macdVal  = last(macdData.macdLine) as number | null;
  const sigVal   = last(macdData.signalLine) as number | null;
  if (macdVal !== null && sigVal !== null && macdVal > sigVal) confidence += 10;

  // 3 consecutive up candles
  if (
    n >= 3 &&
    candles[n - 1].close > candles[n - 1].open &&
    candles[n - 2].close > candles[n - 2].open &&
    candles[n - 3].close > candles[n - 3].open
  ) confidence += 5;

  // Support = 20MA, Resistance = prior 20-day high
  const support    = last(sma20) as number | null;
  const resistance = prior20High;

  return {
    type: '上漲趨勢突破',
    candleIndex: n - 1,
    date: today.date ?? '',
    price: today.close,
    confidence: clamp(confidence),
    triggerDescription: `收盤價 ${today.close} 突破近20日高點 ${prior20High.toFixed(2)}，三線多頭排列確認，量能放大 ${(todayVol / avgVol).toFixed(1)} 倍`,
    volumeConfirmed,
    keyLevels: {
      support: support ?? undefined,
      resistance,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. detectBoxBreakout
// Required: box detected (8+ candles), close > boxUpper*1.01,
//           volume > 1.5x avg, prior close inside box, 5MA flat or rising.
// ---------------------------------------------------------------------------

export function detectBoxBreakout(
  candles: Candle[],
  indicators: IndicatorSnapshot,
): BreakoutSignal | null {
  const n = candles.length;
  if (n < 20) return null;

  const { sma5, macd: macdData } = indicators;
  const today   = candles[n - 1];
  const yesterday = candles[n - 2];

  const box = detectBox(candles, 20);
  if (!box || !box.isBox) return null;

  // Box must have held for at least 8 candles
  if (box.duration < 8) return null;

  // Close > boxUpper * 1.01
  if (today.close <= box.upper * 1.01) return null;

  // Prior close inside box
  if (yesterday.close > box.upper || yesterday.close < box.lower) return null;

  // Volume > 1.5x avg
  const avgVol = avgVolume(candles, 5, 1);
  const todayVol = today.volume ?? 0;
  const volumeConfirmed = todayVol > 1.5 * avgVol;
  if (!volumeConfirmed) return null;

  // 5MA flat or rising (today >= yesterday)
  const ma5Today = last(sma5) as number | null;
  const ma5Prev  = last(sma5, 1) as number | null;
  if (ma5Today === null || ma5Prev === null) return null;
  if (ma5Today < ma5Prev * 0.999) return null; // allow tiny float noise

  // Confidence scoring
  let confidence = 65;

  // Volume
  if (todayVol > 2.5 * avgVol) confidence += 15;
  else if (todayVol > 2 * avgVol) confidence += 10;
  else if (todayVol > 1.5 * avgVol) confidence += 5;

  // Box age bonus
  if (box.duration >= 15) confidence += 10;
  else if (box.duration >= 10) confidence += 5;

  // MACD
  const macdVal = last(macdData.macdLine) as number | null;
  const sigVal  = last(macdData.signalLine) as number | null;
  if (macdVal !== null && sigVal !== null && macdVal > sigVal) confidence += 8;

  // Body size relative to box height
  const boxHeight = box.upper - box.lower;
  const bodySize  = Math.abs(today.close - today.open);
  if (boxHeight > 0 && bodySize > 0.5 * boxHeight) confidence += 7;

  return {
    type: '箱型整理突破',
    candleIndex: n - 1,
    date: today.date ?? '',
    price: today.close,
    confidence: clamp(confidence),
    triggerDescription: `收盤價 ${today.close} 突破 ${box.duration} 日箱型上緣 ${box.upper.toFixed(2)}，量能放大確認突破有效`,
    volumeConfirmed,
    keyLevels: {
      boxUpper: box.upper,
      boxLower: box.lower,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. detectVReversal
// Required: prior downtrend (5+ lower closes OR 15%+ decline),
//           bottom candle up on 2x volume, today > 5-day pre-bottom high,
//           5MA turning up, RSI < 35 at bottom, today > vBottom * 1.05.
// ---------------------------------------------------------------------------

export function detectVReversal(
  candles: Candle[],
  indicators: IndicatorSnapshot,
): BreakoutSignal | null {
  const n = candles.length;
  if (n < 20) return null;

  const { sma5, rsi14 } = indicators;
  const today = candles[n - 1];

  // Find the lowest close in the last 15 candles (the "V bottom")
  const lookbackSlice = candles.slice(Math.max(0, n - 15), n - 1);
  if (lookbackSlice.length < 5) return null;

  let bottomIdx = 0;
  let bottomClose = Infinity;
  lookbackSlice.forEach((c, i) => {
    if (c.close < bottomClose) { bottomClose = c.close; bottomIdx = i; }
  });
  const absoluteBottomIdx = Math.max(0, n - 15) + bottomIdx;
  const bottomCandle = candles[absoluteBottomIdx];

  // Prior downtrend: 5+ consecutive lower closes ending at bottom
  let lowerCount = 0;
  for (let i = absoluteBottomIdx; i > 0 && i > absoluteBottomIdx - 10; i--) {
    if (candles[i].close < candles[i - 1].close) lowerCount++;
    else break;
  }

  // OR 15%+ decline from recent high to bottom
  const recentHighSlice = candles.slice(Math.max(0, absoluteBottomIdx - 20), absoluteBottomIdx);
  const recentHigh = recentHighSlice.length > 0
    ? Math.max(...recentHighSlice.map((c) => c.close))
    : bottomClose;
  const declinePct = recentHigh > 0 ? (recentHigh - bottomClose) / recentHigh : 0;

  if (lowerCount < 5 && declinePct < 0.15) return null;

  // Bottom candle must be a up candle on 2x volume
  const preBottomAvgVol = avgVolume(candles, 5, n - absoluteBottomIdx);
  const bottomVol = bottomCandle.volume ?? 0;
  if (bottomCandle.close <= bottomCandle.open) return null;
  if (preBottomAvgVol > 0 && bottomVol < 2 * preBottomAvgVol) return null;

  // Today > 5-day pre-bottom high
  const preBottomSlice = candles.slice(Math.max(0, absoluteBottomIdx - 5), absoluteBottomIdx);
  const preBottomHigh = preBottomSlice.length > 0
    ? Math.max(...preBottomSlice.map((c) => c.high))
    : bottomClose;
  if (today.close <= preBottomHigh) return null;

  // 5MA turning up
  const ma5Today = last(sma5) as number | null;
  const ma5Prev  = last(sma5, 1) as number | null;
  if (ma5Today === null || ma5Prev === null || ma5Today <= ma5Prev) return null;

  // RSI was < 35 at bottom
  const rsiAtBottom = rsi14[absoluteBottomIdx];
  if (rsiAtBottom === null || rsiAtBottom === undefined || rsiAtBottom >= 35) return null;

  // Today > vBottom * 1.05
  if (today.close <= bottomClose * 1.05) return null;

  // Volume confirmed
  const avgVol = avgVolume(candles, 5, 1);
  const todayVol = today.volume ?? 0;
  const volumeConfirmed = todayVol > avgVol;

  // Confidence scoring
  let confidence = 55;

  // Bottom volume strength
  if (preBottomAvgVol > 0) {
    const ratio = bottomVol / preBottomAvgVol;
    if (ratio >= 3) confidence += 15;
    else if (ratio >= 2) confidence += 8;
  }

  // Hammer at bottom
  const bottomBody = Math.abs(bottomCandle.close - bottomCandle.open);
  const bottomLowerShadow = Math.min(bottomCandle.open, bottomCandle.close) - bottomCandle.low;
  if (bottomBody > 0 && bottomLowerShadow > 2 * bottomBody) confidence += 10;

  // RSI divergence (RSI rising while price still at/near low)
  const rsiNow = last(rsi14) as number | null;
  if (rsiAtBottom !== null && rsiNow !== null && rsiNow > rsiAtBottom + 10) confidence += 10;

  // Gap up today
  if (today.open > candles[n - 2].high) confidence += 10;

  return {
    type: '下跌V轉突破',
    candleIndex: n - 1,
    date: today.date ?? '',
    price: today.close,
    confidence: clamp(confidence),
    triggerDescription: `從低點 ${bottomClose.toFixed(2)} V形反轉，今日收 ${today.close} 已高出底部 ${((today.close / bottomClose - 1) * 100).toFixed(1)}%，5MA轉頭向上確認`,
    volumeConfirmed,
    keyLevels: {
      vBottom: bottomClose,
      support: ma5Today ?? undefined,
      resistance: preBottomHigh,
    },
  };
}

// ---------------------------------------------------------------------------
// detectAllBreakouts — runs all three, returns sorted by confidence desc
// ---------------------------------------------------------------------------

export function detectAllBreakouts(
  candles: Candle[],
  indicators: IndicatorSnapshot,
): BreakoutSignal[] {
  const results: BreakoutSignal[] = [];

  const uptrend = detectUptrendBreakout(candles, indicators);
  if (uptrend) results.push(uptrend);

  const box = detectBoxBreakout(candles, indicators);
  if (box) results.push(box);

  const vReversal = detectVReversal(candles, indicators);
  if (vReversal) results.push(vReversal);

  return results.sort((a, b) => b.confidence - a.confidence);
}
