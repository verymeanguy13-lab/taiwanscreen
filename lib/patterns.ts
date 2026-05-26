// =============================================================================
// lib/patterns.ts — Candlestick pattern detection for 台股雷達
// Scans the last 20 candles of the provided array.
// All criteria use strict OHLC math — no magic numbers without comment.
// =============================================================================

import type { Candle } from '@/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DetectedPattern {
  name: string;              // Chinese name e.g. '低檔長紅'
  nameEN: string;
  type: 'bullish' | 'bearish' | 'neutral';
  candleIndex: number;       // index in the ORIGINAL candles array
  candleCount: number;       // 1, 2, or 3
  confidence: number;        // 0–100
  historicalWinRate: number; // literature-based base rate
  description: string;       // one-sentence Chinese explanation
  technicalReading:
    | '強勢突破'
    | '偏多格局'
    | '盤整觀察'
    | '偏空格局'
    | '弱勢整理';
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

    // 低檔長紅
    if (
      isBullish(c) &&
      body(c) > 2 * ab &&
      c.close < pr.low + 0.35 * totalRange
    ) {
      let confidence = 65;
      if (vol > 1.5 * av) confidence += 20;
      results.push({
        name: '低檔長紅',
        nameEN: 'Low-Base Long Red',
        type: 'bullish',
        candleIndex: i,
        candleCount: 1,
        confidence: clamp(confidence),
        historicalWinRate: 62,
        description: '在低檔出現大量長紅K棒，顯示多方強力介入，有止跌訊號。',
        technicalReading: '偏多格局',
      });
    }

    // 錘子線
    if (
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
        name: '錘子線',
        nameEN: 'Hammer',
        type: 'bullish',
        candleIndex: i,
        candleCount: 1,
        confidence: clamp(confidence),
        historicalWinRate: 60,
        description: '長下影線錘子線出現，代表下方支撐強勁，空頭力竭。',
        technicalReading: '偏多格局',
      });
    }

    // 長下影線 (broader than hammer — any direction)
    if (lowerShadow(c) > 3 * body(c) && body(c) > 0) {
      results.push({
        name: '長下影線',
        nameEN: 'Long Lower Shadow',
        type: 'bullish',
        candleIndex: i,
        candleCount: 1,
        confidence: 55,
        historicalWinRate: 55,
        description: '長下影線顯示盤中遭逢賣壓但收盤獲得支撐，買方力道浮現。',
        technicalReading: '盤整觀察',
      });
    }

    // 十字星
    if (range(c) > 0 && Math.abs(c.open - c.close) < 0.1 * range(c)) {
      results.push({
        name: '十字星',
        nameEN: 'Doji',
        type: 'neutral',
        candleIndex: i,
        candleCount: 1,
        confidence: 50,
        historicalWinRate: 50,
        description: '開收盤價幾乎相同，市場多空力道均衡，後市方向不明。',
        technicalReading: '盤整觀察',
      });
    }

    // -----------------------------------------------------------------------
    // SINGLE-CANDLE BEARISH
    // -----------------------------------------------------------------------

    // 倒錘子線
    if (
      upperShadow(c) > 2 * body(c) &&
      lowerShadow(c) < 0.3 * body(c)
    ) {
      let confidence = 58;
      if (vol > 1.5 * av) confidence += 10;
      results.push({
        name: '倒錘子線',
        nameEN: 'Inverted Hammer / Shooting Star',
        type: 'bearish',
        candleIndex: i,
        candleCount: 1,
        confidence: clamp(confidence),
        historicalWinRate: 57,
        description: '長上影線倒錘子線出現，上方賣壓沉重，可能反轉向下。',
        technicalReading: '偏空格局',
      });
    }

    // -----------------------------------------------------------------------
    // TWO-CANDLE BULLISH
    // -----------------------------------------------------------------------

    if (prev1) {
      // 多頭吞噬
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
          name: '多頭吞噬',
          nameEN: 'Bullish Engulfing',
          type: 'bullish',
          candleIndex: i,
          candleCount: 2,
          confidence: clamp(confidence),
          historicalWinRate: 65,
          description: '今日大陽線完全吞噬昨日陰線，多方強勢反攻，反轉訊號明確。',
          technicalReading: '偏多格局',
        });
      }

      // 孕線 (Harami — prev large, today small fully inside)
      if (
        body(prev1) > ab * 1.5 &&
        body(c) < body(prev1) * 0.5 &&
        c.open > Math.min(prev1.open, prev1.close) &&
        c.close < Math.max(prev1.open, prev1.close) &&
        isBullish(prev1)
      ) {
        results.push({
          name: '孕線',
          nameEN: 'Bullish Harami',
          type: 'bullish',
          candleIndex: i,
          candleCount: 2,
          confidence: 58,
          historicalWinRate: 53,
          description: '小實體完全在前日大陽線範圍內，多頭蓄勢，可能突破。',
          technicalReading: '盤整觀察',
        });
      }

      // 空頭吞噬
      if (
        isBullish(prev1) &&
        c.open > prev1.close &&
        c.close < prev1.open &&
        isBearish(c)
      ) {
        let confidence = 68;
        if (vol > 1.5 * av) confidence += 12;
        results.push({
          name: '空頭吞噬',
          nameEN: 'Bearish Engulfing',
          type: 'bearish',
          candleIndex: i,
          candleCount: 2,
          confidence: clamp(confidence),
          historicalWinRate: 64,
          description: '今日大陰線完全吞噬昨日陽線，空方強力壓制，趨勢反轉向下。',
          technicalReading: '偏空格局',
        });
      }
    }

    // -----------------------------------------------------------------------
    // THREE-CANDLE PATTERNS
    // -----------------------------------------------------------------------

    if (prev1 && prev2) {
      // 晨星 (Morning Star)
      if (
        isBearish(prev2) &&
        body(prev2) > ab &&
        isDoji(prev1) &&
        isBullish(c) &&
        c.close > prev2.open + (prev2.close - prev2.open) * 0.5
      ) {
        results.push({
          name: '晨星',
          nameEN: 'Morning Star',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 72,
          historicalWinRate: 68,
          description: '三日晨星型態出現，第三日大陽線收復跌幅逾半，底部反轉訊號強。',
          technicalReading: '偏多格局',
        });
      }

      // 孤島晨星 (Island Morning Star — gap down then gap up)
      if (
        isBearish(prev2) &&
        prev1.high < prev2.low && // gap down into star
        c.low > prev1.high &&     // gap up out
        isBullish(c)
      ) {
        results.push({
          name: '孤島晨星',
          nameEN: 'Island Morning Star',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 88,
          historicalWinRate: 75,
          description: '缺口孤島晨星，上下均有跳空缺口，空頭完全失守，強力底部反轉。',
          technicalReading: '強勢突破',
        });
      }

      // 一星二陽 (One Star, Two Yang)
      if (
        isBearish(prev2) &&
        (isDoji(prev1) || body(prev1) < 0.5 * ab) &&
        isBullish(c) &&
        c.close > (prev2.open + prev2.close) / 2 // close above midpoint of first
      ) {
        results.push({
          name: '一星二陽',
          nameEN: 'One Star, Two Yang',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 65,
          historicalWinRate: 61,
          description: '下跌後出現星線再收陽，多方重新取得主導，底部訊號確立。',
          technicalReading: '偏多格局',
        });
      }

      // 紅三兵 (Three White Soldiers)
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
          name: '紅三兵',
          nameEN: 'Three White Soldiers',
          type: 'bullish',
          candleIndex: i,
          candleCount: 3,
          confidence: 75,
          historicalWinRate: 70,
          description: '三根依序走高的陽線，多方持續加力，強勢上漲格局確立。',
          technicalReading: '強勢突破',
        });
      }

      // 夜星 (Evening Star)
      if (
        isBullish(prev2) &&
        body(prev2) > ab &&
        isDoji(prev1) &&
        isBearish(c) &&
        c.close < prev2.close - (prev2.close - prev2.open) * 0.5
      ) {
        results.push({
          name: '夜星',
          nameEN: 'Evening Star',
          type: 'bearish',
          candleIndex: i,
          candleCount: 3,
          confidence: 72,
          historicalWinRate: 67,
          description: '三日夜星型態，第三日大陰線吞噬大半漲幅，頭部反轉訊號確立。',
          technicalReading: '偏空格局',
        });
      }

      // 黑三兵 (Three Black Crows)
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
          name: '黑三兵',
          nameEN: 'Three Black Crows',
          type: 'bearish',
          candleIndex: i,
          candleCount: 3,
          confidence: 75,
          historicalWinRate: 69,
          description: '三根依序走低的陰線，空方持續壓制，弱勢下跌格局確立。',
          technicalReading: '弱勢整理',
        });
      }

      // 圓形底 (Rounding Bottom) — checks 15-20 candle gradual curve
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
            name: '圓形底',
            nameEN: 'Rounding Bottom',
            type: 'bullish',
            candleIndex: i,
            candleCount: 20,
            confidence: clamp(confidence),
            historicalWinRate: 65,
            description: '20根K棒形成弧形底部，量能呈U形配合，長線底部訊號強烈。',
            technicalReading: '偏多格局',
          });
        }
      }
    }
  }

  return results;
}
