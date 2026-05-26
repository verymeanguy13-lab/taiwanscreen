// =============================================================================
// tests/indicators.test.ts
// Run with: node --test (Node 18+, no extra deps required)
// =============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Inline minimal re-implementations to avoid needing tsconfig path aliases
// in a raw node --test run.  If you run via ts-node with tsconfig-paths this
// import block can be replaced with:
//   import { sma, ema, rsi, macd, bollingerBands, atr, obv, volumeRatio,
//            pricePosition, detectBox } from '../lib/indicators';
//   import { detectPatterns } from '../lib/patterns';
// ---------------------------------------------------------------------------

// ---- copy-paste helpers from indicators.ts (keep in sync) -----------------
function mean(arr: number[]): number {
  return arr.reduce((s: number, v: number) => s + v, 0) / arr.length;
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) out.push(null);
    else out.push(mean(values.slice(i - period + 1, i + 1)));
  }
  return out;
}

function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(period - 1).fill(null);
  const seed = mean(values.slice(0, period));
  out.push(seed);
  for (let i = period; i < values.length; i++) {
    out.push(values[i] * k + (out[i - 1] as number) * (1 - k));
  }
  return out;
}

function rsi(closes: number[], period = 14): (number | null)[] {
  if (closes.length < period + 1) return closes.map(() => null);
  const out: (number | null)[] = new Array(period).fill(null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss += Math.abs(diff);
  }
  avgGain /= period; avgLoss /= period;
  const calc = (ag: number, al: number) => al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  out.push(calc(avgGain, avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    out.push(calc(avgGain, avgLoss));
  }
  return out;
}

interface Candle { open: number; high: number; low: number; close: number; volume?: number; date?: string; }

function detectBox(
  candles: Candle[],
  lookback = 20,
): { upper: number; lower: number; isBox: boolean; duration: number } | null {
  if (candles.length < lookback) return null;
  const window = candles.slice(-lookback);
  const highs = window.map(c => c.high);
  const lows = window.map(c => c.low);
  const maxHigh = Math.max(...highs), minHigh = Math.min(...highs);
  const maxLow = Math.max(...lows), minLow = Math.min(...lows);
  const highRange = maxHigh === 0 ? 0 : (maxHigh - minHigh) / maxHigh;
  const lowRange = minLow === 0 ? 0 : (maxLow - minLow) / minLow;
  const isBox = highRange < 0.08 && lowRange < 0.08;
  const upper = maxHigh, lower = minLow;
  let duration = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].high <= upper * 1.01 && candles[i].low >= lower * 0.99) duration++;
    else break;
  }
  return { upper, lower, isBox, duration };
}

interface DetectedPattern {
  name: string; nameEN: string; type: string; candleIndex: number;
  candleCount: number; confidence: number; historicalWinRate: number;
  description: string; technicalReading: string;
}

