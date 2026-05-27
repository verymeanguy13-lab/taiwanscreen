// =============================================================================
// lib/scoring.ts — Composite technical score for 台股雷達
// Weights: trend 25%, momentum 20%, volume 20%, chips 20%, pattern 10%, sentiment 5%
// =============================================================================

import type { Candle } from '@/types';
import type { InstitutionalFlow, MarginData } from '@/types';
import type { DetectedPattern } from '@/lib/patterns';
import type { BreakoutSignal } from '@/lib/breakouts';
import type { SignalMatrix } from '@/lib/signals';

import { sma, ema, rsi as calcRsi, macd as calcMacd, kdj, bollingerBands, atr, obv, volumeRatio } from '@/lib/indicators';
import { detectPatterns } from '@/lib/patterns';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateSignalMatrix } from '@/lib/signals';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DimensionScore {
  score: number;
  reason: string;
}

export interface ScoreResult {
  overall: number;
  technicalReading: '技術面強勢' | '偏多訊號' | '中性' | '偏空訊號' | '技術面弱勢';
  dimensions: {
    trend:     DimensionScore;
    momentum:  DimensionScore;
    volume:    DimensionScore;
    chips:     DimensionScore;
    pattern:   DimensionScore;
    sentiment: DimensionScore;
  };
  breakouts: BreakoutSignal[];
  matrix:    SignalMatrix;
  patterns:  DetectedPattern[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function last<T>(arr: (T | null)[], offset = 0): T | null {
  const idx = arr.length - 1 - offset;
  return idx >= 0 ? arr[idx] : null;
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, v));
}

function avgVol(candles: Candle[], period = 5, endOffset = 1): number {
  const end   = candles.length - endOffset;
  const start = Math.max(0, end - period);
  const slice = candles.slice(start, end);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + (c.volume ?? 0), 0) / slice.length;
}

// ---------------------------------------------------------------------------
// computeScore
// ---------------------------------------------------------------------------

