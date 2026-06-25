// =============================================================================
// lib/bullbearSignals.ts — Intraday bull/bear signal detection for 台股雷達
// =============================================================================

import type { Candle } from '@/types';
import type { IntradayTick } from '@/lib/fugle';
import { sma, bollingerBands } from '@/lib/indicators';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BullSignalType =
  | '突破昨高'
  | '突破5日高'
  | '突破10日高'
  | '突破盤整區'
  | '站上5MA'
  | '站上20MA'
  | '攻擊K'
  | '紅三兵'
  | '漲幅超過3%'
  | '漲停';

export type BearSignalType =
  | '跌破昨低'
  | '跌破5日低'
  | '跌破10日低'
  | '跌破盤整區'
  | '跌破5MA'
  | '跌破20MA'
  | '跌破布林下軌'
  | '跌幅超過3%'
  | '跌停'
  | '陰跌連三日';

export interface IntradaySignalEvent {
  type: BullSignalType | BearSignalType;
  side: 'bull' | 'bear';
  time: string;        // HH:MM
  price: number;
  strength: 1 | 2 | 3; // 1=weak, 2=moderate, 3=strong
  description: string;  // Chinese
}

export interface TrendBar {
  time: string;
  value: number;
  signals: string[];
}

export interface TrendStrength {
  bullScore: number;   // 0-100
  bearScore: number;
  dominantSide: 'bull' | 'bear' | 'neutral';
  bars: TrendBar[];
}

export type YesterdayTrend =
  | '昨日強勢股'
  | '近五日強勢股'
  | '近十日強勢股'
  | '昨日弱勢股'
  | '近五日弱勢股'
  | '近十日弱勢股'
  | '中性';

export type AfterHoursBullStrategy =
  | '昨日強勢股'
  | '近五日強勢股'
  | '近十日強勢股'
  | '開布林'
  | '突破均線'
  | '突破壓力'
  | '剛轉多'
  | '突破趨勢線';

export type AfterHoursBearStrategy =
  | '昨日弱勢股'
  | '近五日弱勢股'
  | '近十日弱勢股'
  | '跌破布林'
  | '跌破均線'
  | '空頭排列'
  | '剛轉空'
  | '綠柱放大';

// ---------------------------------------------------------------------------
// Indicator snapshot (pre-computed, passed in)
// ---------------------------------------------------------------------------