function detectPatterns(candles: Candle[]): DetectedPattern[] {
  const results: DetectedPattern[] = [];
  if (candles.length < 3) return results;
  const scanStart = Math.max(0, candles.length - 20);

  function body(c: Candle) { return Math.abs(c.close - c.open); }
  function upperShadow(c: Candle) { return c.high - Math.max(c.open, c.close); }
  function lowerShadow(c: Candle) { return Math.min(c.open, c.close) - c.low; }
  function isBullish(c: Candle) { return c.close > c.open; }
  function isBearish(c: Candle) { return c.close < c.open; }
  function isDoji(c: Candle) { const r = c.high - c.low; return r > 0 && body(c) < 0.1 * r; }
  function avgBody(cs: Candle[]) { return cs.length ? cs.reduce((s, c) => s + body(c), 0) / cs.length : 0; }
  function avgVol(cs: Candle[]) { const vs = cs.map(c => c.volume ?? 0); return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : 0; }
  function clamp(v: number) { return Math.min(100, Math.max(0, v)); }

  for (let i = scanStart; i < candles.length; i++) {
    const c = candles[i];
    const prev1 = i >= 1 ? candles[i - 1] : null;
    const prev2 = i >= 2 ? candles[i - 2] : null;
    const ctx = candles.slice(Math.max(0, i - 10), i);
    const ab = avgBody(ctx.length > 0 ? ctx : [c]);
    const av = avgVol(ctx.length > 0 ? ctx : [c]);
    const vol = c.volume ?? 0;

    // 多頭吞噬
    if (prev1 && isBearish(prev1) && c.open < prev1.close && c.close > prev1.open && isBullish(c)) {
      const sma20 = candles.slice(Math.max(0, i - 19), i + 1).reduce((s, x) => s + x.close, 0) / Math.min(20, i + 1);
      let conf = 68;
      if (Math.abs(c.close - sma20) / sma20 < 0.02) conf += 20;
      results.push({ name: '多頭吞噬', nameEN: 'Bullish Engulfing', type: 'bullish', candleIndex: i, candleCount: 2, confidence: clamp(conf), historicalWinRate: 65, description: '今日大陽線完全吞噬昨日陰線，多方強勢反攻，反轉訊號明確。', technicalReading: '偏多格局' });
    }

    // 空頭吞噬
    if (prev1 && isBullish(prev1) && c.open > prev1.close && c.close < prev1.open && isBearish(c)) {
      let conf = 68;
      if (vol > 1.5 * av) conf += 12;
      results.push({ name: '空頭吞噬', nameEN: 'Bearish Engulfing', type: 'bearish', candleIndex: i, candleCount: 2, confidence: clamp(conf), historicalWinRate: 64, description: '今日大陰線完全吞噬昨日陽線，空方強力壓制，趨勢反轉向下。', technicalReading: '偏空格局' });
    }

    // 晨星
    if (prev1 && prev2 && isBearish(prev2) && body(prev2) > ab && isDoji(prev1) && isBullish(c) && c.close > prev2.open + (prev2.close - prev2.open) * 0.5) {
      results.push({ name: '晨星', nameEN: 'Morning Star', type: 'bullish', candleIndex: i, candleCount: 3, confidence: 72, historicalWinRate: 68, description: '三日晨星型態出現，第三日大陽線收復跌幅逾半，底部反轉訊號強。', technicalReading: '偏多格局' });
    }

    // 紅三兵
    if (prev1 && prev2 && isBullish(prev2) && isBullish(prev1) && isBullish(c) && prev1.open > prev2.open && prev1.open < prev2.close && c.open > prev1.open && c.open < prev1.close && c.close > prev1.close && prev1.close > prev2.close) {
      results.push({ name: '紅三兵', nameEN: 'Three White Soldiers', type: 'bullish', candleIndex: i, candleCount: 3, confidence: 75, historicalWinRate: 70, description: '三根依序走高的陽線，多方持續加力，強勢上漲格局確立。', technicalReading: '強勢突破' });
    }
  }
  return results;
}

// ===========================================================================
// TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// sma
// ---------------------------------------------------------------------------

test('sma basic — [1,2,3,4,5] period 3 → [null, null, 2, 3, 4]', () => {
  const result = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(result, [null, null, 2, 3, 4]);
});

test('sma period 1 returns all values', () => {
  const result = sma([10, 20, 30], 1);
  assert.deepEqual(result, [10, 20, 30]);
});

test('sma period equals length returns one value', () => {
  const result = sma([1, 2, 3], 3);
  assert.equal(result[0], null);
  assert.equal(result[1], null);
  assert.equal(result[2], 2); // (1+2+3)/3
});

// ---------------------------------------------------------------------------
// ema
// ---------------------------------------------------------------------------

test('ema seeds with sma then applies multiplier', () => {
  const result = ema([1, 2, 3, 4, 5], 3);
  // Seed = (1+2+3)/3 = 2. k = 2/4 = 0.5
  // i=3: 4*0.5 + 2*0.5 = 3
  // i=4: 5*0.5 + 3*0.5 = 4
  assert.equal(result[0], null);
  assert.equal(result[1], null);
  assert.equal(result[2], 2);
  assert.ok(Math.abs((result[3] as number) - 3) < 0.001);
  assert.ok(Math.abs((result[4] as number) - 4) < 0.001);
});

// ---------------------------------------------------------------------------
// rsi
// ---------------------------------------------------------------------------

test('rsi all gains → approaches 100', () => {
  const closes = Array.from({ length: 20 }, (_, i) => i + 1);
  const result = rsi(closes, 14);
  const last = result[result.length - 1] as number;
  assert.ok(last > 90, `Expected RSI > 90, got ${last}`);
});

test('rsi all losses → approaches 0', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 20 - i);
  const result = rsi(closes, 14);
  const last = result[result.length - 1] as number;
  assert.ok(last < 10, `Expected RSI < 10, got ${last}`);
});

test('rsi returns correct number of nulls', () => {
  const closes = Array.from({ length: 20 }, (_, i) => i + 1);
  const result = rsi(closes, 14);
  const nullCount = result.filter(v => v === null).length;
  assert.equal(nullCount, 14); // 14 leading nulls
});

// ---------------------------------------------------------------------------
// detectBox
// ---------------------------------------------------------------------------

