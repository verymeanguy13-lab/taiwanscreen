'use client';

import type { ScreenerFilter } from '@/types';

interface Preset {
  label: string;
  filters: Partial<ScreenerFilter> | null; // null = reset
}

const PRESETS: Preset[] = [
  { label: '存股族',   filters: { yield_min: 4, consecutive_years_min: 5, pe_max: 20 } },
  { label: '外資連買', filters: { foreign_consecutive_min: 5 } },
  { label: '三買訊號', filters: { triple_buy: true } },
  { label: '高ROE',   filters: { roe_min: 20 } },
  { label: '飆股潛力', filters: { change_pct_min: 5, foreign_net_min: 0 } },
  { label: '低本益比', filters: { pe_min: 1, pe_max: 10 } },
  { label: '高息ETF', filters: { yield_min: 4, dividend_freq: 'quarterly' } },
  { label: '巴菲特選股', filters: { pe_max: 15, pb_max: 1.5, roe_min: 15 } },
  { label: '清除篩選', filters: null },
];

interface PresetBarProps {
  currentFilters: ScreenerFilter;
  onFilterChange: (f: ScreenerFilter) => void;
}

export function PresetBar({ currentFilters, onFilterChange }: PresetBarProps) {
  const handlePreset = (preset: Preset) => {
    if (preset.filters === null) {
      // Reset all filters
      onFilterChange({ market: 'all', sort_by: 'change_pct', sort_dir: 'desc', page: 1, per_page: 50 });
    } else {
      onFilterChange({
        ...currentFilters,
        ...preset.filters,
        page: 1,
      });
    }
  };

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {PRESETS.map((preset) => {
        const isClear = preset.filters === null;
        return (
          <button
            key={preset.label}
            onClick={() => handlePreset(preset)}
            className="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap"
            style={{
              backgroundColor: isClear ? 'transparent' : 'rgba(0,212,170,0.08)',
              color: isClear ? 'var(--text-muted)' : 'var(--accent-green)',
              border: isClear
                ? '1px solid var(--border)'
                : '1px solid rgba(0,212,170,0.3)',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = isClear
                ? 'rgba(139,143,168,0.08)'
                : 'rgba(0,212,170,0.18)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.backgroundColor = isClear ? 'transparent' : 'rgba(0,212,170,0.08)';
            }}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