export interface IndicatorSnapshot {
  sma5:  (number | null)[];
  sma20: (number | null)[];
  sma60: (number | null)[];
  bb:    { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastVal(arr: (number | null)[], offset = 0): number | null {
  const idx = arr.length - 1 - offset;
  return idx >= 0 ? arr[idx] : null;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function hhmm(tick: IntradayTick): string {
  return tick.time.substring(0, 5); // "HH:MM:SS" → "HH:MM"
}

function strengthForType(type: BullSignalType | BearSignalType): 1 | 2 | 3 {
  if (type === '漲停' || type === '跌停') return 3;
  if (
    type === '突破5日高' || type === '突破10日高' ||
    type === '攻擊K'    || type === '突破昨高'   ||
    type === '跌破5日低' || type === '跌破10日低' ||
    type === '跌破昨低'
  ) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// 1. detectIntradaySignals
//    Returns ONLY newly fired signals (edge detection).
// ---------------------------------------------------------------------------

export function detectIntradaySignals(
  ticks: IntradayTick[],
  candles: Candle[],
  prevSignals: IntradaySignalEvent[],
): IntradaySignalEvent[] {
  if (ticks.length < 2 || candles.length < 2) return [];

  const newSignals: IntradaySignalEvent[] = [];
  const alreadyFired = new Set(prevSignals.map((s) => s.type));

  const n = candles.length;
  const closes  = candles.map((c) => c.close);
  const sma5arr = sma(closes, 5);
  const sma20arr = sma(closes, 20);

  // Reference levels from daily candles
  const prevDayCandle  = candles[n - 1]; // last completed day
  const prevDayClose   = prevDayCandle.close;
  const prevDayLow     = prevDayCandle.low;
  const openPrice      = ticks[0]?.price ?? prevDayClose;

  const last5Highs = candles.slice(Math.max(0, n - 5)).map((c) => c.high);
  const last10Highs = candles.slice(Math.max(0, n - 10)).map((c) => c.high);
  const last5Lows  = candles.slice(Math.max(0, n - 5)).map((c) => c.low);
  const last10Lows = candles.slice(Math.max(0, n - 10)).map((c) => c.low);

  const high5  = Math.max(...last5Highs);
  const high10 = Math.max(...last10Highs);
  const low5   = Math.min(...last5Lows);
  const low10  = Math.min(...last10Lows);

  const ma5Now  = lastVal(sma5arr);
  const ma20Now = lastVal(sma20arr);
  const limitUp   = Math.round(prevDayClose * 1.1 * 100) / 100;
  const limitDown = Math.round(prevDayClose * 0.9 * 100) / 100;

  // Avg body & volume for 攻擊K (last 5 intraday 5-min candles approximation)
  const recentTicks   = ticks.slice(-10);
  const avgTickVol    = mean(recentTicks.map((t) => t.volume));
  const avgTickChange = mean(recentTicks.map((t) => Math.abs(t.price - (recentTicks[0]?.price ?? t.price))));

  // Candle body: 紅三兵 — last 3 ticks all up
  const last3Up =
    ticks.length >= 3 &&
    ticks[ticks.length - 1].price > ticks[ticks.length - 2].price &&
    ticks[ticks.length - 2].price > ticks[ticks.length - 3].price &&
    ticks[ticks.length - 1].side === 'B';

  // 陰跌連三日 — last 3 candles bearish
  const threeDownCandles =
    n >= 3 &&
    candles[n - 1].close < candles[n - 1].open &&
    candles[n - 2].close < candles[n - 2].open &&
    candles[n - 3].close < candles[n - 3].open;

  // Edge detection: compare last two ticks
  const curTick  = ticks[ticks.length - 1];
  const prevTick = ticks[ticks.length - 2];
  const cur  = curTick.price;
  const prev = prevTick.price;
  const time = hhmm(curTick);

  function fire(
    type: BullSignalType | BearSignalType,
    side: 'bull' | 'bear',
    desc: string,
  ) {
    if (alreadyFired.has(type)) return; // only fire once per session
    newSignals.push({
      type,
      side,
      time,
      price: cur,
      strength: strengthForType(type),
      description: desc,
    });
    alreadyFired.add(type);
  }

  // ── BULL signals ──────────────────────────────────────────────────────────

  if (cur > prevDayClose && prev <= prevDayClose)
    fire('突破昨高', 'bull', `股價突破昨日收盤 ${prevDayClose}，多方接手`);

  if (cur > high5 && prev <= high5)
    fire('突破5日高', 'bull', `股價突破5日高點 ${high5.toFixed(2)}，多方延續`);

  if (cur > high10 && prev <= high10)
    fire('突破10日高', 'bull', `股價突破10日高點 ${high10.toFixed(2)}，強勢突破`);

  if (ma5Now !== null && cur > ma5Now && prev <= ma5Now)
    fire('站上5MA', 'bull', `股價站回5日均線 ${ma5Now.toFixed(2)}，短線偏多`);

  if (ma20Now !== null && cur > ma20Now && prev <= ma20Now)
    fire('站上20MA', 'bull', `股價站回20日均線 ${ma20Now.toFixed(2)}，趨勢轉多`);

  if (
    recentTicks.length >= 5 &&
    curTick.volume > 2 * avgTickVol &&
    Math.abs(cur - prev) > 2 * avgTickChange
  )
    fire('攻擊K', 'bull', `量價齊揚，攻擊力道強勁，量比均量 ${(curTick.volume / (avgTickVol || 1)).toFixed(1)} 倍`);

  if (last3Up)
    fire('紅三兵', 'bull', `連續三筆買盤推升，多方力道持續`);

  if (openPrice > 0 && (cur - openPrice) / openPrice > 0.03 && (prev - openPrice) / openPrice <= 0.03)
    fire('漲幅超過3%', 'bull', `今日漲幅突破3%，達 ${(((cur - openPrice) / openPrice) * 100).toFixed(2)}%`);

  if (cur >= limitUp && prev < limitUp)
    fire('漲停', 'bull', `股價觸及漲停板 ${limitUp}，強勢鎖板`);

  // ── BEAR signals ──────────────────────────────────────────────────────────

  if (cur < prevDayLow && prev >= prevDayLow)
    fire('跌破昨低', 'bear', `股價跌破昨日低點 ${prevDayLow}，空方佔優`);

  if (cur < low5 && prev >= low5)
    fire('跌破5日低', 'bear', `股價跌破5日低點 ${low5.toFixed(2)}，弱勢訊號`);

  if (cur < low10 && prev >= low10)
    fire('跌破10日低', 'bear', `股價跌破10日低點 ${low10.toFixed(2)}，趨勢轉弱`);

  if (ma5Now !== null && cur < ma5Now && prev >= ma5Now)
    fire('跌破5MA', 'bear', `股價跌破5日均線 ${ma5Now.toFixed(2)}，短線偏空`);

  if (ma20Now !== null && cur < ma20Now && prev >= ma20Now)
    fire('跌破20MA', 'bear', `股價跌破20日均線 ${ma20Now.toFixed(2)}，趨勢轉空`);

  if (openPrice > 0 && (openPrice - cur) / openPrice > 0.03 && (openPrice - prev) / openPrice <= 0.03)
    fire('跌幅超過3%', 'bear', `今日跌幅超過3%，達 ${(((openPrice - cur) / openPrice) * 100).toFixed(2)}%`);

  if (cur <= limitDown && prev > limitDown)
    fire('跌停', 'bear', `股價觸及跌停板 ${limitDown}，弱勢跌停`);

  if (threeDownCandles && !alreadyFired.has('陰跌連三日'))
    fire('陰跌連三日', 'bear', `近三日連續收黑，賣壓持續沉重`);

  return newSignals;
}

// ---------------------------------------------------------------------------
// 2. computeTrendStrength
// ---------------------------------------------------------------------------

export function computeTrendStrength(signals: IntradaySignalEvent[]): TrendStrength {
  // Weight map: strength → points
  const weight = (s: IntradaySignalEvent) => s.strength === 3 ? 30 : s.strength === 2 ? 20 : 10;

  // Accumulate by time
  const barMap = new Map<string, { value: number; signals: string[] }>();

  let totalBull = 0;
  let totalBear = 0;

  for (const sig of signals) {
    const w = sig.side === 'bull' ? weight(sig) : -weight(sig);
    if (sig.side === 'bull') totalBull += weight(sig);
    else totalBear += weight(sig);

    const existing = barMap.get(sig.time) ?? { value: 0, signals: [] };
    existing.value += w;
    existing.signals.push(sig.type);
    barMap.set(sig.time, existing);
  }

  // Convert to sorted array
  const bars: TrendBar[] = Array.from(barMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, { value, signals }]) => ({ time, value, signals }));

  // Normalise scores 0-100 (max theoretical: 10 signals × 30 = 300)
  const bullScore = Math.min(100, Math.round((totalBull / 300) * 100));
  const bearScore = Math.min(100, Math.round((totalBear / 300) * 100));

  const dominantSide: TrendStrength['dominantSide'] =
    bullScore > bearScore + 20 ? 'bull' :
    bearScore > bullScore + 20 ? 'bear' : 'neutral';

  return { bullScore, bearScore, dominantSide, bars };
}

// ---------------------------------------------------------------------------
// 3. classifyYesterdayTrend
// ---------------------------------------------------------------------------

export function classifyYesterdayTrend(
  candles: Candle[],
  indicators: IndicatorSnapshot,
): YesterdayTrend {
  const n = candles.length;
  if (n < 10) return '中性';

  const last = candles[n - 1];
  const closes = candles.map((c) => c.close);
  const vols   = candles.map((c) => c.volume ?? 0);

  const avgVol5 = mean(vols.slice(Math.max(0, n - 6), n - 1));
  const high5   = Math.max(...candles.slice(Math.max(0, n - 5)).map((c) => c.high));
  const low5    = Math.min(...candles.slice(Math.max(0, n - 5)).map((c) => c.low));
  const low10   = Math.min(...candles.slice(Math.max(0, n - 10)).map((c) => c.low));

  const ma20 = lastVal(indicators.sma20);
  const ma60 = lastVal(indicators.sma60);

  // 昨日強勢: up candle, vol > 1.2x avg, close within 3% of 5-day high
  if (
    last.close > last.open &&
    (last.volume ?? 0) > 1.2 * avgVol5 &&
    high5 > 0 && (high5 - last.close) / high5 < 0.03
  ) return '昨日強勢股';

  // 近五日強勢: above MA20 and near 5-day high
  if (
    ma20 !== null && last.close > ma20 &&
    high5 > 0 && (high5 - last.close) / high5 < 0.05
  ) return '近五日強勢股';

  // 近十日強勢: above both MAs, volume healthy, NOT overextended above MA20
  if (
    ma20 !== null && ma60 !== null &&
    last.close > ma20 && last.close > ma60 &&
    (last.volume ?? 0) > 1.1 * avgVol5 &&
    ma20 > 0 && (last.close - ma20) / ma20 < 0.08
  ) return '近十日強勢股';

  // 昨日弱勢: down candle, vol > 1.2x avg, close within 3% of 5-day low
  if (
    last.close < last.open &&
    (last.volume ?? 0) > 1.2 * avgVol5 &&
    low5 > 0 && (last.close - low5) / low5 < 0.03
  ) return '昨日弱勢股';

  // 近五日弱勢: below ma20 and near 5-day low
  if (
    ma20 !== null && last.close < ma20 &&
    low5 > 0 && (last.close - low5) / low5 < 0.05
  ) return '近五日弱勢股';

  // 近十日弱勢: below both MAs
  if (ma20 !== null && ma60 !== null && last.close < ma20 && last.close < ma60)
    return '近十日弱勢股';

  return '中性';
}

// ---------------------------------------------------------------------------
// 4. evaluateAfterHours
// ---------------------------------------------------------------------------

export function evaluateAfterHours(
  candles: Candle[],
  indicators: IndicatorSnapshot,
): {
  bullStrategies: AfterHoursBullStrategy[];
  bearStrategies: AfterHoursBearStrategy[];
  bullScore: number;
  bearScore: number;
} {
  const n = candles.length;
  if (n < 20) return { bullStrategies: [], bearStrategies: [], bullScore: 0, bearScore: 0 };

  const last   = candles[n - 1];
  const closes = candles.map((c) => c.close);
  const vols   = candles.map((c) => c.volume ?? 0);

  const ma5Now  = lastVal(indicators.sma5);
  const ma20Now = lastVal(indicators.sma20);
  const ma60Now = lastVal(indicators.sma60);
  const ma5Prev = lastVal(indicators.sma5, 1);
  const ma20Prev = lastVal(indicators.sma20, 1);

  const bbUpper = lastVal(indicators.bb.upper);
  const bbLower = lastVal(indicators.bb.lower);

  const avgVol10 = mean(vols.slice(Math.max(0, n - 11), n - 1));
  const todayVol = last.volume ?? 0;

  // ── MACD histogram trend (last 3 days) ──
  const ema12arr = sma(closes, 12); // approx
  const ema26arr = sma(closes, 26);
  const macdNow  = (lastVal(ema12arr) ?? 0) - (lastVal(ema26arr) ?? 0);
  const macdPrev = (lastVal(ema12arr, 1) ?? 0) - (lastVal(ema26arr, 1) ?? 0);
  const macdGrowing = macdNow > macdPrev;

  // ── Trend line breakout: find last 2 swing highs ──
  const swingHighs: { idx: number; price: number }[] = [];
  for (let i = 5; i < n - 1 && swingHighs.length < 2; i++) {
    const window = candles.slice(i - 2, i + 3).map((c) => c.high);
    if (candles[i].high === Math.max(...window)) {
      swingHighs.unshift({ idx: i, price: candles[i].high });
    }
  }
  let aboveTrendLine = false;
  if (swingHighs.length === 2) {
    const [sh1, sh2] = swingHighs;
    const slope = (sh2.price - sh1.price) / (sh2.idx - sh1.idx);
    const trendAtNow = sh2.price + slope * (n - 1 - sh2.idx);
    aboveTrendLine = last.close > trendAtNow;
  }

  const bullStrategies: AfterHoursBullStrategy[] = [];
  const bearStrategies: AfterHoursBearStrategy[] = [];
  let bullScore = 0;
  let bearScore = 0;

  const addBull = (s: AfterHoursBullStrategy, w: number) => {
    bullStrategies.push(s); bullScore += w;
  };
  const addBear = (s: AfterHoursBearStrategy, w: number) => {
    bearStrategies.push(s); bearScore += w;
  };

  const trend = classifyYesterdayTrend(candles, indicators);

  // ── Bull strategies ──────────────────────────────────────────────────────

  if (trend === '昨日強勢股')  addBull('昨日強勢股',  12);
  if (trend === '近五日強勢股') addBull('近五日強勢股', 12);
  if (trend === '近十日強勢股') addBull('近十日強勢股', 12);

  // 開布林: close above upper BB
  if (bbUpper !== null && last.close > bbUpper)
    addBull('開布林', 20);

  // 突破均線: crossed above ma20 today
  if (ma20Now !== null && ma20Prev !== null && last.close > ma20Now && candles[n - 2].close <= ma20Prev)
    addBull('突破均線', 12);

  // 突破壓力: today close > 20-day high (excluding today)
  const prior20High = Math.max(...candles.slice(Math.max(0, n - 21), n - 1).map((c) => c.high));
  if (last.close > prior20High)
    addBull('突破壓力', 20);

  // 剛轉多: ma5 crossed above ma20 in last 2 days
  if (
    ma5Now !== null && ma20Now !== null && ma5Prev !== null && ma20Prev !== null &&
    ma5Now > ma20Now && ma5Prev <= ma20Prev
  ) addBull('剛轉多', 18);

  // 突破趨勢線: must have volume confirmation and be an up candle
  if (aboveTrendLine && todayVol > 1.2 * avgVol10 && last.close > last.open)
    addBull('突破趨勢線', 12);

  // ── Bear strategies ──────────────────────────────────────────────────────

  if (trend === '昨日弱勢股')  addBear('昨日弱勢股',  12);
  if (trend === '近五日弱勢股') addBear('近五日弱勢股', 12);
  if (trend === '近十日弱勢股') addBear('近十日弱勢股', 12);

  // 跌破布林: close below lower BB
  if (bbLower !== null && last.close < bbLower)
    addBear('跌破布林', 20);

  // 跌破均線: crossed below ma20 today
  if (ma20Now !== null && ma20Prev !== null && last.close < ma20Now && candles[n - 2].close >= ma20Prev)
    addBear('跌破均線', 12);

  // 空頭排列: ma5 < ma20 < ma60
  if (ma5Now !== null && ma20Now !== null && ma60Now !== null && ma5Now < ma20Now && ma20Now < ma60Now)
    addBear('空頭排列', 12);

  // 剛轉空: ma5 crossed below ma20 in last 2 days
  if (
    ma5Now !== null && ma20Now !== null && ma5Prev !== null && ma20Prev !== null &&
    ma5Now < ma20Now && ma5Prev >= ma20Prev
  ) addBear('剛轉空', 18);

  // 綠柱放大: MACD histogram growing negative AND volume increasing
  if (!macdGrowing && macdNow < 0 && todayVol > avgVol10)
    addBear('綠柱放大', 12);

  return { bullStrategies, bearStrategies, bullScore, bearScore };
}