export function computeScore(
  candles: Candle[],
  institutional?: InstitutionalFlow[],
  margin?: MarginData[],
): ScoreResult {
  const n = candles.length;

  // ------------------------------------------------------------------
  // Build indicators
  // ------------------------------------------------------------------
  const closes  = candles.map((c) => c.close);
  const highs   = candles.map((c) => c.high);
  const lows    = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume ?? 0);

  const sma5  = sma(closes, 5);
  const sma20 = sma(closes, 20);
  const sma60 = sma(closes, 60);
  const rsi14 = calcRsi(closes, 14);
  const macdData = calcMacd(closes);
  const kdjData  = kdj(highs, lows, closes);
  const bbData   = bollingerBands(closes);
  const obvData  = obv(candles);
  const volRatioData = volumeRatio(volumes, 5);

  const indicatorSnapshot = {
    sma5, sma20, sma60, rsi14,
    macd: macdData,
    kd:   { k: kdjData.k, d: kdjData.d },
    bb:   bbData,
    obv:  obvData,
    volRatio: volRatioData,
  };

  const today    = candles[n - 1] ?? { open: 0, high: 0, low: 0, close: 0 };
  const m5Now    = last(sma5)  as number | null;
  const m20Now   = last(sma20) as number | null;
  const m60Now   = last(sma60) as number | null;
  const rsiNow   = last(rsi14) as number | null;
  const macdLine = last(macdData.macdLine)   as number | null;
  const sigLine  = last(macdData.signalLine) as number | null;
  const kNow     = last(kdjData.k) as number | null;
  const dNow     = last(kdjData.d) as number | null;

  // ------------------------------------------------------------------
  // TREND (0–100, weight 25%)
  // ------------------------------------------------------------------
  let trendScore = 0;
  const trendReasons: string[] = [];

  if (m5Now !== null && today.close > m5Now) { trendScore += 25; trendReasons.push('價>5MA'); }
  if (m5Now !== null && m20Now !== null && m5Now > m20Now) { trendScore += 25; trendReasons.push('5MA>20MA'); }
  if (m20Now !== null && m60Now !== null && m20Now > m60Now) { trendScore += 20; trendReasons.push('20MA>60MA'); }
  if (m60Now !== null && today.close > m60Now) { trendScore += 15; trendReasons.push('價>60MA'); }
  if (today.close > today.open) { trendScore += 15; trendReasons.push('今日上漲'); }

  // ------------------------------------------------------------------
  // MOMENTUM (0–100, weight 20%)
  // ------------------------------------------------------------------
  let momentumScore = 0;
  const momReasons: string[] = [];

  // RSI
  if (rsiNow !== null) {
    if (rsiNow >= 50 && rsiNow <= 70) { momentumScore += 40; momReasons.push(`RSI ${rsiNow.toFixed(0)}(強勢區)`); }
    else if (rsiNow > 70)             { momentumScore += 20; momReasons.push(`RSI ${rsiNow.toFixed(0)}(偏高)`); }
    else if (rsiNow >= 40)            { momentumScore += 10; momReasons.push(`RSI ${rsiNow.toFixed(0)}(中性)`); }
    else                              { momentumScore -= 20; momReasons.push(`RSI ${rsiNow.toFixed(0)}(弱勢)`); }
  }

  // MACD
  if (macdLine !== null && sigLine !== null) {
    if (macdLine > sigLine && macdLine > 0) { momentumScore += 30; momReasons.push('MACD多頭'); }
    else if (macdLine > sigLine)            { momentumScore += 15; momReasons.push('MACD金叉'); }
  }

  // KDJ
  if (kNow !== null && dNow !== null) {
    if (kNow > dNow && kNow > 50) { momentumScore += 30; momReasons.push(`K(${kNow.toFixed(0)})>D多頭`); }
    else if (kNow > dNow)         { momentumScore += 15; momReasons.push('KD金叉'); }
  }

  // ------------------------------------------------------------------
  // VOLUME (0–100, weight 20%)
  // ------------------------------------------------------------------
  let volumeScore = 0;
  const volReasons: string[] = [];

  const av5 = avgVol(candles, 5, 1);
  const todayVol = today.volume ?? 0;

  // Volume ratio tiers
  if (av5 > 0) {
    const vr = todayVol / av5;
    if (vr >= 2)       { volumeScore += 40; volReasons.push(`量比${vr.toFixed(1)}x(暴增)`); }
    else if (vr >= 1.5){ volumeScore += 30; volReasons.push(`量比${vr.toFixed(1)}x(放量)`); }
    else if (vr >= 1)  { volumeScore += 15; volReasons.push(`量比${vr.toFixed(1)}x(正常)`); }
  }

  // OBV rising
  if (obvData.length > 5 && obvData[obvData.length - 1] > obvData[obvData.length - 6]) {
    volumeScore += 30; volReasons.push('OBV上升');
  }

  // Distribution warning: high volume + price drop
  if (av5 > 0 && todayVol > 1.5 * av5 && today.close < today.open) {
    volumeScore -= 20; volReasons.push('出貨警告');
  }

  // ------------------------------------------------------------------
  // CHIPS (0–100, weight 20%)
  // ------------------------------------------------------------------
  let chipsScore = 0;
  const chipsReasons: string[] = [];

  if (institutional && institutional.length >= 3) {
    const recent3 = institutional.slice(-3);
    const foreignNet3 = recent3.reduce((s, r) => s + (r.foreign_net ?? 0), 0);
    const trustNet3   = recent3.reduce((s, r) => s + (r.trust_net ?? 0), 0);
    const allForeignPos = recent3.every((r) => (r.foreign_net ?? 0) > 0);
    const allTrustPos   = recent3.every((r) => (r.trust_net ?? 0) > 0);

    if (allForeignPos) { chipsScore += 35; chipsReasons.push(`外資連買3日(+${foreignNet3})`); }
    if (allTrustPos)   { chipsScore += 20; chipsReasons.push(`投信連買3日(+${trustNet3})`); }
  }

  if (margin && margin.length >= 2) {
    const latest = margin[margin.length - 1];
    const prev   = margin[margin.length - 2];
    const marginBal = latest.margin_balance ?? 0;
    const marginPrev = prev.margin_balance ?? 0;
    const shortBal  = latest.short_balance ?? 0;
    const shortPrev = prev.short_balance ?? 0;

    if (marginBal < marginPrev) { chipsScore += 20; chipsReasons.push('融資餘額下降(健康)'); }
    else if (marginBal > marginPrev * 1.05) { chipsScore -= 15; chipsReasons.push('融資快速增加'); }

    if (shortBal > shortPrev * 1.1) { chipsScore += 25; chipsReasons.push('空單增加(軋空潛力)'); }
    else if (shortBal < shortPrev)  { chipsScore -= 20; chipsReasons.push('空單回補(賣壓)'); }
  }

  // ------------------------------------------------------------------
  // PATTERN (0–100, weight 10%)
  // ------------------------------------------------------------------
  let patternScore = 0;
  const patReasons: string[] = [];

  const patterns = detectPatterns(candles);
  const breakouts = detectAllBreakouts(candles, {
    sma5, sma20, sma60, rsi14, macd: macdData,
  });

  for (const p of patterns) {
    if (p.type === 'bullish')  { patternScore += p.confidence * 0.5; patReasons.push(`+${p.name}`); }
    if (p.type === 'bearish')  { patternScore -= p.confidence * 0.4; patReasons.push(`-${p.name}`); }
  }

  // Breakout bonus
  const strongBreakout = breakouts.find((b) => b.confidence > 70);
  if (strongBreakout) { patternScore += 40; patReasons.push(`突破訊號(${strongBreakout.type})`); }

  // Signal matrix strength bonus
  const matrix = evaluateSignalMatrix(candles, indicatorSnapshot, institutional);
  if (matrix.strengthCount >= 6) { patternScore += 25; patReasons.push(`強勢指標${matrix.strengthCount}/9`); }

  // ------------------------------------------------------------------
  // SENTIMENT (0–100, weight 5%)
  // ------------------------------------------------------------------
  let sentimentScore = 0;
  const sentReasons: string[] = [];

  // RSI ideal zone (not overbought/oversold)
  if (rsiNow !== null) {
    if (rsiNow >= 40 && rsiNow <= 65)   { sentimentScore += 30; sentReasons.push('RSI健康區'); }
    else if (rsiNow > 75)               { sentimentScore += 0;  sentReasons.push('RSI過熱'); }
    else                                { sentimentScore += 20; sentReasons.push('RSI中性'); }
  }

  // Not overbought (below upper BB)
  const bbUpper = last(bbData.upper) as number | null;
  if (bbUpper !== null && today.close <= bbUpper) { sentimentScore += 20; sentReasons.push('未觸布林上軌'); }

  // No recent bearish patterns in last 3 candles
  const recentBear = patterns.filter((p) => p.type === 'bearish' && p.candleIndex >= n - 3);
  if (recentBear.length === 0) { sentimentScore += 25; sentReasons.push('近期無空頭型態'); }

  // Stable volume (not extreme swings)
  const vol3    = candles.slice(Math.max(0, n - 3)).map((c) => c.volume ?? 0);
  const volMean = vol3.reduce((s, v) => s + v, 0) / (vol3.length || 1);
  const volStd  = Math.sqrt(vol3.reduce((s, v) => s + (v - volMean) ** 2, 0) / (vol3.length || 1));
  if (volMean > 0 && volStd / volMean < 0.5) { sentimentScore += 25; sentReasons.push('量能穩定'); }

  // ------------------------------------------------------------------
  // Composite score
  // ------------------------------------------------------------------
  const trendW     = 0.25;
  const momentumW  = 0.20;
  const volumeW    = 0.20;
  const chipsW     = 0.20;
  const patternW   = 0.10;
  const sentimentW = 0.05;

  const overall = Math.round(
    clamp(trendScore)     * trendW +
    clamp(momentumScore)  * momentumW +
    clamp(volumeScore)    * volumeW +
    clamp(chipsScore)     * chipsW +
    clamp(patternScore)   * patternW +
    clamp(sentimentScore) * sentimentW,
  );

  const technicalReading: ScoreResult['technicalReading'] =
    overall >= 75 ? '技術面強勢' :
    overall >= 60 ? '偏多訊號'   :
    overall >= 40 ? '中性'       :
    overall >= 25 ? '偏空訊號'   : '技術面弱勢';

  return {
    overall: clamp(overall),
    technicalReading,
    dimensions: {
      trend:     { score: clamp(trendScore),     reason: trendReasons.join('，') || '趨勢不明' },
      momentum:  { score: clamp(momentumScore),  reason: momReasons.join('，')   || '動能偏弱' },
      volume:    { score: clamp(volumeScore),    reason: volReasons.join('，')   || '量能普通' },
      chips:     { score: clamp(chipsScore),     reason: chipsReasons.join('，') || '籌碼無明顯動向' },
      pattern:   { score: clamp(patternScore),   reason: patReasons.join('，')   || '無明顯型態' },
      sentiment: { score: clamp(sentimentScore), reason: sentReasons.join('，')  || '情緒中性' },
    },
    breakouts,
    matrix,
    patterns,
  };
}
