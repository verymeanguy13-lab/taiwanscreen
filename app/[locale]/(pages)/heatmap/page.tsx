'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { HeatMap, changeToColor } from '@/components/heatmap/HeatMap';
import { Skeleton } from '@/components/ui/Skeleton';

// ── Types ─────────────────────────────────────────────────────────────────────
interface MarketSummary {
  up_count:     number;
  down_count:   number;
  flat_count:   number;
  total_volume: number;
}

interface HeatMapStock {
  symbol:     string;
  name_zh:    string;
  change_pct: number | null;
  volume:     number | null;
  market_cap: number | null;
}

interface SectorGroup {
  name:   string;
  stocks: HeatMapStock[];
}

interface HeatmapApiResponse {
  marketSummary: MarketSummary;
  sectors:       SectorGroup[];
}

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Color legend entries ──────────────────────────────────────────────────────
const LEGEND = [
  { label: '+5%以上', pct:  6  },
  { label: '+2~5%',  pct:  3  },
  { label: '0~2%',   pct:  1  },
  { label: '-2~0%',  pct: -1  },
  { label: '-2~5%',  pct: -3  },
  { label: '-5%以下', pct: -6  },
];

// ── Toggle button ─────────────────────────────────────────────────────────────
function ToggleGroup<T extends string>({
  options, value, onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex rounded overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 text-xs font-medium transition-colors duration-100"
          style={{
            backgroundColor: value === opt.value ? 'var(--accent-green)' : 'var(--bg-card)',
            color: value === opt.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HeatmapPage() {
  const [market,  setMarket]  = useState<'all' | 'TWSE' | 'TPEx'>('all');
  const [sizeBy,  setSizeBy]  = useState<'market_cap' | 'volume'>('market_cap');
  const [dims,    setDims]    = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDims({ w: Math.floor(width), h: Math.floor(height) });
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const apiUrl = `/api/heatmap?market=${market}&size_by=${sizeBy}`;
  const { data, isLoading } = useSWR<HeatmapApiResponse>(apiUrl, fetcher, {
    refreshInterval: 15 * 60 * 1000, // refresh every 15 min
  });

  const summary  = data?.marketSummary;
  const sectors  = data?.sectors ?? [];
  const totalVol = summary
    ? (summary.total_volume / 10_000).toFixed(1) + '萬張'
    : '—';

  return (
    <div
      className="flex flex-col"
      style={{
        backgroundColor: 'var(--bg-primary)',
        height: 'calc(100vh - 3.5rem)', // subtract navbar height
      }}
    >
      {/* ── Market summary bar ─────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span style={{ color: 'var(--accent-green)' }}>
          上漲：{summary?.up_count ?? '—'} 家
        </span>
        <span style={{ color: 'var(--accent-red)' }}>
          下跌：{summary?.down_count ?? '—'} 家
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          平盤：{summary?.flat_count ?? '—'} 家
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          成交量：{totalVol}
        </span>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 shrink-0">
        <ToggleGroup
          options={[
            { label: '全部', value: 'all'  },
            { label: '上市', value: 'TWSE' },
            { label: '上櫃', value: 'TPEx' },
          ]}
          value={market}
          onChange={setMarket}
        />
        <ToggleGroup
          options={[
            { label: '依市值',   value: 'market_cap' },
            { label: '依成交量', value: 'volume'     },
          ]}
          value={sizeBy}
          onChange={setSizeBy}
        />
        {isLoading && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            載入中…
          </span>
        )}
      </div>

      {/* ── Heatmap container ──────────────────────────────────────────── */}
      <div ref={containerRef} className="flex-1 overflow-hidden px-4">
        {isLoading || dims.w === 0 ? (
          <Skeleton className="h-full w-full rounded-lg" />
        ) : (
          <HeatMap
            sectors={sectors}
            sizeBy={sizeBy}
            containerWidth={dims.w}
            containerHeight={dims.h}
          />
        )}
      </div>

      {/* ── Color legend ───────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center justify-center gap-3 px-4 py-2 shrink-0 text-xs"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        {LEGEND.map(({ label, pct }) => (
          <span key={label} className="flex items-center gap-1">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: changeToColor(pct) }}
            />
            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
