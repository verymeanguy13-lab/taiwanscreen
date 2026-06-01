// =============================================================================
// lib/alertEvaluator.ts — Pure alert condition evaluation engine
// No DB calls, no API calls. Takes pre-fetched data, returns triggered status.
// =============================================================================

import type { Candle, InstitutionalFlow } from '@/types';
import type { RealtimeQuote } from '@/lib/fugle';
import type { BreakoutSignal } from '@/lib/breakouts';
import type { IntradaySignalEvent } from '@/lib/bullbearSignals';

// ── Condition Types ───────────────────────────────────────────────────────────

export type AlertConditionType =
  // Price (8)
  | 'price_above'
  | 'price_below'
  | 'price_cross_up'
  | 'price_cross_down'
  | 'hit_limit_up'
  | 'hit_limit_down'
  | 'new_high_nd'
  | 'new_low_nd'
  // Volume (6)
  | 'single_lot_above'
  | 'total_vol_above'
  | 'vol_ratio_above'
  | 'vol_spike'
  | 'vol_unusual'
  | 'vol_shrink'
  // Change % (4)
  | 'change_up_pct'
  | 'change_down_pct'
  | 'reversal_from_high'
  | 'reversal_from_low'
  // Technical (12)
  | 'rsi_above'
  | 'rsi_below'
  | 'macd_golden_cross'
  | 'macd_death_cross'
  | 'kdj_golden_cross'
  | 'kdj_death_cross'
  | 'bollinger_upper'
  | 'bollinger_lower'
  | 'cross_above_ma5'
  | 'cross_above_ma20'
  | 'cross_below_ma20'
  | 'cross_below_ma60'
  // Events (4)
  | 'ex_dividend_soon'
  | 'earnings_soon'
  | 'institutional_buy'
  | 'institutional_sell'
  // Combined (2)
  | 'qichang_signal'
  | 'bullbear_signal';

export const ALL_CONDITION_TYPES: AlertConditionType[] = [
  'price_above', 'price_below', 'price_cross_up', 'price_cross_down',
  'hit_limit_up', 'hit_limit_down', 'new_high_nd', 'new_low_nd',
  'single_lot_above', 'total_vol_above', 'vol_ratio_above',
  'vol_spike', 'vol_unusual', 'vol_shrink',
  'change_up_pct', 'change_down_pct', 'reversal_from_high', 'reversal_from_low',
  'rsi_above', 'rsi_below', 'macd_golden_cross', 'macd_death_cross',
  'kdj_golden_cross', 'kdj_death_cross', 'bollinger_upper', 'bollinger_lower',
  'cross_above_ma5', 'cross_above_ma20', 'cross_below_ma20', 'cross_below_ma60',
  'ex_dividend_soon', 'earnings_soon', 'institutional_buy', 'institutional_sell',
  'qichang_signal', 'bullbear_signal',
];

// Condition types that do NOT need a numeric threshold
export const NO_THRESHOLD_TYPES: AlertConditionType[] = [
  'hit_limit_up', 'hit_limit_down',
  'vol_spike', 'vol_unusual', 'vol_shrink',
  'macd_golden_cross', 'macd_death_cross',
  'kdj_golden_cross', 'kdj_death_cross',
  'bollinger_upper', 'bollinger_lower',
  'cross_above_ma5', 'cross_above_ma20',
  'cross_below_ma20', 'cross_below_ma60',
  'qichang_signal', 'bullbear_signal',
];

// ── Core Types ────────────────────────────────────────────────────────────────

export interface AlertCondition {
  type:       AlertConditionType;
  threshold?: number;   // numeric threshold
  ndParam?:   number;   // N-day period for new_high_nd / new_low_nd
}

export interface AlertRule {
  id:         string;
  stockId:    string;
  conditions: AlertCondition[];  // 1–3
  logic:      'AND' | 'OR';
  enabled:    boolean;
  triggered:  boolean;
  createdAt:  string;
}

export interface IndicatorSet {
  sma5:    (number | null)[];
  sma20:   (number | null)[];
  sma60:   (number | null)[];
  rsi14:   (number | null)[];
  macd:    { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] };
  kdj:     { k: (number | null)[]; d: (number | null)[]; j: (number | null)[] };
  bb:      { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] };
  volRatio: (number | null)[];
}

