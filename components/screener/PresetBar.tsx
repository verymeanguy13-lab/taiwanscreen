'use client';

import { useState } from 'react';
import type { ScreenerFilter } from '@/types';

// ── Preset definitions ────────────────────────────────────────────────────────

interface Preset {
  id:       string;
  label_zh: string;
  label_en: string;
  desc_zh:  string;
  filters:  Partial<ScreenerFilter>;
}

const PRESETS: Preset[] = [
  {
    id: 'dividend_hunter',
    label_zh: '存股族', label_en: 'Dividend Hunter',
    desc_zh: '高殖利率、連續配息、低負債',
    filters: { yield_min: 4, consecutive_years_min: 5, pe_max: 20, debt_ratio_max: 50 },
  },
  {
    id: 'monthly_income',
    label_zh: '月月領息', label_en: 'Monthly Income',
    desc_zh: '月配息ETF或股票',
    filters: { dividend_freq: 'monthly', yield_min: 3 },
  },
  {
    id: 'foreign_streak',
    label_zh: '外資連買', label_en: 'Foreign Buy Streak',
    desc_zh: '外資連續買超5日以上',
    filters: { foreign_consecutive_min: 5, volume_min: 500 },
  },
  {
    id: 'triple_buy',
    label_zh: '三買訊號', label_en: 'Triple Buy',
    desc_zh: '外資投信自營商同時呈現買超',
    filters: { triple_buy: true, volume_min: 200 },
  },
  {
    id: 'foreign_trust_double',
    label_zh: '外資投信雙買', label_en: 'Foreign+Trust Buy',
    desc_zh: '外資投信同步買超',
    filters: { foreign_net_min: 100, trust_net_min: 50 },
  },
  {
    id: 'momentum',
    label_zh: '飆股潛力', label_en: 'Momentum',
    desc_zh: '近月價格上漲且外資持續買超',
    filters: { foreign_net_min: 0, volume_min: 1000 },
  },
  {
    id: 'buffett',
    label_zh: '巴菲特選股', label_en: 'Value (Buffett)',
    desc_zh: '低本益比、高ROE、低負債',
    filters: { pe_max: 15, pb_max: 1.5, roe_min: 15, debt_ratio_max: 40 },
  },
  {
    id: 'high_growth',
    label_zh: '高成長', label_en: 'High Growth',
    desc_zh: '營收EPS均高速成長',
    filters: { revenue_growth_min: 20, eps_growth_min: 20, roe_min: 15 },
  },
  {
    id: 'low_pe',
    label_zh: '低本益比', label_en: 'Low P/E',
    desc_zh: '本益比低且獲利穩定',
    filters: { pe_min: 1, pe_max: 10, roe_min: 10 },
  },
  {
    id: 'high_roe',
    label_zh: '高ROE', label_en: 'High ROE',
    desc_zh: '股東權益報酬率優異',
    filters: { roe_min: 20, pe_max: 30 },
  },
  {
    id: 'margin_clearing',
    label_zh: '融資減少', label_en: 'Margin Clearing',
    desc_zh: '融資餘額減少且外資買超',
    filters: { margin_trend: 'decreasing', foreign_net_min: 100 },
  },
  {
    id: 'near_52w_low',
    label_zh: '距低點反彈', label_en: 'Bouncing from Low',
    desc_zh: '距52週低點已反彈20%以上',
    filters: {},
  },
  {
    id: 'semiconductor',
    label_zh: '半導體族群', label_en: 'Semiconductors',
    desc_zh: '半導體產業所有股票',
    filters: { sector: ['半導體'] },
  },
  {
    id: 'high_gross_margin',
    label_zh: '高毛利率', label_en: 'High Gross Margin',
    desc_zh: '毛利率40%以上的優質企業',
    filters: { gross_margin_min: 40, roe_min: 15 },
  },
  {
    id: 'stable_dividend',
    label_zh: '配息穩定', label_en: 'Stable Dividend',
    desc_zh: '配息穩定分數80分以上',
    filters: { stability_score_min: 80, yield_min: 3 },
  },
  {
    id: 'small_cap_growth',
    label_zh: '小型成長股', label_en: 'Small Cap Growth',
    desc_zh: '市值50億以下高成長小型股',
    filters: { market_cap_max: 50, revenue_growth_min: 15, roe_min: 12 },
  },
  {
    id: 'large_cap_quality',
    label_zh: '大型優質股', label_en: 'Large Cap Quality',
    desc_zh: '市值1000億以上績優大型股',
    filters: { market_cap_min: 1000, roe_min: 15, debt_ratio_max: 35 },
  },
  {
    id: 'quarterly_dividend',
    label_zh: '季配息', label_en: 'Quarterly Payout',
    desc_zh: '季配息且殖利率4%以上',
    filters: { dividend_freq: 'quarterly', yield_min: 4 },
  },
  {
    id: 'low_debt_high_yield',
    label_zh: '低負債高息', label_en: 'Low Debt High Yield',
    desc_zh: '負債比30%以下且高殖利率',
    filters: { debt_ratio_max: 30, yield_min: 4 },
  },
  {
    id: 'big_foreign_buy',
    label_zh: '外資大買超', label_en: 'Heavy Foreign Buying',
    desc_zh: '外資單日大量買超',
    filters: { foreign_net_min: 1000, volume_min: 500 },
  },
];

