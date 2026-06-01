// =============================================================================
// lib/alertEvaluator.ts — Pure alert condition evaluation engine
// No DB calls, no API calls. Takes pre-fetched data, returns triggered status.
// =============================================================================

import type { Candle, InstitutionalFlow } from '@/types';
import type { RealtimeQuote } from '@/lib/fugle';
import type { BreakoutSignal } from '@/lib/breakouts';
import type { IntradaySignalEvent } from '@/lib/bullbearSignals';

export type AlertConditionType =
  | 'price_above' | 'price_below' | 'price_cross_up' | 'price_cross_down'
  | 'hit_limit_up' | 'hit_limit_down' | 'new_high_nd' | 'new_low_nd'
  | 'single_lot_above' | 'total_vol_above' | 'vol_ratio_above'
  | 'vol_spike' | 'vol_unusual' | 'vol_shrink'
  | 'change_up_pct' | 'change_down_pct' | 'reversal_from_high' | 'reversal_from_low'
  | 'rsi_above' | 'rsi_below' | 'macd_golden_cross' | 'macd_death_cross'
  | 'kdj_golden_cross' | 'kdj_death_cross' | 'bollinger_upper' | 'bollinger_lower'
  | 'cross_above_ma5' | 'cross_above_ma20' | 'cross_below_ma20' | 'cross_below_ma60'
  | 'ex_dividend_soon' | 'earnings_soon' | 'institutional_buy' | 'institutional_sell'
  | 'qichang_signal' | 'bullbear_signal';

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

export interface AlertCondition {
  type:       AlertConditionType;
  threshold?: number;
  ndParam?:   number;
}

export interface AlertRule {
  id:         string;
  stockId:    string;
  conditions: AlertCondition[];
  logic:      'AND' | 'OR';
  enabled:    boolean;
  triggered:  boolean;
  createdAt:  string;
}

export interface IndicatorSet {
  sma5:     (number | null)[];
  sma20:    (number | null)[];
  sma60:    (number | null)[];
  rsi14:    (number | null)[];
  macd:     { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] };
  kdj:      { k: (number | null)[]; d: (number | null)[]; j: (number | null)[] };
  bb:       { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] };
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
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