export interface EvaluationContext {
  quote:                  RealtimeQuote;
  candles:                Candle[];
  indicators:             IndicatorSet;
  institutional?:         InstitutionalFlow[];
  dividendDates?:         { exDate: string }[];
  estimatedEarningsDate?: string;
  breakouts?:             BreakoutSignal[];
  intradaySignals?:       IntradaySignalEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lastN<T>(arr: (T | null)[], offset = 0): T | null {
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

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  const now    = Date.now();
  return Math.ceil((target - now) / 86_400_000);
}

// ── evaluateCondition ─────────────────────────────────────────────────────────

export function evaluateCondition(
  condition: AlertCondition,
  ctx: EvaluationContext,
): boolean {
  const { type, threshold = 0, ndParam = 20 } = condition;
  const { quote, candles, indicators, institutional, dividendDates,
          estimatedEarningsDate, breakouts, intradaySignals } = ctx;

  const n       = candles.length;
  const today   = candles[n - 1];
  const prev    = candles[n - 2];
  const price   = quote.z ?? today?.close ?? 0;
  const prevClose = Number(quote.y ?? prev?.close ?? 0);

  // ── PRICE ──────────────────────────────────────────────────────────────────

  if (type === 'price_above')
    return price > threshold;

  if (type === 'price_below')
    return price < threshold;

  if (type === 'price_cross_up') {
    // price crossed above threshold: was below yesterday, above today
    const prevPrice = prev?.close ?? 0;
    return prevPrice <= threshold && price > threshold;
  }

  if (type === 'price_cross_down') {
    const prevPrice = prev?.close ?? 0;
    return prevPrice >= threshold && price < threshold;
  }

  if (type === 'hit_limit_up')
    return price >= prevClose * 1.099; // small buffer for rounding

  if (type === 'hit_limit_down')
    return price <= prevClose * 0.901;

  if (type === 'new_high_nd') {
    if (n < ndParam + 1) return false;
    const periodHighs = candles.slice(Math.max(0, n - ndParam - 1), n - 1).map(c => c.high);
    return price > Math.max(...periodHighs);
  }

  if (type === 'new_low_nd') {
    if (n < ndParam + 1) return false;
    const periodLows = candles.slice(Math.max(0, n - ndParam - 1), n - 1).map(c => c.low);
    return price < Math.min(...periodLows);
  }

  // ── VOLUME ─────────────────────────────────────────────────────────────────

  if (type === 'single_lot_above')
    return (quote.tv ?? 0) > threshold;

  if (type === 'total_vol_above')
    return (quote.v ?? today?.volume ?? 0) > threshold;

  if (type === 'vol_ratio_above') {
    const vr = lastN(indicators.volRatio);
    return vr !== null && vr > threshold;
  }

  if (type === 'vol_spike') {
    const av = avgVol(candles, 5, 1);
    return av > 0 && (today?.volume ?? 0) > 2 * av;
  }

  if (type === 'vol_unusual') {
    const av = avgVol(candles, 5, 1);
    return av > 0 && (today?.volume ?? 0) > 3 * av;
  }

  if (type === 'vol_shrink') {
    const av = avgVol(candles, 5, 1);
    return av > 0 && (today?.volume ?? 0) < 0.5 * av;
  }

  // ── CHANGE % ───────────────────────────────────────────────────────────────

  if (type === 'change_up_pct') {
    const pct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
    return pct > threshold;
  }

  if (type === 'change_down_pct') {
    const pct = prevClose > 0 ? ((prevClose - price) / prevClose) * 100 : 0;
    return pct > threshold;
  }

  if (type === 'reversal_from_high') {
    const dayHigh = quote.h ?? price;
    if (dayHigh <= 0) return false;
    return ((dayHigh - price) / dayHigh) * 100 > threshold;
  }

  if (type === 'reversal_from_low') {
    const dayLow = quote.l ?? price;
    if (dayLow <= 0) return false;
    return ((price - dayLow) / dayLow) * 100 > threshold;
  }

  // ── TECHNICAL ──────────────────────────────────────────────────────────────

  if (type === 'rsi_above') {
    const rsi = lastN(indicators.rsi14);
    return rsi !== null && rsi > threshold;
  }

  if (type === 'rsi_below') {
    const rsi = lastN(indicators.rsi14);
    return rsi !== null && rsi < threshold;
  }

  if (type === 'macd_golden_cross') {
    // MACD line crossed above signal: was below yesterday, above today
    const macdNow  = lastN(indicators.macd.macdLine);
    const sigNow   = lastN(indicators.macd.signalLine);
    const macdPrev = lastN(indicators.macd.macdLine, 1);
    const sigPrev  = lastN(indicators.macd.signalLine, 1);
    if (macdNow === null || sigNow === null || macdPrev === null || sigPrev === null) return false;
    return macdPrev <= sigPrev && macdNow > sigNow;
  }

  if (type === 'macd_death_cross') {
    const macdNow  = lastN(indicators.macd.macdLine);
    const sigNow   = lastN(indicators.macd.signalLine);
    const macdPrev = lastN(indicators.macd.macdLine, 1);
    const sigPrev  = lastN(indicators.macd.signalLine, 1);
    if (macdNow === null || sigNow === null || macdPrev === null || sigPrev === null) return false;
    return macdPrev >= sigPrev && macdNow < sigNow;
  }

  if (type === 'kdj_golden_cross') {
    const kNow  = lastN(indicators.kdj.k);
    const dNow  = lastN(indicators.kdj.d);
    const kPrev = lastN(indicators.kdj.k, 1);
    const dPrev = lastN(indicators.kdj.d, 1);
    if (kNow === null || dNow === null || kPrev === null || dPrev === null) return false;
    // K crosses above D from below 20
    return kPrev <= dPrev && kNow > dNow && kPrev < 20;
  }

  if (type === 'kdj_death_cross') {
    const kNow  = lastN(indicators.kdj.k);
    const dNow  = lastN(indicators.kdj.d);
    const kPrev = lastN(indicators.kdj.k, 1);
    const dPrev = lastN(indicators.kdj.d, 1);
    if (kNow === null || dNow === null || kPrev === null || dPrev === null) return false;
    // K crosses below D from above 80
    return kPrev >= dPrev && kNow < dNow && kPrev > 80;
  }

  if (type === 'bollinger_upper') {
    const upper = lastN(indicators.bb.upper);
    return upper !== null && price > upper;
  }

  if (type === 'bollinger_lower') {
    const lower = lastN(indicators.bb.lower);
    return lower !== null && price < lower;
  }

  if (type === 'cross_above_ma5') {
    const ma5Now  = lastN(indicators.sma5);
    const ma5Prev = lastN(indicators.sma5, 1);
    if (ma5Now === null || ma5Prev === null) return false;
    return (prev?.close ?? 0) <= ma5Prev && price > ma5Now;
  }

  if (type === 'cross_above_ma20') {
    const ma20Now  = lastN(indicators.sma20);
    const ma20Prev = lastN(indicators.sma20, 1);
    if (ma20Now === null || ma20Prev === null) return false;
    return (prev?.close ?? 0) <= ma20Prev && price > ma20Now;
  }

  if (type === 'cross_below_ma20') {
    const ma20Now  = lastN(indicators.sma20);
    const ma20Prev = lastN(indicators.sma20, 1);
    if (ma20Now === null || ma20Prev === null) return false;
    return (prev?.close ?? 0) >= ma20Prev && price < ma20Now;
  }

  if (type === 'cross_below_ma60') {
    const ma60Now  = lastN(indicators.sma60);
    const ma60Prev = lastN(indicators.sma60, 1);
    if (ma60Now === null || ma60Prev === null) return false;
    return (prev?.close ?? 0) >= ma60Prev && price < ma60Now;
  }

  // ── EVENTS ─────────────────────────────────────────────────────────────────

  if (type === 'ex_dividend_soon') {
    if (!dividendDates || dividendDates.length === 0) return false;
    return dividendDates.some(d => {
      const days = daysUntil(d.exDate);
      return days >= 0 && days <= threshold;
    });
  }

  if (type === 'earnings_soon') {
    if (!estimatedEarningsDate) return false;
    const days = daysUntil(estimatedEarningsDate);
    return days >= 0 && days <= threshold;
  }

  if (type === 'institutional_buy') {
    if (!institutional || institutional.length === 0) return false;
    const latest = institutional[institutional.length - 1];
    const net = (latest.foreign_net ?? 0) + (latest.trust_net ?? 0);
    return net > threshold;
  }

  if (type === 'institutional_sell') {
    if (!institutional || institutional.length === 0) return false;
    const latest = institutional[institutional.length - 1];
    const net = (latest.foreign_net ?? 0) + (latest.trust_net ?? 0);
    return net < -threshold;
  }

  // ── COMBINED ───────────────────────────────────────────────────────────────

  if (type === 'qichang_signal')
    return !!(breakouts && breakouts.length > 0);

  if (type === 'bullbear_signal')
    return !!(intradaySignals && intradaySignals.length > 0);

  return false;
}

// ── evaluateRule ──────────────────────────────────────────────────────────────

export function evaluateRule(
  rule: AlertRule,
  ctx: EvaluationContext,
): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;