const DESKTOP_DEFAULT = 10;
const MOBILE_DEFAULT  = 5;

// ── Props ─────────────────────────────────────────────────────────────────────

interface PresetBarProps {
  currentFilters: ScreenerFilter;
  onFilterChange: (f: ScreenerFilter) => void;
  locale?: 'zh' | 'en';
}

// ── Preset button ─────────────────────────────────────────────────────────────

function PresetButton({
  preset,
  locale,
  onClick,
}: {
  preset: Preset;
  locale: 'zh' | 'en';
  onClick: () => void;
}) {
  const [showTip, setShowTip] = useState(false);
  const label = locale === 'en' ? preset.label_en : preset.label_zh;
  const desc  = preset.desc_zh;

  return (
    <div className="relative shrink-0">
      <button
        onClick={onClick}
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        className="rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap"
        style={{
          backgroundColor: 'rgba(0,212,170,0.08)',
          color: 'var(--accent-green)',
          border: '1px solid rgba(0,212,170,0.3)',
        }}
        onFocus={() => setShowTip(true)}
        onBlur={() => setShowTip(false)}
      >
        {label}
      </button>

      {/* Tooltip */}
      {showTip && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[180px] -translate-x-1/2 rounded-lg px-3 py-1.5 text-xs shadow-lg"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {desc}
          <div
            className="absolute left-1/2 top-full -translate-x-1/2"
            style={{
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid var(--border)',
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PresetBar({ currentFilters, onFilterChange, locale = 'zh' }: PresetBarProps) {
  const [expanded, setExpanded] = useState(false);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const defaultCount = isMobile ? MOBILE_DEFAULT : DESKTOP_DEFAULT;
  const visiblePresets = expanded ? PRESETS : PRESETS.slice(0, defaultCount);
  const hasMore = PRESETS.length > defaultCount;

  const handlePreset = (preset: Preset) => {
    onFilterChange({
      market: 'all',
      sort_by: 'change_pct',
      sort_dir: 'desc',
      page: 1,
      per_page: 50,
      ...preset.filters,
    });
  };

  const handleReset = () => {
    onFilterChange({
      market: 'all',
      sort_by: 'change_pct',
      sort_dir: 'desc',
      page: 1,
      per_page: 50,
    });
  };

  return (
    <div
      className="flex flex-col gap-2 pb-3"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {visiblePresets.map(preset => (
          <PresetButton
            key={preset.id}
            preset={preset}
            locale={locale}
            onClick={() => handlePreset(preset)}
          />
        ))}

        {hasMore && (
          <button
            onClick={() => setExpanded(prev => !prev)}
            className="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(139,143,168,0.08)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            {expanded ? '收起 ▲' : '更多策略 ▾'}
          </button>
        )}

        <button
          onClick={handleReset}
          className="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 whitespace-nowrap"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(139,143,168,0.08)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
          }}
        >
          清除篩選
        </button>
      </div>
    </div>
  );
}