export function evaluateCondition(condition: AlertCondition, ctx: EvaluationContext): boolean {
  const { type, threshold = 0, ndParam = 20 } = condition;
  const { quote, candles, indicators, institutional, dividendDates,
          estimatedEarningsDate, breakouts, intradaySignals } = ctx;

  const n         = candles.length;
  const today     = candles[n - 1];
  const prev      = candles[n - 2];
  const price     = quote.price     ?? today?.close ?? 0;
  const prevClose = quote.prevClose ?? prev?.close  ?? 0;

  if (type === 'price_above')      return price > threshold;
  if (type === 'price_below')      return price < threshold;
  if (type === 'price_cross_up')   return (prev?.close ?? 0) <= threshold && price > threshold;
  if (type === 'price_cross_down') return (prev?.close ?? 0) >= threshold && price < threshold;
  if (type === 'hit_limit_up')     return price >= prevClose * 1.099;
  if (type === 'hit_limit_down')   return price <= prevClose * 0.901;

  if (type === 'new_high_nd') {
    if (n < ndParam + 1) return false;
    return price > Math.max(...candles.slice(Math.max(0, n - ndParam - 1), n - 1).map(c => c.high));
  }
  if (type === 'new_low_nd') {
    if (n < ndParam + 1) return false;
    return price < Math.min(...candles.slice(Math.max(0, n - ndParam - 1), n - 1).map(c => c.low));
  }

  if (type === 'single_lot_above') return (quote.volume ?? 0) > threshold;
  if (type === 'total_vol_above')  return (quote.volume ?? today?.volume ?? 0) > threshold;
  if (type === 'vol_ratio_above')  { const vr = lastN(indicators.volRatio); return vr !== null && vr > threshold; }
  if (type === 'vol_spike')        { const av = avgVol(candles,5,1); return av > 0 && (today?.volume??0) > 2*av; }
  if (type === 'vol_unusual')      { const av = avgVol(candles,5,1); return av > 0 && (today?.volume??0) > 3*av; }
  if (type === 'vol_shrink')       { const av = avgVol(candles,5,1); return av > 0 && (today?.volume??0) < 0.5*av; }

  if (type === 'change_up_pct')   return prevClose > 0 && ((price - prevClose) / prevClose) * 100 > threshold;
  if (type === 'change_down_pct') return prevClose > 0 && ((prevClose - price) / prevClose) * 100 > threshold;

  if (type === 'reversal_from_high') {
    const h = quote.high ?? price;
    return h > 0 && ((h - price) / h) * 100 > threshold;
  }
  if (type === 'reversal_from_low') {
    const l = quote.low ?? price;
    return l > 0 && ((price - l) / l) * 100 > threshold;
  }

  if (type === 'rsi_above') { const v = lastN(indicators.rsi14); return v !== null && v > threshold; }
  if (type === 'rsi_below') { const v = lastN(indicators.rsi14); return v !== null && v < threshold; }

  if (type === 'macd_golden_cross') {
    const mn = lastN(indicators.macd.macdLine), sn = lastN(indicators.macd.signalLine);
    const mp = lastN(indicators.macd.macdLine,1), sp = lastN(indicators.macd.signalLine,1);
    if (mn===null||sn===null||mp===null||sp===null) return false;
    return mp <= sp && mn > sn;
  }
  if (type === 'macd_death_cross') {
    const mn = lastN(indicators.macd.macdLine), sn = lastN(indicators.macd.signalLine);
    const mp = lastN(indicators.macd.macdLine,1), sp = lastN(indicators.macd.signalLine,1);
    if (mn===null||sn===null||mp===null||sp===null) return false;
    return mp >= sp && mn < sn;
  }

  if (type === 'kdj_golden_cross') {
    const kn=lastN(indicators.kdj.k), dn=lastN(indicators.kdj.d);
    const kp=lastN(indicators.kdj.k,1), dp=lastN(indicators.kdj.d,1);
    if (kn===null||dn===null||kp===null||dp===null) return false;
    return kp<=dp && kn>dn && kp<20;
  }
  if (type === 'kdj_death_cross') {
    const kn=lastN(indicators.kdj.k), dn=lastN(indicators.kdj.d);
    const kp=lastN(indicators.kdj.k,1), dp=lastN(indicators.kdj.d,1);
    if (kn===null||dn===null||kp===null||dp===null) return false;
    return kp>=dp && kn<dn && kp>80;
  }

  if (type === 'bollinger_upper') { const u = lastN(indicators.bb.upper); return u !== null && price > u; }
  if (type === 'bollinger_lower') { const l = lastN(indicators.bb.lower); return l !== null && price < l; }

  if (type === 'cross_above_ma5')  { const n5=lastN(indicators.sma5),   p5=lastN(indicators.sma5,1);   if(!n5||!p5) return false; return (prev?.close??0)<=p5 && price>n5; }
  if (type === 'cross_above_ma20') { const n20=lastN(indicators.sma20), p20=lastN(indicators.sma20,1); if(!n20||!p20) return false; return (prev?.close??0)<=p20 && price>n20; }
  if (type === 'cross_below_ma20') { const n20=lastN(indicators.sma20), p20=lastN(indicators.sma20,1); if(!n20||!p20) return false; return (prev?.close??0)>=p20 && price<n20; }
  if (type === 'cross_below_ma60') { const n60=lastN(indicators.sma60), p60=lastN(indicators.sma60,1); if(!n60||!p60) return false; return (prev?.close??0)>=p60 && price<n60; }

  if (type === 'ex_dividend_soon') {
    if (!dividendDates?.length) return false;
    return dividendDates.some(d => { const days=daysUntil(d.exDate); return days>=0 && days<=threshold; });
  }
  if (type === 'earnings_soon') {
    if (!estimatedEarningsDate) return false;
    const days = daysUntil(estimatedEarningsDate);
    return days >= 0 && days <= threshold;
  }
  if (type === 'institutional_buy') {
    if (!institutional?.length) return false;
    const l = institutional[institutional.length-1];
    return ((l.foreign_net??0)+(l.trust_net??0)) > threshold;
  }
  if (type === 'institutional_sell') {
    if (!institutional?.length) return false;
    const l = institutional[institutional.length-1];
    return ((l.foreign_net??0)+(l.trust_net??0)) < -threshold;
  }

  if (type === 'qichang_signal')  return !!(breakouts?.length);
  if (type === 'bullbear_signal') return !!(intradaySignals?.length);

  return false;
}

export function evaluateRule(rule: AlertRule, ctx: EvaluationContext): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  const results = rule.conditions.map(c => evaluateCondition(c, ctx));
  return rule.logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

