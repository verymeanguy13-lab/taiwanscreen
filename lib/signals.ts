// =============================================================================
// lib/signals.ts — Signal matrix evaluation for 台股雷達
// =============================================================================

import type { Candle } from '@/types';
import type { InstitutionalFlow } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalItem {
  name: string;
  nameZH: string;
  fired: boolean;
  value: number;
  description: string;
}

export interface SignalMatrix {
  strengthSignals: SignalItem[];   // 9 items
  volumeSignals:   SignalItem[];   // 6 items
  strengthCount: number;
  volumeCount: number;
  matrixScore: number;             // (strengthCount/9*60) + (volumeCount/6*40)
  summary: string;                 // Chinese
}

// ---------------------------------------------------------------------------
// Indicator snapshot (mirrors breakouts.ts shape)
// ---------------------------------------------------------------------------

export interface IndicatorSnapshot {
  sma5:   (number | null)[];
  sma20:  (number | null)[];
  sma60:  (number | null)[];
  rsi14:  (number | null)[];
  macd:   { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] };
  kd:     { k: (number | null)[]; d: (number | null)[] };
  bb:     { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] };
  obv:    number[];
  volRatio: (number | null)[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function last<T>(arr: (T | null)[], offset = 0): T | null {
  const idx = arr.length - 1 - offset;
  return idx >= 0 ? arr[idx] : null;
}

function avgVol(candles: Candle[], period = 5, endOffset = 1): number {
  const end   = candles.length - endOffset;
  const start = Math.max(0, end - period);
  const slice = candles.slice(start, end);
  if (slice.length === 0) return 0;
  return slice.reduce((s, c) => s + (c.volume ?? 0), 0) / slice.length;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function evaluateSignalMatrix(
  candles: Candle[],
  indicators: IndicatorSnapshot,
  institutional?: InstitutionalFlow[],
): SignalMatrix {
  const n = candles.length;
  if (n < 5) {
    const empty = (name: string, nameZH: string): SignalItem => ({
      name, nameZH, fired: false, value: 0, description: '資料不足',
    });
    const strengthSignals = [
      empty('goldenCross',    '均線黃金交叉'),
      empty('aboveAllMAs',    '站上三均線'),
      empty('rsiRecovery',    'RSI回升'),
      empty('macdCross',      'MACD交叉'),
      empty('kdGoldenCross',  'KD黃金交叉'),
      empty('bollingerBreak', '突破布林上軌'),
      empty('new20High',      '創20日新高'),
      empty('maBounce',       '均線支撐反彈'),
      empty('instBuying',     '法人連續買進'),
    ];
    const volumeSignals = [
      empty('volSurge',     '量能暴增'),
      empty('breakoutVol',  '突破量'),
      empty('obvRising',    'OBV上升'),
      empty('highVolRatio', '量比偏高'),
      empty('volPriceSame', '價漲量增'),
      empty('lowVolConsolidate', '縮量整理'),
    ];
    return {
      strengthSignals, volumeSignals,
      strengthCount: 0, volumeCount: 0, matrixScore: 0,
      summary: '資料不足，無法評估',
    };
  }

  const today    = candles[n - 1];
  const closes   = candles.map((c) => c.close);
  const { sma5, sma20, sma60, rsi14, macd, kd, bb, obv, volRatio } = indicators;

  // -------------------------------------------------------------------------
  // STRENGTH SIGNALS (9)
  // -------------------------------------------------------------------------

  // 1. 均線黃金交叉 — 5MA crossed above 20MA in last 3 days
  let goldenCrossFired = false;
  let goldenCrossValue = 0;
  for (let i = 0; i < 3; i++) {
    const m5  = last(sma5, i)  as number | null;
    const m20 = last(sma20, i) as number | null;
    const m5p = last(sma5, i + 1)  as number | null;
    const m20p = last(sma20, i + 1) as number | null;
    if (m5 !== null && m20 !== null && m5p !== null && m20p !== null) {
      if (m5 > m20 && m5p <= m20p) { goldenCrossFired = true; goldenCrossValue = m5 - m20; break; }
    }
  }

  // 2. 站上三均線 — price above 5MA, 20MA, AND 60MA
  const m5Now  = last(sma5)  as number | null;
  const m20Now = last(sma20) as number | null;
  const m60Now = last(sma60) as number | null;
  const aboveAllFired = m5Now !== null && m20Now !== null && m60Now !== null &&
    today.close > m5Now && today.close > m20Now && today.close > m60Now;
  const aboveAllValue = aboveAllFired && m5Now
    ? parseFloat(((today.close / m5Now - 1) * 100).toFixed(2)) : 0;

  // 3. RSI回升 — RSI crossed above 50 from below in last 3 days
  let rsiRecovFired = false;
  let rsiRecovValue = 0;
  for (let i = 0; i < 3; i++) {
    const r  = last(rsi14, i) as number | null;
    const rp = last(rsi14, i + 1) as number | null;
    if (r !== null && rp !== null && r > 50 && rp <= 50) {
      rsiRecovFired = true; rsiRecovValue = parseFloat((r).toFixed(1)); break;
    }
  }

  // 4. MACD交叉 — MACD crossed above signal in last 3 days
  let macdCrossFired = false;
  let macdCrossValue = 0;
  for (let i = 0; i < 3; i++) {
    const ml  = last(macd.macdLine, i)   as number | null;
    const sl  = last(macd.signalLine, i) as number | null;
    const mlp = last(macd.macdLine, i + 1)   as number | null;
    const slp = last(macd.signalLine, i + 1) as number | null;
    if (ml !== null && sl !== null && mlp !== null && slp !== null) {
      if (ml > sl && mlp <= slp) { macdCrossFired = true; macdCrossValue = parseFloat((ml - sl).toFixed(4)); break; }
    }
  }

  // 5. KD黃金交叉 — K crossed above D from below 30
  let kdCrossFired = false;
  let kdCrossValue = 0;
  const kNow  = last(kd.k) as number | null;
  const dNow  = last(kd.d) as number | null;
  const kPrev = last(kd.k, 1) as number | null;
  const dPrev = last(kd.d, 1) as number | null;
  if (kNow !== null && dNow !== null && kPrev !== null && dPrev !== null) {
    if (kNow > dNow && kPrev <= dPrev && kPrev < 30) {
      kdCrossFired = true; kdCrossValue = parseFloat(kNow.toFixed(1));
    }
  }

  // 6. 突破布林上軌 — close above upper Bollinger Band
  const bbUpper = last(bb.upper) as number | null;
  const bbBreakFired = bbUpper !== null && today.close > bbUpper;
  const bbBreakValue = bbUpper ? parseFloat((today.close - bbUpper).toFixed(2)) : 0;

  // 7. 創20日新高 — close is highest in prior 20 days
  const prior20Closes = closes.slice(Math.max(0, n - 21), n - 1);
  const prior20High = prior20Closes.length > 0 ? Math.max(...prior20Closes) : today.close;
  const new20HighFired = today.close > prior20High;
  const new20HighValue = parseFloat((today.close - prior20High).toFixed(2));

  // 8. 均線支撐反彈 — price bounced off 20MA or 60MA (within 2%, now above)
  let maBouceFired = false;
  let maBounceValue = 0;
  const prevClose = n >= 2 ? candles[n - 2].close : today.close;
  if (m20Now !== null) {
    const nearMA20 = Math.abs(prevClose - m20Now) / m20Now < 0.02;
    if (nearMA20 && today.close > m20Now) { maBouceFired = true; maBounceValue = parseFloat(m20Now.toFixed(2)); }
  }
  if (!maBouceFired && m60Now !== null) {
    const nearMA60 = Math.abs(prevClose - m60Now) / m60Now < 0.02;
    if (nearMA60 && today.close > m60Now) { maBouceFired = true; maBounceValue = parseFloat(m60Now.toFixed(2)); }
  }

  // 9. 法人連續買進 — 外資 OR 投信 net positive 3+ consecutive days
  let instFired = false;
  let instValue = 0;
  if (institutional && institutional.length >= 3) {
    const recent = institutional.slice(-3);
    const foreignPos = recent.every((r) => (r.foreign_net ?? 0) > 0);
    const trustPos   = recent.every((r) => (r.trust_net ?? 0) > 0);
    if (foreignPos || trustPos) {
      instFired = true;
      instValue = recent.reduce((s, r) => s + (r.total_net ?? 0), 0);
    }
  }

  const strengthSignals: SignalItem[] = [
    { name: 'goldenCross',    nameZH: '均線黃金交叉', fired: goldenCrossFired, value: goldenCrossValue, description: '5日均線於近3日向上穿越20日均線' },
    { name: 'aboveAllMAs',    nameZH: '站上三均線',   fired: aboveAllFired,    value: aboveAllValue,    description: '收盤價同時站上5日、20日、60日均線' },
    { name: 'rsiRecovery',    nameZH: 'RSI回升',      fired: rsiRecovFired,    value: rsiRecovValue,    description: 'RSI於近3日由下向上穿越50' },
    { name: 'macdCross',      nameZH: 'MACD交叉',     fired: macdCrossFired,   value: macdCrossValue,   description: 'MACD線於近3日向上穿越訊號線' },
    { name: 'kdGoldenCross',  nameZH: 'KD黃金交叉',   fired: kdCrossFired,     value: kdCrossValue,     description: 'K值從30以下向上穿越D值' },
    { name: 'bollingerBreak', nameZH: '突破布林上軌', fired: bbBreakFired,     value: bbBreakValue,     description: '收盤價突破布林通道上軌' },
    { name: 'new20High',      nameZH: '創20日新高',   fired: new20HighFired,   value: new20HighValue,   description: '今日收盤創近20個交易日新高' },
    { name: 'maBounce',       nameZH: '均線支撐反彈', fired: maBouceFired,     value: maBounceValue,    description: '昨日股價貼近均線後今日收復均線上方' },
    { name: 'instBuying',     nameZH: '法人連續買進', fired: instFired,        value: instValue,        description: '外資或投信連續3日以上淨買超' },
  ];

  // -------------------------------------------------------------------------
  // VOLUME SIGNALS (6)
  // -------------------------------------------------------------------------

  const av5 = avgVol(candles, 5, 1);
  const todayVol = today.volume ?? 0;

  // 1. 量能暴增 — volume > 2x 5-day average
  const volSurgeFired = av5 > 0 && todayVol > 2 * av5;
  const volSurgeValue = av5 > 0 ? parseFloat((todayVol / av5).toFixed(2)) : 0;

  // 2. 突破量 — volume > 1.5x avg AND price new high
  const breakoutVolFired = av5 > 0 && todayVol > 1.5 * av5 && new20HighFired;
  const breakoutVolValue = volSurgeValue;

  // 3. OBV上升 — OBV[today] > OBV[5 days ago]
  const obvNow  = obv.length > 0 ? obv[obv.length - 1] : 0;
  const obv5ago = obv.length > 5 ? obv[obv.length - 6] : 0;
  const obvRisingFired = obvNow > obv5ago;
  const obvRisingValue = parseFloat((obvNow - obv5ago).toFixed(0));

  // 4. 量比偏高 — volumeRatio > 1.8
  const vrNow = last(volRatio) as number | null;
  const highVolRatioFired = vrNow !== null && vrNow > 1.8;
  const highVolRatioValue = vrNow ? parseFloat(vrNow.toFixed(2)) : 0;

  // 5. 價漲量增 — last 5 days: volume higher on up days than down days
  let upDayAvgVol  = 0, upDayCount  = 0;
  let downDayAvgVol = 0, downDayCount = 0;
  for (let i = Math.max(1, n - 5); i < n; i++) {
    const v = candles[i].volume ?? 0;
    if (candles[i].close > candles[i - 1].close) { upDayAvgVol += v; upDayCount++; }
    else if (candles[i].close < candles[i - 1].close) { downDayAvgVol += v; downDayCount++; }
  }
  if (upDayCount > 0) upDayAvgVol /= upDayCount;
  if (downDayCount > 0) downDayAvgVol /= downDayCount;
  const volPriceSameFired = upDayCount > 0 && (downDayCount === 0 || upDayAvgVol > downDayAvgVol);
  const volPriceSameValue = downDayAvgVol > 0
    ? parseFloat((upDayAvgVol / downDayAvgVol).toFixed(2)) : 0;

  // 6. 縮量整理 — last 3 days volume < half of prior 3 days avg
  const last3Vol  = candles.slice(Math.max(0, n - 3)).reduce((s, c) => s + (c.volume ?? 0), 0) / 3;
  const prior3Vol = candles.slice(Math.max(0, n - 6), Math.max(0, n - 3)).reduce((s, c) => s + (c.volume ?? 0), 0) / 3;
  const lowVolFired = prior3Vol > 0 && last3Vol < prior3Vol * 0.5;
  const lowVolValue = prior3Vol > 0 ? parseFloat((last3Vol / prior3Vol).toFixed(2)) : 0;

  const volumeSignals: SignalItem[] = [
    { name: 'volSurge',          nameZH: '量能暴增',   fired: volSurgeFired,      value: volSurgeValue,      description: '今日成交量超過5日均量2倍以上' },
    { name: 'breakoutVol',       nameZH: '突破量',     fired: breakoutVolFired,   value: breakoutVolValue,   description: '成交量放大1.5倍且同步創20日新高' },
    { name: 'obvRising',         nameZH: 'OBV上升',    fired: obvRisingFired,     value: obvRisingValue,     description: '今日OBV高於5日前，資金持續流入' },
    { name: 'highVolRatio',      nameZH: '量比偏高',   fired: highVolRatioFired,  value: highVolRatioValue,  description: '量比大於1.8，今日成交活躍' },
    { name: 'volPriceSame',      nameZH: '價漲量增',   fired: volPriceSameFired,  value: volPriceSameValue,  description: '近5日上漲日均量高於下跌日均量' },
    { name: 'lowVolConsolidate', nameZH: '縮量整理',   fired: lowVolFired,        value: lowVolValue,        description: '近3日量能縮至前3日均量一半以下，醞釀突破' },
  ];

  // -------------------------------------------------------------------------
  // Counts & score
  // -------------------------------------------------------------------------
  const strengthCount = strengthSignals.filter((s) => s.fired).length;
  const volumeCount   = volumeSignals.filter((s) => s.fired).length;
  const matrixScore   = Math.round((strengthCount / 9) * 60 + (volumeCount / 6) * 40);

  const summary = `9項強勢指標中符合 ${strengthCount} 項，6項量能指標中符合 ${volumeCount} 項，綜合評分 ${matrixScore} 分`;

  return {
    strengthSignals,
    volumeSignals,
    strengthCount,
    volumeCount,
    matrixScore,
    summary,
  };
}
