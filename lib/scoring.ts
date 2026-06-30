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
  // Baseline 40 = neutral. Points added for bullish MA structure,
  // subtracted for bearish structure. Today's candle is a minor factor.
  // ------------------------------------------------------------------
  let trendScore = 40;
  const trendReasons: string[] = [];

  if (m5Now !== null && today.close > m5Now)  { trendScore += 15; trendReasons.push('價>5MA'); }
  if (m5Now !== null && m20Now !== null && m5Now > m20Now)   { trendScore += 20; trendReasons.push('5MA>20MA'); }
  if (m20Now !== null && m60Now !== null && m20Now > m60Now) { trendScore += 15; trendReasons.push('20MA>60MA'); }
  if (m60Now !== null && today.close > m60Now) { trendScore += 10; trendReasons.push('價>60MA'); }
  if (today.close > today.open)                { trendScore += 10; trendReasons.push('今日上漲'); }

  // Bearish deductions — active penalties for bad structure
  if (m5Now !== null && today.close < m5Now)  { trendScore -= 15; trendReasons.push('價<5MA'); }
  if (m5Now !== null && m20Now !== null && m5Now < m20Now)   { trendScore -= 20; trendReasons.push('5MA<20MA'); }
  if (m20Now !== null && m60Now !== null && m20Now < m60Now) { trendScore -= 15; trendReasons.push('20MA<60MA'); }

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
  // Baseline 50 = normal healthy volume. A stock with steady normal
  // volume is NOT weak — it is neutral. Only extremes move the score.
  // ------------------------------------------------------------------
  let volumeScore = 50;
  const volReasons: string[] = [];

  const av5 = avgVol(candles, 5, 1);
  const todayVol = today.volume ?? 0;

  if (av5 > 0) {
    const vr = todayVol / av5;
    if (vr >= 2)        { volumeScore += 30; volReasons.push(`量比${vr.toFixed(1)}x(暴增)`); }
    else if (vr >= 1.5) { volumeScore += 20; volReasons.push(`量比${vr.toFixed(1)}x(放量)`); }
    else if (vr >= 1)   { volReasons.push(`量比${vr.toFixed(1)}x(正常)`); }
    else if (vr < 0.5)  { volumeScore -= 20; volReasons.push(`量比${vr.toFixed(1)}x(極度萎縮)`); }
    else if (vr < 0.8)  { volumeScore -= 10; volReasons.push(`量比${vr.toFixed(1)}x(縮量)`); }
  }

  // OBV rising = smart money accumulating
  if (obvData.length > 5 && obvData[obvData.length - 1] > obvData[obvData.length - 6]) {
    volumeScore += 20; volReasons.push('OBV上升');
  }

  // Distribution warning: high volume + price drop = selling into strength
  if (av5 > 0 && todayVol > 1.5 * av5 && today.close < today.open) {
    volumeScore -= 25; volReasons.push('出貨警告');
  }

  // Volume completely dried up — concerning regardless of price direction
  if (av5 > 0 && todayVol < 0.3 * av5) {
    volumeScore -= 15; volReasons.push('量能極度萎縮');
  }

  if (volReasons.length === 0) volReasons.push('量能普通');

  // ------------------------------------------------------------------
  // CHIPS (0–100, weight 20%)
  // Baseline 50 = no data or neutral institutional activity.
  // One day of foreign selling is NOT a red flag — only persistent
  // selling (3 consecutive days) warrants a meaningful deduction.
  // ------------------------------------------------------------------
  let chipsScore = 50;
  const chipsReasons: string[] = [];

  if (institutional && institutional.length >= 1) {
    const recent3 = institutional.slice(-3);
    const recent1 = institutional[institutional.length - 1];

    const foreignNet3   = recent3.reduce((s, r) => s + Number(r.foreign_net ?? 0), 0);
    const trustNet3     = recent3.reduce((s, r) => s + Number(r.trust_net   ?? 0), 0);
    const allForeignPos = recent3.length >= 3 && recent3.every((r) => Number(r.foreign_net ?? 0) > 0);
    const allTrustPos   = recent3.length >= 3 && recent3.every((r) => Number(r.trust_net   ?? 0) > 0);
    const anyForeignPos = recent3.some((r) => Number(r.foreign_net ?? 0) > 0);
    const anyTrustPos   = recent3.some((r) => Number(r.trust_net   ?? 0) > 0);
    const allForeignNeg = recent3.every((r) => Number(r.foreign_net ?? 0) < 0);
    const allTrustNeg   = recent3.every((r) => Number(r.trust_net   ?? 0) < 0);
    const foreignToday  = Number(recent1?.foreign_net ?? 0);
    const trustToday    = Number(recent1?.trust_net   ?? 0);

    // Foreign institutional — meaningful only when persistent
    if (allForeignPos) {
      chipsScore += 30; chipsReasons.push(`外資連買3日(+${foreignNet3})`);
    } else if (anyForeignPos) {
      chipsScore += 10; chipsReasons.push('外資近期買超');
    } else if (allForeignNeg) {
      chipsScore -= 25; chipsReasons.push('外資連賣3日');
    } else if (foreignToday < 0) {
      // Single day sell — minor deduction only, not a trend signal
      chipsScore -= 5; chipsReasons.push('外資今日賣超');
    }

    // Investment trust — secondary institutional signal
    if (allTrustPos) {
      chipsScore += 20; chipsReasons.push(`投信連買3日(+${trustNet3})`);
    } else if (anyTrustPos) {
      chipsScore += 8; chipsReasons.push('投信近期買超');
    } else if (allTrustNeg) {
      chipsScore -= 15; chipsReasons.push('投信連賣3日');
    } else if (trustToday < 0) {
      chipsScore -= 3; chipsReasons.push('投信今日賣超');
    }
  }

  if (margin && margin.length >= 2) {
    const latest = margin[margin.length - 1];
    const prev   = margin[margin.length - 2];
    const marginBal  = Number(latest.margin_balance ?? 0);
    const marginPrev = Number(prev.margin_balance   ?? 0);
    const shortBal   = Number(latest.short_balance  ?? 0);
    const shortPrev  = Number(prev.short_balance    ?? 0);

    if (marginBal < marginPrev) {
      chipsScore += 8; chipsReasons.push('融資餘額下降(健康)');
    } else if (marginBal > marginPrev * 1.05) {
      chipsScore -= 8; chipsReasons.push('融資快速增加');
    }

    if (shortBal > shortPrev * 1.1) {
      chipsScore += 8; chipsReasons.push('空單增加(軋空潛力)');
    } else if (shortBal < shortPrev) {
      chipsScore -= 5; chipsReasons.push('空單回補(賣壓)');
    }
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



// =============================================================================
// Legacy fundamentals-based health score (used by /api/stock/[symbol]/score)
// =============================================================================

export interface HealthScoreInput {
  pe_ratio:                 number | null;
  pb_ratio:                 number | null;
  roe:                      number | null;
  gross_margin:             number | null;
  net_margin:               number | null;
  revenue_growth_yoy:       number | null;
  eps_growth_yoy:           number | null;
  debt_ratio:               number | null;
  foreign_consecutive_days: number | null;
  triple_buy:               boolean;
  latest_yield_pct:         number | null;
  consecutive_years:        number | null;
  stability_score:          number | null;
}

export interface HealthScoreResult {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
  breakdown: {
    profitability: number;
    growth:        number;
    safety:        number;
    chips:         number;
  };
  strengths: string[];
  warnings:  string[];
}

export function computeHealthScore(input: HealthScoreInput): HealthScoreResult {
  const strengths: string[] = [];
  const warnings:  string[] = [];

  // Profitability (0–100)
  // pe_ratio and roe are not yet in DB — score from gross_margin + net_margin.
  // When those columns are populated later, add them back here.
  let profitability = 0;
  if (input.roe !== null) {
    if (input.roe >= 20)      { profitability += 40; strengths.push('ROE優異(≥20%)'); }
    else if (input.roe >= 12) { profitability += 25; }
    else if (input.roe < 5)   { warnings.push('ROE偏低'); }
  }
  if (input.gross_margin !== null) {
    if (input.gross_margin >= 50)      { profitability += 50; strengths.push('毛利率高(≥50%)'); }
    else if (input.gross_margin >= 30) { profitability += 35; strengths.push('毛利率良好'); }
    else if (input.gross_margin >= 15) { profitability += 15; }
    else                               { warnings.push('毛利率偏低'); }
  }
  if (input.net_margin != null) {
    const nm = Number(input.net_margin);
    if (nm >= 20)      { profitability += 50; strengths.push('淨利率優異(≥20%)'); }
    else if (nm >= 10) { profitability += 30; strengths.push('淨利率良好'); }
    else if (nm >= 5)  { profitability += 15; }
    else if (nm < 0)   { warnings.push('淨利率為負'); }
  }
  if (input.pe_ratio !== null) {
    if (input.pe_ratio > 0 && input.pe_ratio <= 15)      { profitability += 30; strengths.push('本益比合理'); }
    else if (input.pe_ratio > 0 && input.pe_ratio <= 25) { profitability += 15; }
    else if (input.pe_ratio > 40)                        { warnings.push('本益比偏高'); }
  }

  // Growth (0–100)
  let growth = 0;
  if (input.revenue_growth_yoy !== null) {
    if (input.revenue_growth_yoy >= 20)  { growth += 50; strengths.push('營收高速成長'); }
    else if (input.revenue_growth_yoy >= 10) { growth += 30; }
    else if (input.revenue_growth_yoy >= 0)  { growth += 15; }
    else { warnings.push('營收年減'); }
  }
  if (input.eps_growth_yoy !== null) {
    if (input.eps_growth_yoy >= 20)  { growth += 50; strengths.push('EPS高速成長'); }
    else if (input.eps_growth_yoy >= 10) { growth += 30; }
    else if (input.eps_growth_yoy >= 0)  { growth += 15; }
    else { warnings.push('EPS年減'); }
  }

  // Safety (0–100)
  // debt_ratio and pb_ratio are not yet in DB — safety scoring uses dividend data only for now.
  // When those columns are populated, the stubs below will activate automatically.
  let safety = 0;
  if (input.debt_ratio !== null) {
    if (input.debt_ratio <= 30)      { safety += 40; strengths.push('負債比低(≤30%)'); }
    else if (input.debt_ratio <= 50) { safety += 25; }
    else if (input.debt_ratio > 70)  { warnings.push('負債比偏高'); }
  }
  if (input.pb_ratio !== null) {
    if (input.pb_ratio > 0 && input.pb_ratio <= 1.5) { safety += 20; strengths.push('股價淨值比低'); }
    else if (input.pb_ratio > 0 && input.pb_ratio <= 3) { safety += 10; }
  }
  if (input.latest_yield_pct !== null) {
    if (input.latest_yield_pct >= 5)      { safety += 40; strengths.push(`高殖利率${input.latest_yield_pct.toFixed(1)}%`); }
    else if (input.latest_yield_pct >= 3) { safety += 25; strengths.push(`殖利率${input.latest_yield_pct.toFixed(1)}%`); }
    else if (input.latest_yield_pct > 0)  { safety += 10; }
  }
  if (input.consecutive_years !== null) {
    if (input.consecutive_years >= 10)    { safety += 40; strengths.push(`連續配息${input.consecutive_years}年`); }
    else if (input.consecutive_years >= 5){ safety += 25; strengths.push(`連續配息${input.consecutive_years}年`); }
    else if (input.consecutive_years >= 2){ safety += 10; }
  }

  // Chips (0–100)
  let chips = 0;
  if (input.foreign_consecutive_days !== null) {
    if (input.foreign_consecutive_days >= 5)   { chips += 50; strengths.push(`外資連買${input.foreign_consecutive_days}日`); }
    else if (input.foreign_consecutive_days >= 3) { chips += 30; }
    else if (input.foreign_consecutive_days <= -3) { warnings.push('外資連賣'); }
  }
  if (input.triple_buy) { chips += 50; strengths.push('三大法人同步買超'); }

  // Weighted overall
  const score = Math.round(
    profitability * 0.30 +
    growth        * 0.25 +
    safety        * 0.25 +
    chips         * 0.20,
  );

  const grade: HealthScoreResult['grade'] =
    score >= 75 ? 'A' :
    score >= 55 ? 'B' :
    score >= 35 ? 'C' : 'D';

  return {
    score: Math.min(100, score),
    grade,
    breakdown: { profitability, growth, safety, chips },
    strengths: strengths.slice(0, 5),
    warnings:  warnings.slice(0, 3),
  };
}