export function buildAlertMessage(rule: AlertRule, ctx: EvaluationContext): string {
  const { quote, candles, indicators, institutional, dividendDates, breakouts } = ctx;
  const n     = candles.length;
  const price = quote.price ?? candles[n-1]?.close ?? 0;
  const id    = rule.stockId;
  const parts: string[] = [];

  for (const cond of rule.conditions) {
    const { type, threshold=0, ndParam=20 } = cond;
    switch (type) {
      case 'price_above': case 'price_cross_up':
        parts.push(`[${id}] 股價 ${price} 突破設定價位 ${threshold} 元`); break;
      case 'price_below': case 'price_cross_down':
        parts.push(`[${id}] 股價 ${price} 跌破設定價位 ${threshold} 元`); break;
      case 'hit_limit_up':   parts.push(`[${id}] 觸及漲停板，強勢鎖板`); break;
      case 'hit_limit_down': parts.push(`[${id}] 觸及跌停板，弱勢跌停`); break;
      case 'new_high_nd':    parts.push(`[${id}] 創 ${ndParam} 日新高，現價 ${price}`); break;
      case 'new_low_nd':     parts.push(`[${id}] 創 ${ndParam} 日新低，現價 ${price}`); break;
      case 'vol_spike':      parts.push(`[${id}] 成交量爆增超過均量 2 倍`); break;
      case 'vol_unusual':    parts.push(`[${id}] 異常量能，超過均量 3 倍`); break;
      case 'vol_shrink':     parts.push(`[${id}] 縮量整理，低於均量 0.5 倍`); break;
      case 'vol_ratio_above': parts.push(`[${id}] 量比 ${(indicators.volRatio[n-1]??0).toFixed(1)} 倍，超過設定 ${threshold} 倍`); break;
      case 'change_up_pct':   parts.push(`[${id}] 今日漲幅超過 ${threshold}%，現漲 ${(quote.changePercent??0).toFixed(2)}%`); break;
      case 'change_down_pct': parts.push(`[${id}] 今日跌幅超過 ${threshold}%，現跌 ${Math.abs(quote.changePercent??0).toFixed(2)}%`); break;
      case 'reversal_from_high': parts.push(`[${id}] 從今日高點 ${quote.high??'—'} 回落超過 ${threshold}%`); break;
      case 'reversal_from_low':  parts.push(`[${id}] 從今日低點 ${quote.low??'—'} 反彈超過 ${threshold}%`); break;
      case 'rsi_above': parts.push(`[${id}] RSI(${(lastN(indicators.rsi14)??0).toFixed(1)}) 超過 ${threshold}，技術面偏強`); break;
      case 'rsi_below': parts.push(`[${id}] RSI(${(lastN(indicators.rsi14)??0).toFixed(1)}) 低於 ${threshold}，技術面偏弱`); break;
      case 'macd_golden_cross': parts.push(`[${id}] MACD 黃金交叉，動能轉強`); break;
      case 'macd_death_cross':  parts.push(`[${id}] MACD 死亡交叉，動能轉弱`); break;
      case 'kdj_golden_cross':  parts.push(`[${id}] KDJ 黃金交叉（K 穿越 D，從低位）`); break;
      case 'kdj_death_cross':   parts.push(`[${id}] KDJ 死亡交叉（K 穿越 D，從高位）`); break;
      case 'bollinger_upper': parts.push(`[${id}] 股價 ${price} 突破布林通道上軌 ${(lastN(indicators.bb.upper)??0).toFixed(2)}`); break;
      case 'bollinger_lower': parts.push(`[${id}] 股價 ${price} 跌破布林通道下軌 ${(lastN(indicators.bb.lower)??0).toFixed(2)}`); break;
      case 'cross_above_ma5':  parts.push(`[${id}] 向上穿越 5 日均線，短線偏多`); break;
      case 'cross_above_ma20': parts.push(`[${id}] 向上穿越 20 日均線，趨勢轉多`); break;
      case 'cross_below_ma20': parts.push(`[${id}] 向下跌破 20 日均線，趨勢轉空`); break;
      case 'cross_below_ma60': parts.push(`[${id}] 向下跌破 60 日均線，長線走弱`); break;
      case 'ex_dividend_soon': {
        const nearest = dividendDates?.[0];
        if (nearest) parts.push(`[${id}] 距除息日僅剩 ${daysUntil(nearest.exDate)} 天，除息日：${nearest.exDate}`);
        break;
      }
      case 'earnings_soon': {
        if (ctx.estimatedEarningsDate) parts.push(`[${id}] 距財報公布僅剩 ${daysUntil(ctx.estimatedEarningsDate)} 天`);
        break;
      }
      case 'institutional_buy': {
        const l = institutional?.[institutional.length-1];
        parts.push(`[${id}] 外資/投信今日買超 ${((l?.foreign_net??0)+(l?.trust_net??0)).toLocaleString()} 張`);
        break;
      }
      case 'institutional_sell': {
        const l = institutional?.[institutional.length-1];
        parts.push(`[${id}] 外資/投信今日賣超 ${Math.abs((l?.foreign_net??0)+(l?.trust_net??0)).toLocaleString()} 張`);
        break;
      }
      case 'qichang_signal':  parts.push(`[${id}] 出現起漲突破型態：${breakouts?.[0]?.type??'突破型態'}`); break;
      case 'bullbear_signal': parts.push(`[${id}] 出現盤中多空訊號`); break;
      default: parts.push(`[${id}] 警示條件觸發`);
    }
  }

  return parts.join(rule.logic === 'AND' ? ' 且 ' : ' 或 ');
}

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
    label = label.replace('{ndParam}',   String(c.ndParam   ?? 20));
    return label;
  });
  return `當 [${stockId}] ${parts.join(logic === 'AND' ? ' 且 ' : ' 或 ')} 時通知`;
}