  const results = rule.conditions.map(c => evaluateCondition(c, ctx));

  if (rule.logic === 'AND') return results.every(Boolean);
  return results.some(Boolean);
}

// ── buildAlertMessage ─────────────────────────────────────────────────────────

export function buildAlertMessage(
  rule: AlertRule,
  ctx: EvaluationContext,
): string {
  const { quote, candles, indicators, institutional, dividendDates, breakouts } = ctx;
  const n     = candles.length;
  const price = quote.z ?? candles[n - 1]?.close ?? 0;
  const id    = rule.stockId;

  const parts: string[] = [];

  for (const cond of rule.conditions) {
    const { type, threshold = 0, ndParam = 20 } = cond;

    switch (type) {
      case 'price_above':
      case 'price_cross_up':
        parts.push(`[${id}] 股價 ${price} 突破設定價位 ${threshold} 元`);
        break;
      case 'price_below':
      case 'price_cross_down':
        parts.push(`[${id}] 股價 ${price} 跌破設定價位 ${threshold} 元`);
        break;
      case 'hit_limit_up':
        parts.push(`[${id}] 觸及漲停板，強勢鎖板`);
        break;
      case 'hit_limit_down':
        parts.push(`[${id}] 觸及跌停板，弱勢跌停`);
        break;
      case 'new_high_nd':
        parts.push(`[${id}] 創 ${ndParam} 日新高，現價 ${price}`);
        break;
      case 'new_low_nd':
        parts.push(`[${id}] 創 ${ndParam} 日新低，現價 ${price}`);
        break;
      case 'vol_spike':
        parts.push(`[${id}] 成交量爆增超過均量 2 倍`);
        break;
      case 'vol_unusual':
        parts.push(`[${id}] 異常量能，超過均量 3 倍`);
        break;
      case 'vol_shrink':
        parts.push(`[${id}] 縮量整理，低於均量 0.5 倍`);
        break;
      case 'vol_ratio_above': {
        const vr = (ctx.indicators.volRatio[n - 1] ?? 0).toFixed(1);
        parts.push(`[${id}] 量比 ${vr} 倍，超過設定 ${threshold} 倍`);
        break;
      }
      case 'change_up_pct':
        parts.push(`[${id}] 今日漲幅超過 ${threshold}%，現漲 ${(quote.p ?? 0).toFixed(2)}%`);
        break;
      case 'change_down_pct':
        parts.push(`[${id}] 今日跌幅超過 ${threshold}%，現跌 ${Math.abs(quote.p ?? 0).toFixed(2)}%`);
        break;
      case 'reversal_from_high':
        parts.push(`[${id}] 從今日高點 ${quote.h ?? '—'} 回落超過 ${threshold}%`);
        break;
      case 'reversal_from_low':
        parts.push(`[${id}] 從今日低點 ${quote.l ?? '—'} 反彈超過 ${threshold}%`);
        break;
      case 'rsi_above': {
        const rsi = (lastN(indicators.rsi14) ?? 0).toFixed(1);
        parts.push(`[${id}] RSI(${rsi}) 超過 ${threshold}，技術面偏強`);
        break;
      }
      case 'rsi_below': {
        const rsi = (lastN(indicators.rsi14) ?? 0).toFixed(1);
        parts.push(`[${id}] RSI(${rsi}) 低於 ${threshold}，技術面偏弱`);
        break;
      }
      case 'macd_golden_cross':
        parts.push(`[${id}] MACD 黃金交叉，動能轉強`);
        break;
      case 'macd_death_cross':
        parts.push(`[${id}] MACD 死亡交叉，動能轉弱`);
        break;
      case 'kdj_golden_cross':
        parts.push(`[${id}] KDJ 黃金交叉（K 穿越 D，從低位）`);
        break;
      case 'kdj_death_cross':
        parts.push(`[${id}] KDJ 死亡交叉（K 穿越 D，從高位）`);
        break;
      case 'bollinger_upper': {
        const upper = (lastN(indicators.bb.upper) ?? 0).toFixed(2);
        parts.push(`[${id}] 股價 ${price} 突破布林通道上軌 ${upper}`);
        break;
      }
      case 'bollinger_lower': {
        const lower = (lastN(indicators.bb.lower) ?? 0).toFixed(2);
        parts.push(`[${id}] 股價 ${price} 跌破布林通道下軌 ${lower}`);
        break;
      }
      case 'cross_above_ma5':
        parts.push(`[${id}] 向上穿越 5 日均線，短線偏多`);
        break;
      case 'cross_above_ma20':
        parts.push(`[${id}] 向上穿越 20 日均線，趨勢轉多`);
        break;
      case 'cross_below_ma20':
        parts.push(`[${id}] 向下跌破 20 日均線，趨勢轉空`);
        break;
      case 'cross_below_ma60':
        parts.push(`[${id}] 向下跌破 60 日均線，長線走弱`);
        break;
      case 'ex_dividend_soon': {
        const nearest = dividendDates?.[0];
        if (nearest) {
          const days = daysUntil(nearest.exDate);
          parts.push(`[${id}] 距除息日僅剩 ${days} 天，除息日：${nearest.exDate}`);
        }
        break;
      }
      case 'earnings_soon': {
        if (ctx.estimatedEarningsDate) {
          const days = daysUntil(ctx.estimatedEarningsDate);
          parts.push(`[${id}] 距財報公布僅剩 ${days} 天`);
        }
        break;
      }
      case 'institutional_buy': {
        const latest  = institutional?.[institutional.length - 1];
        const net     = ((latest?.foreign_net ?? 0) + (latest?.trust_net ?? 0)).toLocaleString();
        parts.push(`[${id}] 外資/投信今日買超 ${net} 張`);
        break;
      }
      case 'institutional_sell': {
        const latest  = institutional?.[institutional.length - 1];
        const net     = Math.abs((latest?.foreign_net ?? 0) + (latest?.trust_net ?? 0)).toLocaleString();
        parts.push(`[${id}] 外資/投信今日賣超 ${net} 張`);
        break;
      }
      case 'qichang_signal': {
        const btype = breakouts?.[0]?.type ?? '突破型態';
        parts.push(`[${id}] 出現起漲突破型態：${btype}`);
        break;
      }
      case 'bullbear_signal':
        parts.push(`[${id}] 出現盤中多空訊號`);
        break;
      default:
        parts.push(`[${id}] 警示條件觸發`);
    }
  }

  const connector = rule.logic === 'AND' ? ' 且 ' : ' 或 ';
  return parts.join(connector);
}