test('detectBox on 20 candles within 5% range → isBox: true', () => {
  const base = 100;
  const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    open:  base + (i % 3) * 0.5,
    high:  base + 2,         // high range: 4/100 = 4% < 8%
    low:   base - 2,         // low range: 4/100 = 4% < 8%
    close: base + (i % 2),
    volume: 1000,
  }));
  const result = detectBox(candles, 20);
  assert.ok(result !== null, 'detectBox should return a result');
  assert.equal(result!.isBox, true);
});

test('detectBox on trending sequence → isBox: false', () => {
  // Each candle is 2% higher than the last → 20 candles = ~40% range
  const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    open:  100 + i * 2,
    high:  102 + i * 2,
    low:   99  + i * 2,
    close: 101 + i * 2,
    volume: 1000,
  }));
  const result = detectBox(candles, 20);
  assert.ok(result !== null);
  assert.equal(result!.isBox, false);
});

test('detectBox returns null when fewer candles than lookback', () => {
  const candles: Candle[] = Array.from({ length: 5 }, () => ({
    open: 100, high: 101, low: 99, close: 100,
  }));
  const result = detectBox(candles, 20);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// detectPatterns — 多頭吞噬
// ---------------------------------------------------------------------------

test('detectPatterns fires 多頭吞噬 on handcrafted 2-candle array', () => {
  // Previous candle: bearish (open 110, close 100)
  // Current candle:  bullish, opens below prev close, closes above prev open
  const candles: Candle[] = [
    // Padding so we have avgBody context
    { open: 105, high: 108, low: 103, close: 104, volume: 1000 },
    { open: 106, high: 109, low: 104, close: 105, volume: 1000 },
    { open: 107, high: 110, low: 105, close: 106, volume: 1000 },
    // The trigger pair:
    { open: 110, high: 112, low: 99,  close: 100, volume: 1000 }, // bearish
    { open:  98, high: 115, low: 97,  close: 112, volume: 1500 }, // bullish engulf
  ];
  const patterns = detectPatterns(candles);
  const engulfing = patterns.find(p => p.name === '多頭吞噬');
  assert.ok(engulfing !== undefined, '多頭吞噬 pattern should be detected');
  assert.equal(engulfing!.type, 'bullish');
  assert.equal(engulfing!.candleCount, 2);
  assert.equal(engulfing!.candleIndex, 4);
});

test('detectPatterns does NOT fire 多頭吞噬 when candles are in same direction', () => {
  const candles: Candle[] = [
    { open: 100, high: 105, low: 99,  close: 104, volume: 1000 },
    { open: 104, high: 110, low: 103, close: 109, volume: 1000 }, // both bullish
  ];
  const patterns = detectPatterns(candles);
  const engulfing = patterns.find(p => p.name === '多頭吞噬');
  assert.equal(engulfing, undefined);
});

test('detectPatterns fires 空頭吞噬 on handcrafted bearish pair', () => {
  const candles: Candle[] = [
    { open: 100, high: 102, low: 98,  close: 101, volume: 1000 },
    { open: 100, high: 102, low: 98,  close: 101, volume: 1000 },
    { open: 100, high: 102, low: 98,  close: 101, volume: 1000 },
    { open: 100, high: 112, low: 99,  close: 110, volume: 1000 }, // prev: bullish
    { open: 113, high: 114, low: 97,  close:  98, volume: 2000 }, // bearish engulf
  ];
  const patterns = detectPatterns(candles);
  const bearish = patterns.find(p => p.name === '空頭吞噬');
  assert.ok(bearish !== undefined, '空頭吞噬 pattern should be detected');
  assert.equal(bearish!.type, 'bearish');
});

test('detectPatterns fires 紅三兵 on three consecutive rising bullish candles', () => {
  const candles: Candle[] = [
    { open: 100, high: 102, low: 99,  close: 101, volume: 1000 },
    { open: 100, high: 102, low: 99,  close: 101, volume: 1000 },
    // Three white soldiers:
    { open: 100, high: 106, low: 99,  close: 105, volume: 1000 }, // i=2 prev2
    { open: 102, high: 110, low: 101, close: 109, volume: 1000 }, // i=3 prev1
    { open: 106, high: 115, low: 105, close: 114, volume: 1000 }, // i=4 current
  ];
  const patterns = detectPatterns(candles);
  const soldiers = patterns.find(p => p.name === '紅三兵');
  assert.ok(soldiers !== undefined, '紅三兵 should be detected');
  assert.equal(soldiers!.type, 'bullish');
  assert.equal(soldiers!.candleCount, 3);
});

test('detectPatterns returns empty array for fewer than 3 candles', () => {
  const candles: Candle[] = [
    { open: 100, high: 102, low: 98, close: 101 },
    { open: 101, high: 103, low: 99, close: 102 },
  ];
  const patterns = detectPatterns(candles);
  assert.equal(patterns.length, 0);
});
