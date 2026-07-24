// =============================================================================
// lib/scoring.ts — Composite technical score for 台股雷達
// Weights: trend 25%, momentum 20%, volume 20%, chips 20%, pattern 10%, sentiment 5%
//
// Intraday awareness: when the last candle is today's live price, volume
// scoring uses a higher baseline and skips shrinkage penalties because
// partial-day volume always looks low vs a full-day 5-day average.
// Chips dimension always reflects T+1 institutional data (released after close).
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
  technicalReading: '技術面強勢' | '技術面轉強' | '中性' | '技術面轉弱' | '技術面弱勢';
  isIntraday: boolean;   // true when score uses live intraday price
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

function getTaiwanDateString(): string {
  return new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
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

  // Detect if the last candle is today's live intraday price.
  const taiwanToday = getTaiwanDateString();
  const isIntraday  = (candles[n - 1]?.date ?? '') === taiwanToday;

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
  //
  // FIX: Each MA condition is evaluated as mutually exclusive (bullish
  // OR bearish, never both). This prevents contradictory reasons like
  // "今日上漲，價<5MA" appearing simultaneously with bullish additions
  // and bearish deductions cancelling each other out incorrectly.
  //
  // Baseline 40 = neutral.
  // Bullish stack: +10 (今日上漲) +15 (價>5MA) +20 (5MA>20MA)
  //                +15 (20MA>60MA) +10 (價>60MA) → max +70 → 110, clamped 100
  // Bearish stack: -10 (今日下跌) -15 (價<5MA) -20 (5MA<20MA)
  //                -15 (20MA<60MA) → max -60 → -20, clamped 0
  // ------------------------------------------------------------------
  let trendScore = 40;
  const trendReasons: string[] = [];

  // Today's candle direction — mutually exclusive
  if (today.close > today.open) {
    trendScore += 10; trendReasons.push('今日上漲');
  } else if (today.close < today.open) {
    trendScore -= 10; trendReasons.push('今日下跌');
  }

  // Price vs 5MA — mutually exclusive
  if (m5Now !== null) {
    if (today.close > m5Now)  { trendScore += 15; trendReasons.push('價>5MA'); }
    else if (today.close < m5Now) { trendScore -= 15; trendReasons.push('價<5MA'); }
  }

  // 5MA vs 20MA — mutually exclusive
  if (m5Now !== null && m20Now !== null) {
    if (m5Now > m20Now)  { trendScore += 20; trendReasons.push('5MA>20MA'); }
    else if (m5Now < m20Now) { trendScore -= 20; trendReasons.push('5MA<20MA'); }
  }

  // 20MA vs 60MA — mutually exclusive
  if (m20Now !== null && m60Now !== null) {
    if (m20Now > m60Now)  { trendScore += 15; trendReasons.push('20MA>60MA'); }
    else if (m20Now < m60Now) { trendScore -= 15; trendReasons.push('20MA<60MA'); }
  }

  // Price vs 60MA — bonus only (no extra bearish deduction, 5MA<20MA already captures it)
  if (m60Now !== null && today.close > m60Now) {
    trendScore += 10; trendReasons.push('價>60MA');
  }

  // ------------------------------------------------------------------
  // MOMENTUM (0–100, weight 20%)
  // ------------------------------------------------------------------
  let momentumScore = 0;
  const momReasons: string[] = [];

  if (rsiNow !== null) {
    if (rsiNow >= 50 && rsiNow <= 70) { momentumScore += 40; momReasons.push(`RSI ${rsiNow.toFixed(0)}(強勢區)`); }
    else if (rsiNow > 70)             { momentumScore += 20; momReasons.push(`RSI ${rsiNow.toFixed(0)}(偏高)`); }
    else if (rsiNow >= 40)            { momentumScore += 10; momReasons.push(`RSI ${rsiNow.toFixed(0)}(中性)`); }
    else                              { momentumScore -= 20; momReasons.push(`RSI ${rsiNow.toFixed(0)}(弱勢)`); }
  }

  if (macdLine !== null && sigLine !== null) {
    if (macdLine > sigLine && macdLine > 0) { momentumScore += 30; momReasons.push('MACD多頭'); }
    else if (macdLine > sigLine)            { momentumScore += 15; momReasons.push('MACD金叉'); }
  }

  if (kNow !== null && dNow !== null) {
    if (kNow > dNow && kNow > 50) { momentumScore += 30; momReasons.push(`K(${kNow.toFixed(0)})>D多頭`); }
    else if (kNow > dNow)         { momentumScore += 15; momReasons.push('KD金叉'); }
  }

  // ------------------------------------------------------------------
  // VOLUME (0–100, weight 20%)
  // ------------------------------------------------------------------
  let volumeScore = isIntraday ? 60 : 50;
  const volReasons: string[] = [];

  const av5 = avgVol(candles, 5, 1);
  const todayVol = today.volume ?? 0;

  if (av5 > 0) {
    const vr = todayVol / av5;
    if (vr >= 2) {
      volumeScore += 25; volReasons.push(`量比${vr.toFixed(1)}x(暴增)`);
    } else if (vr >= 1.5) {
      volumeScore += 15; volReasons.push(`量比${vr.toFixed(1)}x(放量)`);
    } else if (vr >= 1) {
      volReasons.push(`量比${vr.toFixed(1)}x(正常)`);
    } else if (!isIntraday) {
      if (vr < 0.5)       { volumeScore -= 20; volReasons.push(`量比${vr.toFixed(1)}x(極度萎縮)`); }
      else if (vr < 0.8)  { volumeScore -= 10; volReasons.push(`量比${vr.toFixed(1)}x(縮量)`); }
    } else {
      volReasons.push(`盤中量${vr.toFixed(1)}x(累計中)`);
    }
  }

  if (obvData.length > 5 && obvData[obvData.length - 1] > obvData[obvData.length - 6]) {
    volumeScore += 20; volReasons.push('OBV上升');
  }

  if (av5 > 0 && todayVol > 1.5 * av5 && today.close < today.open) {
    volumeScore -= 25; volReasons.push('出貨警告');
  }

  if (!isIntraday && av5 > 0 && todayVol < 0.3 * av5) {
    volumeScore -= 15; volReasons.push('量能極度萎縮');
  }

  if (volReasons.length === 0) volReasons.push('量能普通');

  // ------------------------------------------------------------------
  // CHIPS (0–100, weight 20%)
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

    if (allForeignPos) {
      chipsScore += 30; chipsReasons.push(`外資連買3日(+${foreignNet3})`);
    } else if (anyForeignPos) {
      chipsScore += 10; chipsReasons.push('外資近期買超');
    } else if (allForeignNeg) {
      chipsScore -= 25; chipsReasons.push('外資連賣3日');
    } else if (foreignToday < 0) {
      chipsScore -= 5; chipsReasons.push('外資今日賣超');
    }

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

  if (isIntraday) {
    chipsReasons.push('(籌碼為昨日資料)');
  }

  // ------------------------------------------------------------------
  // PATTERN (0–100, weight 10%)
  // ------------------------------------------------------------------
  let patternScore = 40;
  const patReasons: string[] = [];

  const patterns = detectPatterns(candles);
  const breakouts = detectAllBreakouts(candles, {
    sma5, sma20, sma60, rsi14, macd: macdData,
  });

  const PATTERN_POINTS: Record<string, number> = {
    '紅三兵':   20,
    '孤島晨星': 20,
    '晨星':     15,
    '多頭吞噬': 12,
    '低檔長紅': 12,
    '錘子線':   8,
    '一星二陽': 8,
    '圓形底':   10,
    '孕線':     5,
    '長下影線': 5,
    '十字星':   0,
    '夜星':    -15,
    '黑三兵':  -20,
    '空頭吞噬':-12,
    '倒錘子線': -5,
  };

  let bullishPoints = 0;
  let bearishPoints = 0;

  for (const p of patterns) {
    const pts = PATTERN_POINTS[p.name] ?? 0;
    if (pts > 0)      { bullishPoints += pts; patReasons.push(`+${p.name}`); }
    else if (pts < 0) { bearishPoints += Math.abs(pts); patReasons.push(`-${p.name}`); }
  }

  patternScore += Math.min(bullishPoints, 50);
  patternScore -= Math.min(bearishPoints, 40);

  const strongBreakout = breakouts.find((b) => b.confidence > 70);
  if (strongBreakout) {
    patternScore += 20;
    patReasons.push(`突破訊號(${strongBreakout.type})`);
  }

  const matrix = evaluateSignalMatrix(candles, indicatorSnapshot, institutional);
  if (matrix.strengthCount >= 6) {
    patternScore += 15;
    patReasons.push(`強勢指標${matrix.strengthCount}/9`);
  }

  // ------------------------------------------------------------------
  // SENTIMENT (0–100, weight 5%)
  //
  // FIX 1: Widen bearish pattern lookback from 3 candles to 5 candles.
  //        A 空頭吞噬 3 bars ago should still affect sentiment.
  // FIX 2: When bearish patterns exist anywhere in detected patterns
  //        (not just recent), still suppress the "近期無空頭型態" bonus.
  //        The +10 bonus is only awarded when patterns list is fully clean.
  // FIX 3: Sentiment baseline drops when trend is deeply bearish (< 35)
  //        to avoid contradictory "情緒80 + 趨勢30" combinations.
  // ------------------------------------------------------------------
  let sentimentScore = 40;
  const sentReasons: string[] = [];

  // FIX 3: Align sentiment baseline with trend environment
  if (trendScore < 35) {
    sentimentScore = 30;
    sentReasons.push('弱勢趨勢環境');
  }

  if (rsiNow !== null) {
    if (rsiNow >= 40 && rsiNow <= 65) {
      sentimentScore += 20; sentReasons.push('RSI健康區');
    } else if (rsiNow > 75) {
      sentimentScore -= 15; sentReasons.push('RSI過熱');
    } else if (rsiNow < 30) {
      sentimentScore -= 20; sentReasons.push('RSI超賣');
    } else {
      sentReasons.push('RSI中性');
    }
  }

  const bbUpper = last(bbData.upper) as number | null;
  const bbLower = last(bbData.lower) as number | null;
  if (bbUpper !== null && today.close > bbUpper) {
    sentimentScore -= 10; sentReasons.push('觸及布林上軌(過熱)');
  } else if (bbUpper !== null) {
    sentimentScore += 10; sentReasons.push('未觸布林上軌');
  }

  if (bbLower !== null && today.close < bbLower) {
    sentimentScore -= 15; sentReasons.push('跌破布林下軌');
  }

  // FIX 1+2: Widen window to 5 candles; also check if any bearish pattern
  // exists in the full detected list (deduped by name) to suppress the bonus.
  const recentBear = patterns.filter((p) => p.type === 'bearish' && p.candleIndex >= n - 5);
  const anyBearPattern = patterns.some((p) => p.type === 'bearish');

  if (recentBear.length > 0) {
    sentimentScore -= 15;
    sentReasons.push(`近期空頭型態(${[...new Set(recentBear.map(p => p.name))].join('/')})`);
  } else if (!anyBearPattern) {
    // Only give the bonus when there are genuinely zero bearish patterns
    sentimentScore += 10; sentReasons.push('近期無空頭型態');
  }

  const vol3    = candles.slice(Math.max(0, n - 3)).map((c) => c.volume ?? 0);
  const volMean = vol3.reduce((s, v) => s + v, 0) / (vol3.length || 1);
  const volStd  = Math.sqrt(vol3.reduce((s, v) => s + (v - volMean) ** 2, 0) / (vol3.length || 1));
  if (!isIntraday && volMean > 0 && volStd / volMean < 0.3) {
    sentimentScore += 15; sentReasons.push('量能穩定');
  } else if (!isIntraday && volMean > 0 && volStd / volMean > 0.8) {
    sentimentScore -= 10; sentReasons.push('量能不穩');
  }

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
    overall >= 60 ? '技術面轉強' :
    overall >= 40 ? '中性'       :
    overall >= 25 ? '技術面轉弱' : '技術面弱勢';

  return {
    overall: clamp(overall),
    technicalReading,
    isIntraday,
    dimensions: {
      trend:     { score: clamp(trendScore),     reason: trendReasons.join('，') || '趨勢不明' },
      momentum:  { score: clamp(momentumScore),  reason: momReasons.join('，')   || '動能偏弱' },
      volume:    { score: clamp(volumeScore),     reason: volReasons.join('，')   || '量能普通' },
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
  sector?:                  string | null;
  flow_size_ratio?:         number | null;
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
  // NOTE: gross_margin/net_margin are manufacturing/retail concepts that
  // don't apply to financial holding companies (banks, insurers) — they're
  // structurally always null for that sector, worth 100 of the 170 possible
  // raw points below. Without adjustment, even a flawless bank could never
  // score above ROE(40)+PE(30)=70/100. When both margins are genuinely
  // inapplicable (financial sector, both null), rescale so the achievable
  // range still reaches 100.
  let profitability = 0;
  if (input.roe !== null) {
    if (input.roe >= 20)      { profitability += 40; strengths.push('ROE ≥ 20%'); }
    else if (input.roe >= 12) { profitability += 25; }
    else if (input.roe >= 8)  { profitability += 15; }
    else if (input.roe >= 5)  { profitability += 8; }
    else                      { warnings.push('ROE偏低'); }
  }
  if (input.gross_margin !== null) {
    if (input.gross_margin >= 50)      { profitability += 50; strengths.push('毛利率 ≥ 50%'); }
    else if (input.gross_margin >= 30) { profitability += 35; strengths.push('毛利率 ≥ 30%'); }
    else if (input.gross_margin >= 15) { profitability += 15; }
    else                               { warnings.push('毛利率偏低'); }
  }
  if (input.net_margin != null) {
    const nm = Number(input.net_margin);
    if (nm >= 20)      { profitability += 50; strengths.push('淨利率 ≥ 20%'); }
    else if (nm >= 10) { profitability += 30; strengths.push('淨利率 ≥ 10%'); }
    else if (nm >= 5)  { profitability += 15; }
    else if (nm < 0)   { warnings.push('淨利率為負'); }
  }
  if (input.pe_ratio !== null) {
    if (input.pe_ratio > 0 && input.pe_ratio <= 15)      { profitability += 30; strengths.push('本益比 ≤ 15'); }
    else if (input.pe_ratio > 0 && input.pe_ratio <= 25) { profitability += 15; }
    else if (input.pe_ratio > 40)                        { warnings.push('本益比偏高'); }
  }
  const isFinancialForProfitability = (input.sector ?? '').includes('金融');
  if (isFinancialForProfitability && input.gross_margin === null && input.net_margin === null) {
    // Achievable max without margins: ROE(40) + PE(30) = 70. Rescale to 100.
    profitability = Math.round(Math.min(profitability, 70) * (100 / 70));
  }

  // Growth (0–100)
  let growth = 0;
  if (input.revenue_growth_yoy !== null) {
    if (input.revenue_growth_yoy >= 20)      { growth += 50; strengths.push('營收高速成長'); }
    else if (input.revenue_growth_yoy >= 10) { growth += 30; }
    else if (input.revenue_growth_yoy >= 0)  { growth += 15; }
    else { warnings.push('營收年減'); }
  }
  if (input.eps_growth_yoy !== null) {
    if (input.eps_growth_yoy >= 20)      { growth += 50; strengths.push('EPS高速成長'); }
    else if (input.eps_growth_yoy >= 10) { growth += 30; }
    else if (input.eps_growth_yoy >= 0)  { growth += 15; }
    else { warnings.push('EPS年減'); }
  }

  // Safety (0–100)
  // NOTE: debt_ratio is skipped for financial-sector stocks (banks, insurers,
  // financial holding companies). Their liabilities are structurally ~85-95%+
  // because customer deposits / policy reserves are booked as liabilities —
  // that's normal, healthy banking, not a solvency warning. Applying the
  // generic debt-ratio threshold here would incorrectly penalize the entire
  // 金融保險 sector regardless of actual financial health.
  const isFinancialSector = (input.sector ?? '').includes('金融');
  let safety = 0;
  if (input.debt_ratio !== null && !isFinancialSector) {
    if (input.debt_ratio <= 30)      { safety += 40; strengths.push('負債比 ≤ 30%'); }
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
    if (input.consecutive_years >= 10)     { safety += 40; strengths.push(`連續配息${input.consecutive_years}年`); }
    else if (input.consecutive_years >= 5) { safety += 25; strengths.push(`連續配息${input.consecutive_years}年`); }
    else if (input.consecutive_years >= 2) { safety += 10; }
  }

  // Chips (0–100)
  // NOTE: previously only >=3-day streaks scored any points, and >=5-day
  // streaks scored the same as a fresh 3-day streak once triple_buy was
  // added — meaning most days (anything in the very common -2 to +2 range)
  // scored a flat 0, and even a 3+ day SELL streak produced only a text
  // warning with no actual point deduction. Graduated tiers below give
  // proportional credit/penalty instead of an all-or-nothing cliff.
  let chips = 0;
  if (input.foreign_consecutive_days !== null) {
    const d = input.foreign_consecutive_days;
    if (d >= 5)       { chips += 50; strengths.push(`外資連買${d}日`); }
    else if (d >= 3)  { chips += 30; strengths.push(`外資連買${d}日`); }
    else if (d >= 1)  { chips += 15; }
    else if (d <= -5) { chips -= 30; warnings.push(`外資連賣${Math.abs(d)}日`); }
    else if (d <= -3) { chips -= 20; warnings.push(`外資連賣${Math.abs(d)}日`); }
    else if (d <= -1) { chips -= 10; }
  }
  if (input.triple_buy) { chips += 50; strengths.push('三大法人同步買超'); }

  // Outsized single-day flow bonus — independent of streak length, so a
  // massive one-day buy still stands out even when it's only day 1-2 of a
  // fresh streak (which alone would score modestly under the tiers above).
  if (input.flow_size_ratio != null) {
    const r = input.flow_size_ratio;
    if (r >= 8)      { chips += 20; strengths.push('外資單日爆量買超'); }
    else if (r >= 4) { chips += 10; }
  }

  chips = Math.max(0, Math.min(100, chips));

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