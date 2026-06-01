'use client';

// =============================================================================
// components/alerts/ConditionBuilder.tsx
// Multi-condition alert builder UI — replaces the single radio selector
// in the alerts page. Drop this component into the alerts page.
//
// Usage:
//   import { ConditionBuilder } from '@/components/alerts/ConditionBuilder';
//   <ConditionBuilder
//     symbol={symbol}
//     onSave={async (conditions, logic) => { ... }}
//     disabled={atLimit}
//   />
// =============================================================================

import { useState } from 'react';
import type { AlertCondition, AlertConditionType } from '@/lib/alertEvaluator';
import { NO_THRESHOLD_TYPES, buildRulePreview } from '@/lib/alertEvaluator';

// ── Category definitions ──────────────────────────────────────────────────────

type Category = '價格' | '成交量' | '漲跌幅' | '技術指標' | '事件' | '綜合訊號';

interface ConditionCard {
  type:        AlertConditionType;
  label:       string;
  description: string;
  icon:        string;
  defaultThreshold?: number;
  defaultNdParam?:   number;
}

const CATEGORIES: { id: Category; icon: string }[] = [
  { id: '價格',   icon: '💰' },
  { id: '成交量', icon: '📊' },
  { id: '漲跌幅', icon: '📈' },
  { id: '技術指標',icon: '🔧' },
  { id: '事件',   icon: '📅' },
  { id: '綜合訊號',icon: '⚡' },
];

