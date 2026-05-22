'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import type { ScreenerFilter } from '@/types';

interface FilterPanelProps {
  filters: ScreenerFilter;
  onChange: (f: ScreenerFilter) => void;
}

const SECTORS = [
  '半導體', '電子零組件', '電腦及周邊設備', '光電', '通信網路',
  '電子通路', '資訊服務', '其他電子', '金融', '食品', '塑膠',
  '紡織纖維', '電機機械', '電器電纜', '化工', '鋼鐵', '橡膠',
  '汽車', '建材營造', '航運', '觀光旅遊', '貿易百貨', '其他',
];

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
        {open
          ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />
          : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
        }
      </button>
      {open && <div className="px-4 pb-4 flex flex-col gap-3">{children}</div>}
    </div>
  );
}

// ── Min/Max input pair ────────────────────────────────────────────────────────
function RangeRow({
  label,
  minVal, maxVal,
  onMinChange, onMaxChange,
}: {
  label: string;
  minVal?: number; maxVal?: number;
  onMinChange: (v: number | undefined) => void;
  onMaxChange: (v: number | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex gap-2">
        <input
          type="number"
          placeholder="最小"
          value={minVal ?? ''}
          onChange={e => onMinChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
          className="w-full rounded px-2 py-1 text-xs"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <input
          type="number"
          placeholder="最大"
          value={maxVal ?? ''}
          onChange={e => onMaxChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
          className="w-full rounded px-2 py-1 text-xs"
          style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
      </div>
    </div>
  );
}

// ── Single number input ───────────────────────────────────────────────────────
function NumRow({
  label, value, onChange, placeholder,
}: {
  label: string; value?: number;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <input
        type="number"
        placeholder={placeholder ?? '輸入數值'}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? undefined : parseFloat(e.target.value))}
        className="w-full rounded px-2 py-1 text-xs"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function FilterPanel({ filters, onChange }: FilterPanelProps) {
  const set = (patch: Partial<ScreenerFilter>) =>
    onChange({ ...filters, ...patch, page: 1 });

  return (
    <div
      className="flex flex-col overflow-y-auto rounded-lg text-sm"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        minWidth: '15rem',
        maxHeight: 'calc(100vh - 10rem)',
      }}
    >
      {/* ── 基本面 ─────────────────────────────────────────────────────── */}
      <Section title="📊 基本面">
        <RangeRow
          label="本益比 (PE)"
          minVal={filters.pe_min} maxVal={filters.pe_max}
          onMinChange={v => set({ pe_min: v })}
          onMaxChange={v => set({ pe_max: v })}
        />
        <RangeRow
          label="股價淨值比 (PB)"
          minVal={filters.pb_min} maxVal={filters.pb_max}
          onMinChange={v => set({ pb_min: v })}
          onMaxChange={v => set({ pb_max: v })}
        />
        <NumRow label="ROE 最小值 (%)" value={filters.roe_min}
          onChange={v => set({ roe_min: v })} />
        <NumRow label="毛利率 最小值 (%)" value={filters.gross_margin_min}
          onChange={v => set({ gross_margin_min: v })} />
        <NumRow label="負債比 最大值 (%)" value={filters.debt_ratio_max}
          onChange={v => set({ debt_ratio_max: v })} />
      </Section>

      {/* ── 技術面 ─────────────────────────────────────────────────────── */}
      <Section title="📈 技術面">
        <RangeRow
          label="股價 (NT$)"
          minVal={filters.price_min} maxVal={filters.price_max}
          onMinChange={v => set({ price_min: v })}
          onMaxChange={v => set({ price_max: v })}
        />
        <RangeRow
          label="漲跌幅 (%)"
          minVal={filters.change_pct_min} maxVal={filters.change_pct_max}
          onMinChange={v => set({ change_pct_min: v })}
          onMaxChange={v => set({ change_pct_max: v })}
        />
        <NumRow label="成交量 最小值 (張)" value={filters.volume_min}
          onChange={v => set({ volume_min: v })} placeholder="例：1000" />
      </Section>

      {/* ── 籌碼面 ─────────────────────────────────────────────────────── */}
      <Section title="🏦 籌碼面">
        <NumRow label="外資買超 最小值 (張)" value={filters.foreign_net_min}
          onChange={v => set({ foreign_net_min: v })} />
        <NumRow label="投信買超 最小值 (張)" value={filters.trust_net_min}
          onChange={v => set({ trust_net_min: v })} />
        <NumRow label="外資連買 最小天數" value={filters.foreign_consecutive_min}
          onChange={v => set({ foreign_consecutive_min: v })} placeholder="例：3" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.triple_buy === true}
            onChange={e => set({ triple_buy: e.target.checked ? true : undefined })}
            className="rounded"
            style={{ accentColor: 'var(--accent-gold)' }}
          />
          <span style={{ color: 'var(--text-secondary)' }}>三大法人同買 ★</span>
        </label>
      </Section>

      {/* ── 配息面 ─────────────────────────────────────────────────────── */}
      <Section title="💰 配息面">
        <RangeRow
          label="殖利率 (%)"
          minVal={filters.yield_min} maxVal={filters.yield_max}
          onMinChange={v => set({ yield_min: v })}
          onMaxChange={v => set({ yield_max: v })}
        />
        <NumRow label="連續配息年數" value={filters.consecutive_years_min}
          onChange={v => set({ consecutive_years_min: v })} placeholder="例：5" />
      </Section>

      {/* ── 分類 ───────────────────────────────────────────────────────── */}
      <Section title="🗂 分類">
        {/* Market radio */}
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>市場</span>
          <div className="flex gap-3">
            {(['all', 'TWSE', 'TPEx'] as const).map(m => (
              <label key={m} className="flex items-center gap-1 cursor-pointer text-xs"
                style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="radio"
                  name="market"
                  value={m}
                  checked={(filters.market ?? 'all') === m}
                  onChange={() => set({ market: m })}
                  style={{ accentColor: 'var(--accent-green)' }}
                />
                {m === 'all' ? '全部' : m === 'TWSE' ? '上市' : '上櫃'}
              </label>
            ))}
          </div>
        </div>

        {/* Sector multi-select */}
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>產業別 (可複選)</span>
          <div
            className="flex flex-col gap-1 overflow-y-auto rounded p-2"
            style={{
              maxHeight: '10rem',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border)',
            }}
          >
            {SECTORS.map(sector => {
              const selected = (filters.sector ?? []).includes(sector);
              return (
                <label key={sector} className="flex items-center gap-2 cursor-pointer text-xs"
                  style={{ color: selected ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const current = filters.sector ?? [];
                      const next = selected
                        ? current.filter(s => s !== sector)
                        : [...current, sector];
                      set({ sector: next.length > 0 ? next : undefined });
                    }}
                    style={{ accentColor: 'var(--accent-green)' }}
                  />
                  {sector}
                </label>
              );
            })}
          </div>
        </div>
      </Section>
    </div>
  );
}