// ── Rule preview (plain-language Chinese summary for UI) ──────────────────────

export const CONDITION_LABELS: Record<AlertConditionType, string> = {
  price_above:        '股價高於 {threshold} 元',
  price_below:        '股價低於 {threshold} 元',
  price_cross_up:     '向上突破 {threshold} 元',
  price_cross_down:   '向下跌破 {threshold} 元',
  hit_limit_up:       '當日漲停',
  hit_limit_down:     '當日跌停',
  new_high_nd:        '創 {ndParam} 日新高',
  new_low_nd:         '創 {ndParam} 日新低',
  single_lot_above:   '單量大於 {threshold} 張',
  total_vol_above:    '總量大於 {threshold} 張',
  vol_ratio_above:    '量比大於 {threshold} 倍',
  vol_spike:          '成交量爆增（2倍均量）',
  vol_unusual:        '異常量能（3倍均量）',
  vol_shrink:         '縮量整理（低於均量0.5倍）',
  change_up_pct:      '今日漲幅超過 {threshold}%',
  change_down_pct:    '今日跌幅超過 {threshold}%',
  reversal_from_high: '從今日高點回落 {threshold}%',
  reversal_from_low:  '從今日低點反彈 {threshold}%',
  rsi_above:          'RSI 高於 {threshold}',
  rsi_below:          'RSI 低於 {threshold}',
  macd_golden_cross:  'MACD 黃金交叉',
  macd_death_cross:   'MACD 死亡交叉',
  kdj_golden_cross:   'KDJ 黃金交叉（從低位）',
  kdj_death_cross:    'KDJ 死亡交叉（從高位）',
  bollinger_upper:    '突破布林上軌',
  bollinger_lower:    '跌破布林下軌',
  cross_above_ma5:    '向上穿越5日均線',
  cross_above_ma20:   '向上穿越20日均線',
  cross_below_ma20:   '向下跌破20日均線',
  cross_below_ma60:   '向下跌破60日均線',
  ex_dividend_soon:   '距除息日 {threshold} 天以內',
  earnings_soon:      '距財報公布 {threshold} 天以內',
  institutional_buy:  '外資/投信買超 {threshold} 張以上',
  institutional_sell: '外資/投信賣超 {threshold} 張以上',
  qichang_signal:     '出現起漲突破型態',
  bullbear_signal:    '出現盤中多空訊號',
};

export function buildRulePreview(stockId: string, conditions: AlertCondition[], logic: 'AND' | 'OR'): string {
  if (conditions.length === 0) return '';

  const parts = conditions.map(c => {
    let label = CONDITION_LABELS[c.type] ?? c.type;
    label = label.replace('{threshold}', String(c.threshold ?? ''));
    label = label.replace('{ndParam}', String(c.ndParam ?? 20));
    return label;
  });

  const connector = logic === 'AND' ? ' 且 ' : ' 或 ';
  const condText  = parts.join(connector);
  return `當 [${stockId}] ${condText} 時通知`;
}