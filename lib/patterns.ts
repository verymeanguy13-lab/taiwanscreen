// =============================================================================
// lib/patterns.ts ??Candlestick pattern detection for ?啗?琿?
// Scans the last 20 candles of the provided array.
// All criteria use strict OHLC math ??no magic numbers without comment.
// =============================================================================

import type { Candle } from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DetectedPattern {
  name: string;              // Chinese name e.g. '雿??瑞?'
  nameEN: string;
  type: 'bullish' | 'bearish' | 'neutral';
  candleIndex: number;       // index in the ORIGINAL candles array
  candleCount: number;       // 1, 2, or 3
  confidence: number;        // 0??00
  historicalWinRate: number; // literature-based base rate
  description: string;       // one-sentence Chinese explanation
  technicalReading:
    | '撘瑕蝒'
    | '???澆?'
    | '?斗閫撖?
    | '?征?澆?'
    | '撘勗?渡?';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function upperShadow(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function range(c: Candle): number {
  return c.high - c.low;
}

function avgBody(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + body(c), 0) / candles.length;
}

function avgVolume(candles: Candle[]): number {
  const vols = candles.map((c) => c.volume ?? 0);
  if (vols.length === 0) return 0;
  return vols.reduce((s, v) => s + v, 0) / vols.length;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

function isDoji(c: Candle): boolean {
  return body(c) < 0.1 * range(c);
}

// 20-day high/low for the context window
function periodRange(
  candles: Candle[],
  upTo: number,
  lookback = 20,
): { high: number; low: number } {
  const start = Math.max(0, upTo - lookback + 1);
  const slice = candles.slice(start, upTo + 1);
  return {
    high: Math.max(...slice.map((c) => c.high)),
    low: Math.min(...slice.map((c) => c.low)),
  };
}

function clamp(v: number, lo = 0, hi = 100): number {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function detectPatterns(candles: Candle[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  if (candles.length < 3) return results;

  // Only scan the last 20 candles (but use the full array for context)
  const scanStart = Math.max(0, candles.length - 20);

  for (let i = scanStart; i < candles.length; i++) {
    const c = candles[i];
    const prev1 = i >= 1 ? candles[i - 1] : null;
    const prev2 = i >= 2 ? candles[i - 2] : null;

    // Context metrics (use up to 10 candles before i)
    const ctxCandles = candles.slice(Math.max(0, i - 10), i);
    const ab = avgBody(ctxCandles.length > 0 ? ctxCandles : [c]);
    const av = avgVolume(ctxCandles.length > 0 ? ctxCandles : [c]);
    const pr = periodRange(candles, i, 20);
    const totalRange = pr.high - pr.low;
    const vol = c.volume ?? 0;

    // -----------------------------------------------------------------------
    // SINGLE-CANDLE BULLISH
    // -----------------------------------------------------------------------

    // 雿??瑞?
    if (
      isBullish(c) &&
      body(c) > 2 * ab &&
      c.close < pr.low + 0.35 * totalRange
    ) {
      let confidence = 65;
      if (vol > 1.5 * av) confidence += 20;
      results.push({
        name: '雿??瑞?',
        nameEN: 'Low-Base Long Red',
        type: 'bullish',
        candleIndex: i,
        candleCount: 1,
        confidence: clamp(confidence),
        historicalWinRate: 62,
        description: '?其?瑼?曉之?蝝璉?憿舐內憭撘瑕?隞嚗?甇Ｚ?閮???,
        technicalReading: '???澆?',
      });
    }

    // ??蝺?    if (
      lowerShadow(c) > 2 * body(c) &&
      upperShadow(c) < 0.3 * body(c) &&
      c.close > pr.low + 0.7 * totalRange // body in upper 30% of range
    ) {
      let confidence = 60;
      // Preceded by 3 lower closes
      if (
        i >= 3 &&
        candles[i - 1].close < candles[i - 2].close &&
        candles[i - 2].close < candles[i - 3].close
      ) {
        confidence += 15;
      }
      results.push({
        name: '??蝺?,
        nameEN: 'Hammer',
        type: 'bullish',
        candleIndex: i,
        candleCount: 1,
        confidence: clamp(confidence),
        historicalWinRate: 60,
        description: '?瑚?敶梁???蝺?橘?隞?”銝?舀?撘瑕?嚗征?剖?蝡准?,
        technicalReading: '???澆?',
      });
    }

    // ?瑚?敶梁? (broader than hammer ??any direction)
    if (lowerShadow(c) > 3 * body(c) && body(c) > 0) {
      results.push({
        name: '?瑚?敶梁?',
        nameEN: 'Long Lower Shadow',
        type: 'bullish',
        candleIndex: i,
        candleCount: 1,
        confidence: 55,
        historicalWinRate: 55,
        description: '?瑚?敶梁?憿舐內?支葉?剝Ｚ都憯??嗥?脣??舀?嚗眺?孵??筑?整?,
        technicalReading: '?斗閫撖?,
      });
    }

    // ????    if (range(c) > 0 && Math.abs(c.open - c.close) < 0.1 * range(c)) {
      results.push({
        name: '????,
        nameEN: 'Doji',
        type: 'neutral',
        candleIndex: i,
        candleCount: 1,
        confidence: 50,
        historicalWinRate: 50,
        description: '??文撟曆??詨?嚗??游?蝛箏???銵∴?敺??孵?銝???,
        technicalReading: '?斗閫撖?,
      });
    }

    // -----------------------------------------------------------------------
    // SINGLE-CANDLE BEARISH
    // -----------------------------------------------------------------------

    // ??摮?
    if (
      upperShadow(c) > 2 * body(c) &&
      lowerShadow(c) < 0.3 * body(c)
    ) {
      let confidence = 58;
      if (vol > 1.5 * av) confidence += 10;
      results.push({
        name: '??摮?',
        nameEN: 'Inverted Hammer / Shooting Star',
        type: 'bearish',
        candleIndex: i,
        candleCount: 1,
        confidence: clamp(confidence),
        historicalWinRate: 57,
        description: '?瑚?敶梁???摮??箇嚗??寡都憯????航??????,
        technicalReading: '?征?澆?',
      });
    }

    // -----------------------------------------------------------------------
    // TWO-CANDLE BULLISH
    // -----------------------------------------------------------------------

    if (prev1) {
      // 憭?
      if (
        isBearish(prev1) &&
        c.open < prev1.close &&
        c.close > prev1.open &&
        isBullish(c)
      ) {
        // SMA20 proximity boost
        const sma20 = candles
          .slice(Math.max(0, i - 19), i + 1)
          .reduce((s, x) => s + x.close, 0) / Math.min(20, i + 1);
        let confidence = 68;
        if (Math.abs(c.close - sma20) / sma20 < 0.02) confidence += 20;
        results.push({
          name: '憭?',
          nameEN: 'Bullish Engulfing',
          type: 'bullish',
          candleIndex: i,
          candleCount: 2,
          confidence: clamp(confidence),
          historicalWinRate: 65,
          description: '隞憭折蝺??典??祆?仿蝺?憭撘瑕?嚗?頧???蝣箝?,
          technicalReading: '???澆?',
        });
      }

      // 摮? (Harami ??prev large, today small fully inside)
      if (
        body(prev1) > ab * 1.5 &&
        body(c) < body(prev1) * 0.5 &&
        c.open > Math.min(prev1.open, prev1.close) &&
        c.close < Math.max(prev1.open, prev1.close) &&
        isBullish(prev1)
      ) {
        results.push({
          name: '摮?',
          nameEN: 'Bullish Harami',
          type: 'bullish',
          candleIndex: i,
          candleCount: 2,
          confidence: 58,
          historicalWinRate: 53,
          description: '撠祕擃??典?憭折蝺??嚗??剛??ｇ??航蝒??,
          technicalReading: '?斗閫撖?,
        });
      }

      // 蝛粹?
      if (
        isBullish(prev1) &&
        c.open > prev1.close &&
        c.close < prev1.open &&
        isBearish(c)
      ) {
        let confidence = 68;
        if (vol > 1.5 * av) confidence += 12;
        results.push({
          name: '蝛粹?',
          nameEN: 'Bearish Engulfing',
          type: 'bearish',
          candleIndex: i,
          candleCount: 2,
          confidence: clamp(confidence),
          historicalWinRate: 64,
          description: '隞憭折蝺??典??祆?仿蝺?蝛箸撘瑕?憯嚗隅?Ｗ?頧?銝?,
          technicalReading: '?征?澆?',
        });
      }
    }

    // -----------------------------------------------------------------------
    // THREE-CANDLE PATTERNS
    // -----------------------------------------------------------------------

    if (prev1 && prev2) {
      // ?冽? (Morning Star)
      if (
        isBearish(prev2) &&
        body(prev2) > ab &&
        isDoji(prev1) &&
        isBullish(c) &&
        c.close > prev2.open + (prev2.close - prev2.open) * 0.5
      ) {
        results.push({
          name: '?冽?',
          nameEN: 'Morning Star',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 72,
          historicalWinRate: 68,
          description: '銝?冽????箇嚗洵銝憭折蝺敺抵?撟曉?嚗??典?頧??撥??,
          technicalReading: '???澆?',
        });
      }

      // 摮文雀?冽? (Island Morning Star ??gap down then gap up)
      if (
        isBearish(prev2) &&
        prev1.high < prev2.low && // gap down into star
        c.low > prev1.high &&     // gap up out
        isBullish(c)
      ) {
        results.push({
          name: '摮文雀?冽?',
          nameEN: 'Island Morning Star',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 88,
          historicalWinRate: 75,
          description: '蝻箏摮文雀?冽?嚗?銝??歲蝛箇撩???蝛粹摰憭勗?嚗撥???典?頧?,
          technicalReading: '撘瑕蝒',
        });
      }

      // 銝????(One Star, Two Yang)
      if (
        isBearish(prev2) &&
        (isDoji(prev1) || body(prev1) < 0.5 * ab) &&
        isBullish(c) &&
        c.close > (prev2.open + prev2.close) / 2 // close above midpoint of first
      ) {
        results.push({
          name: '銝????,
          nameEN: 'One Star, Two Yang',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 65,
          historicalWinRate: 61,
          description: '銝?敺?暹?蝺??園嚗??寥??啣?敺蜓撠?摨閮?蝣箇???,
          technicalReading: '???澆?',
        });
      }

      // 蝝???(Three White Soldiers)
      if (
        isBullish(prev2) &&
        isBullish(prev1) &&
        isBullish(c) &&
        prev1.open > prev2.open &&
        prev1.open < prev2.close &&
        c.open > prev1.open &&
        c.open < prev1.close &&
        c.close > prev1.close &&
        prev1.close > prev2.close
      ) {
        results.push({
          name: '蝝???,
          nameEN: 'Three White Soldiers',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 75,
          historicalWinRate: 70,
          description: '銝靘?韏圈??蝺?憭????嚗撥?Ｖ?瞍脫撅蝣箇???,
          technicalReading: '撘瑕蝒',
        });
      }

      // 憭? (Evening Star)
      if (
        isBullish(prev2) &&
        body(prev2) > ab &&
        isDoji(prev1) &&
        isBearish(c) &&
        c.close < prev2.close - (prev2.close - prev2.open) * 0.5
      ) {
        results.push({
          name: '憭?',
          nameEN: 'Evening Star',
          type: 'bearish',
          candleIndex: i,
          candleCount: 3,
          confidence: 72,
          historicalWinRate: 67,
          description: '銝憭???嚗洵銝憭折蝺??砍之?撞撟??剝??閮?蝣箇???,
          technicalReading: '?征?澆?',
        });
      }

      // 暺???(Three Black Crows)
      if (
        isBearish(prev2) &&
        isBearish(prev1) &&
        isBearish(c) &&
        prev1.open < prev2.open &&
        prev1.open > prev2.close &&
        c.open < prev1.open &&
        c.open > prev1.close &&
        c.close < prev1.close &&
        prev1.close < prev2.close
      ) {
        results.push({
          name: '暺???,
          nameEN: 'Three Black Crows',
          type: 'bearish',
          candleIndex: i,
          candleCount: 3,
          confidence: 75,
          historicalWinRate: 69,
          description: '銝靘?韏唬??蝺?蝛箸??憯嚗摹?Ｖ?頝撅蝣箇???,
          technicalReading: '撘勗?渡?',
        });
      }

      // ?耦摨?(Rounding Bottom) ??checks 15-20 candle gradual curve
      if (i >= 19) {
        const window = candles.slice(i - 19, i + 1); // 20 candles
        const closes = window.map((x) => x.close);
        const firstHalf = closes.slice(0, 10);
        const secondHalf = closes.slice(10);
        const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / 10;
        const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / 10;
        const midClose = closes[10];
        // First half trending down, mid lower, second half trending up
        const isRounding =
          firstAvg > midClose &&
          secondAvg > midClose &&
          firstAvg > firstHalf[0] * 0.98 && // slight slope
          secondHalf[9] > secondHalf[0];     // recovering
        if (isRounding) {
          // Volume U-shape check
          const vols = window.map((x) => x.volume ?? 0);
          const firstVolAvg = vols.slice(0, 10).reduce((s, v) => s + v, 0) / 10;
          const midVol = vols[10];
          const secondVolAvg = vols.slice(10).reduce((s, v) => s + v, 0) / 10;
          let confidence = 60;
          if (firstVolAvg > midVol && secondVolAvg > midVol) confidence += 20;
          results.push({
            name: '?耦摨?,
            nameEN: 'Rounding Bottom',
            type: 'bullish',
            candleIndex: i,
            candleCount: 20,
            confidence: clamp(confidence),
            historicalWinRate: 65,
            description: '20?遏璉耦?憫敶Ｗ??剁???敶ａ????瑞?摨閮?撘瑞???,
            technicalReading: '???澆?',
          });
        }
      }
    }
  }

  return results;
}