const CONDITION_CARDS: Record<Category, ConditionCard[]> = {
  '價格': [
    { type: 'price_above',      label: '股價高於X元',   icon: '↑', description: '當股價超過指定價格時通知', defaultThreshold: 100 },
    { type: 'price_below',      label: '股價低於X元',   icon: '↓', description: '當股價跌破指定價格時通知', defaultThreshold: 50  },
    { type: 'price_cross_up',   label: '向上突破X元',   icon: '🔺', description: '股價從下方突破指定價格（邊緣觸發）', defaultThreshold: 100 },
    { type: 'price_cross_down', label: '向下跌破X元',   icon: '🔻', description: '股價從上方跌破指定價格（邊緣觸發）', defaultThreshold: 50  },
    { type: 'hit_limit_up',     label: '當日漲停',       icon: '🔴', description: '觸及漲停板（+10%）' },
    { type: 'hit_limit_down',   label: '當日跌停',       icon: '🟢', description: '觸及跌停板（-10%）' },
    { type: 'new_high_nd',      label: '創N日新高',      icon: '🏔️', description: '創近N日收盤價新高', defaultNdParam: 20 },
    { type: 'new_low_nd',       label: '創N日新低',      icon: '🕳️', description: '創近N日收盤價新低', defaultNdParam: 20 },
  ],
  '成交量': [
    { type: 'single_lot_above', label: '單量大於X張',           icon: '📦', description: '單筆成交量超過指定張數', defaultThreshold: 1000 },
    { type: 'total_vol_above',  label: '總量大於X張',           icon: '📊', description: '今日累計成交量超過指定張數', defaultThreshold: 10000 },
    { type: 'vol_ratio_above',  label: '量比大於X倍',           icon: '⚖️', description: '成交量超過近5日均量的指定倍數', defaultThreshold: 2 },
    { type: 'vol_spike',        label: '成交量爆增（2倍均量）', icon: '💥', description: '今日成交量超過近5日均量2倍' },
    { type: 'vol_unusual',      label: '異常量能（3倍均量）',   icon: '🚨', description: '今日成交量超過近5日均量3倍' },
    { type: 'vol_shrink',       label: '縮量整理（低於0.5倍）', icon: '🔇', description: '今日成交量低於近5日均量0.5倍，整理訊號' },
  ],
  '漲跌幅': [
    { type: 'change_up_pct',      label: '今日漲幅超過X%',   icon: '📈', description: '當日漲幅超過指定百分比', defaultThreshold: 3 },
    { type: 'change_down_pct',    label: '今日跌幅超過X%',   icon: '📉', description: '當日跌幅超過指定百分比', defaultThreshold: 3 },
    { type: 'reversal_from_high', label: '從今日高點回落X%', icon: '🔽', description: '從今日最高點下滑超過指定幅度', defaultThreshold: 3 },
    { type: 'reversal_from_low',  label: '從今日低點反彈X%', icon: '🔼', description: '從今日最低點反彈超過指定幅度', defaultThreshold: 3 },
  ],
  '技術指標': [
    { type: 'rsi_above',         label: 'RSI高於X',          icon: '📡', description: 'RSI(14)超過指定值，偏強訊號', defaultThreshold: 70 },
    { type: 'rsi_below',         label: 'RSI低於X',          icon: '📡', description: 'RSI(14)低於指定值，偏弱訊號', defaultThreshold: 30 },
    { type: 'macd_golden_cross', label: 'MACD黃金交叉',       icon: '✨', description: 'MACD線向上穿越訊號線' },
    { type: 'macd_death_cross',  label: 'MACD死亡交叉',       icon: '💀', description: 'MACD線向下穿越訊號線' },
    { type: 'kdj_golden_cross',  label: 'KDJ黃金交叉',        icon: '🌅', description: 'K線從低位（<20）向上穿越D線' },
    { type: 'kdj_death_cross',   label: 'KDJ死亡交叉',        icon: '🌑', description: 'K線從高位（>80）向下穿越D線' },
    { type: 'bollinger_upper',   label: '突破布林上軌',        icon: '🎯', description: '收盤價突破布林通道上軌' },
    { type: 'bollinger_lower',   label: '跌破布林下軌',        icon: '🎯', description: '收盤價跌破布林通道下軌' },
    { type: 'cross_above_ma5',   label: '向上穿越5日均線',     icon: '〰️', description: '股價從下方穿越5MA' },
    { type: 'cross_above_ma20',  label: '向上穿越20日均線',    icon: '〰️', description: '股價從下方穿越20MA，趨勢轉多' },
    { type: 'cross_below_ma20',  label: '向下跌破20日均線',    icon: '〰️', description: '股價從上方跌破20MA，趨勢轉空' },
    { type: 'cross_below_ma60',  label: '向下跌破60日均線',    icon: '〰️', description: '股價跌破60MA，長線走弱' },
  ],
  '事件': [
    { type: 'ex_dividend_soon',   label: '距除息日N天以內',         icon: '💵', description: '除息日即將到來', defaultThreshold: 7  },
    { type: 'earnings_soon',      label: '距財報公布N天以內',        icon: '📋', description: '財報發布日即將到來', defaultThreshold: 7  },
    { type: 'institutional_buy',  label: '外資/投信買超X張以上',     icon: '🏦', description: '法人今日合計買超超過指定張數', defaultThreshold: 1000 },
    { type: 'institutional_sell', label: '外資/投信賣超X張以上',     icon: '🏦', description: '法人今日合計賣超超過指定張數', defaultThreshold: 1000 },
  ],
  '綜合訊號': [
    { type: 'qichang_signal',  label: '出現起漲突破型態', icon: '⚡', description: '台股雷達偵測到上漲趨勢突破、箱型整理突破或V轉訊號' },
    { type: 'bullbear_signal', label: '出現盤中多空訊號', icon: '🎯', description: '台股雷達偵測到盤中突破昨高、站上均線等即時訊號' },
  ],
};

// ── Threshold Input ───────────────────────────────────────────────────────────

function ThresholdInput({
  condition,
  onChange,
}: {
  condition: AlertCondition;
  onChange: (updated: AlertCondition) => void;
}) {
  const { type, threshold, ndParam } = condition;

  if (NO_THRESHOLD_TYPES.includes(type)) return null;

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '4px 8px',
    fontSize: 13,
    width: 80,
    textAlign: 'center',
  };

  // N-day param types
  if (type === 'new_high_nd' || type === 'new_low_nd') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>創</span>
        <input type="number" min={1} max={60} value={ndParam ?? 20}
          onChange={e => onChange({ ...condition, ndParam: parseInt(e.target.value, 10) || 20 })}
          style={inputStyle} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {type === 'new_high_nd' ? '日新高' : '日新低'}
        </span>
      </div>
    );
  }

  // RSI slider
  if (type === 'rsi_above' || type === 'rsi_below') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>RSI</span>
        <input type="range" min={1} max={100} step={1}
          value={threshold ?? (type === 'rsi_above' ? 70 : 30)}
          onChange={e => onChange({ ...condition, threshold: parseInt(e.target.value, 10) })}
          style={{ width: 80, accentColor: 'var(--accent-green)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-green)', minWidth: 28 }}>
          {threshold ?? (type === 'rsi_above' ? 70 : 30)}
        </span>
      </div>
    );
  }

  // Volume ratio slider
  if (type === 'vol_ratio_above') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>量比大於</span>
        <input type="range" min={1} max={5} step={0.5}
          value={threshold ?? 2}
          onChange={e => onChange({ ...condition, threshold: parseFloat(e.target.value) })}
          style={{ width: 80, accentColor: 'var(--accent-green)' }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-green)', minWidth: 28 }}>
          {(threshold ?? 2).toFixed(1)}x
        </span>
      </div>
    );
  }

  // Days inputs
  if (type === 'ex_dividend_soon' || type === 'earnings_soon') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>距</span>
        <input type="number" min={1} max={30} value={threshold ?? 7}
          onChange={e => onChange({ ...condition, threshold: parseInt(e.target.value, 10) || 7 })}
          style={inputStyle} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>天以內</span>
      </div>
    );
  }

  // Percentage inputs
  if (['change_up_pct', 'change_down_pct', 'reversal_from_high', 'reversal_from_low'].includes(type)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <input type="number" min={0.1} max={30} step={0.5} value={threshold ?? 3}
          onChange={e => onChange({ ...condition, threshold: parseFloat(e.target.value) || 3 })}
          style={inputStyle} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
      </div>
    );
  }

  // Default: price / volume /张 number input
  const suffix =
    type.includes('vol') || type.includes('institutional') || type === 'single_lot_above' || type === 'total_vol_above'
      ? '張'
      : type.includes('price') || type.includes('cross')
        ? '元'
        : '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <input type="number" min={0} value={threshold ?? ''}
        placeholder="數值"
        onChange={e => onChange({ ...condition, threshold: parseFloat(e.target.value) || 0 })}
        style={inputStyle} />
      {suffix && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{suffix}</span>}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface ConditionBuilderProps {
  symbol:   string;
  onSave:   (conditions: AlertCondition[], logic: 'AND' | 'OR') => Promise<void>;
  disabled?: boolean;
}

export function ConditionBuilder({ symbol, onSave, disabled }: ConditionBuilderProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('價格');
  const [selected,       setSelected]        = useState<AlertCondition[]>([]);
  const [logic,          setLogic]           = useState<'AND' | 'OR'>('OR');
  const [saving,         setSaving]          = useState(false);
  const [error,          setError]           = useState('');

  const isSelected = (type: AlertConditionType) =>
    selected.some(c => c.type === type);

  const toggleCondition = (card: ConditionCard) => {
    if (isSelected(card.type)) {
      setSelected(prev => prev.filter(c => c.type !== card.type));
    } else {
      if (selected.length >= 3) return;
      setSelected(prev => [...prev, {
        type:      card.type,
        threshold: card.defaultThreshold,
        ndParam:   card.defaultNdParam,
      }]);
    }
  };

  const updateCondition = (idx: number, updated: AlertCondition) => {
    setSelected(prev => prev.map((c, i) => i === idx ? updated : c));
  };

  const handleSave = async () => {
    setError('');
    if (selected.length === 0) { setError('請至少選擇一個條件'); return; }
    if (!symbol.trim())        { setError('請先輸入股票代號');   return; }

    // Validate thresholds
    for (const c of selected) {
      if (!NO_THRESHOLD_TYPES.includes(c.type) && !c.threshold && c.threshold !== 0) {
        setError('請填寫所有條件的數值');
        return;
      }
    }

    setSaving(true);
    try {
      await onSave(selected, logic);
      setSelected([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const preview = symbol && selected.length > 0
    ? buildRulePreview(symbol, selected, logic)
    : '';

  const BTN: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 6, fontSize: 12,
    cursor: 'pointer', border: '1px solid var(--border)',
    backgroundColor: 'transparent', color: 'var(--text-secondary)',
  };

  const BTN_ACTIVE: React.CSSProperties = {
    ...BTN,
    backgroundColor: 'var(--accent-green)',
    color: 'var(--bg-primary)',
    border: '1px solid var(--accent-green)',
    fontWeight: 700,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── STEP 1: Category tabs ─────────────────────────────────────────── */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
          第一步：選擇條件類型（最多3個）
        </p>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {CATEGORIES.map(cat => (
            <button key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              style={activeCategory === cat.id ? BTN_ACTIVE : BTN}>
              {cat.icon} {cat.id}
            </button>
          ))}
        </div>
      </div>

      {/* ── STEP 2: Condition cards ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {CONDITION_CARDS[activeCategory].map(card => {
          const sel   = isSelected(card.type);
          const full  = !sel && selected.length >= 3;
          return (
            <button
              key={card.type}
              onClick={() => !full && toggleCondition(card)}
              disabled={full}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: '10px 12px', borderRadius: 8, textAlign: 'left',
                cursor: full ? 'not-allowed' : 'pointer',
                opacity: full ? 0.4 : 1,
                border: sel ? '2px solid var(--accent-green)' : '1px solid var(--border)',
                backgroundColor: sel ? 'rgba(0,212,170,0.08)' : 'var(--bg-secondary)',
                transition: 'border-color 0.15s',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: sel ? 'var(--accent-green)' : 'var(--text-primary)' }}>
                  {card.icon} {card.label}
                </span>
                {sel && <span style={{ fontSize: 14, color: 'var(--accent-green)' }}>✓</span>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {card.description}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── STEP 3: Threshold inputs for selected conditions ─────────────── */}
      {selected.length > 0 && (
        <div style={{
          padding: '12px 14px', borderRadius: 8,
          border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)',
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
            第二步：設定條件數值
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selected.map((cond, idx) => {
              const card = Object.values(CONDITION_CARDS).flat().find(c => c.type === cond.type);
              return (
                <div key={cond.type} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-green)' }}>
                      {card?.icon} {card?.label}
                    </span>
                    <button
                      onClick={() => setSelected(prev => prev.filter((_, i) => i !== idx))}
                      style={{ fontSize: 11, color: 'var(--accent-red)', cursor: 'pointer',
                        background: 'none', border: 'none', padding: 0 }}>
                      移除
                    </button>
                  </div>
                  <ThresholdInput
                    condition={cond}
                    onChange={updated => updateCondition(idx, updated)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── STEP 4: Logic selector (only when 2+ conditions) ─────────────── */}
      {selected.length >= 2 && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)',
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
            第三步：條件組合邏輯
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(['OR', 'AND'] as const).map(l => (
              <label key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13,
                color: logic === l ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                <input type="radio" name="logic" value={l} checked={logic === l}
                  onChange={() => setLogic(l)}
                  style={{ accentColor: 'var(--accent-green)' }} />
                {l === 'OR'
                  ? '任一條件符合即通知（OR）'
                  : '所有條件同時符合才通知（AND）'}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── STEP 5: Rule preview ─────────────────────────────────────────── */}
      {preview && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          border: '1px solid rgba(0,212,170,0.3)',
          backgroundColor: 'rgba(0,212,170,0.06)',
        }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>預覽</p>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-green)', lineHeight: 1.5 }}>
            {preview}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p style={{ fontSize: 12, color: 'var(--accent-red)' }}>{error}</p>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving || disabled || selected.length === 0}
        style={{
          padding: '10px 0', borderRadius: 8, fontSize: 14, fontWeight: 700,
          cursor: (saving || disabled || selected.length === 0) ? 'not-allowed' : 'pointer',
          opacity: (saving || disabled || selected.length === 0) ? 0.5 : 1,
          backgroundColor: 'var(--accent-green)',
          color: 'var(--bg-primary)', border: 'none',
        }}>
        {saving ? '儲存中…' : '送出警示'}
      </button>
    </div>
  );
}
