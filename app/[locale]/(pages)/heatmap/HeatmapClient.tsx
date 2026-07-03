'use client';

import { useRef, useState, useEffect } from 'react';
import useSWR from 'swr';
import { HeatMap, type HeatMapSector } from '@/components/heatmap/HeatMap';
import { Skeleton }     from '@/components/ui/Skeleton';
import AdSlot           from '@/components/ads/AdSlot';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const MARKET_TABS = [
  { label: '全部',  value: 'all'  },
  { label: '上市',  value: 'TWSE' },
];

const SIZE_TABS = [
  { label: '市值', value: 'market_cap' },
  { label: '成交量', value: 'volume'   },
];

export default function HeatmapClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [market,  setMarket]  = useState('all');
  const [sizeBy,  setSizeBy]  = useState<'market_cap' | 'volume'>('market_cap');
  const [dims,    setDims]    = useState({ w: 0, h: 0 });

  const { data, isLoading } = useSWR(
    `/api/heatmap?market=${market}&size_by=${sizeBy}`,
    fetcher,
    { refreshInterval: 60_000 },
  );

  useEffect(() => {
    function measure() {
      if (!containerRef.current) return;
      const w = containerRef.current.offsetWidth;
      setDims({ w, h: Math.max(500, Math.round(w * 0.6)) });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const sectors: HeatMapSector[] = data?.sectors ?? [];
  const summary = data?.marketSummary;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-4">

        {/* Title */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            台股熱力圖
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            依產業分類顯示個股漲跌，點擊進入個股頁面
          </p>
        </div>

        {/* Market summary badges */}
        {summary && (
          <div className="flex gap-3 text-xs">
            <span className="rounded px-2 py-1" style={{ backgroundColor: 'rgba(255,77,109,0.12)', color: 'var(--accent-red)' }}>
              ▲ 上漲 {summary.up_count}
            </span>
            <span className="rounded px-2 py-1" style={{ backgroundColor: 'rgba(0,212,170,0.12)', color: 'var(--accent-green)' }}>
              ▼ 下跌 {summary.down_count}
            </span>
            <span className="rounded px-2 py-1" style={{ backgroundColor: 'rgba(139,143,168,0.12)', color: 'var(--text-secondary)' }}>
              — 平盤 {summary.flat_count}
            </span>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap gap-4 items-center">
          {/* Market filter */}
          <div className="flex gap-1">
            {MARKET_TABS.map(t => (
              <button
                key={t.value}
                onClick={() => setMarket(t.value)}
                className="rounded px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: market === t.value ? 'var(--accent-green)' : 'transparent',
                  color: market === t.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  border: `1px solid ${market === t.value ? 'var(--accent-green)' : 'var(--border)'}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Size by */}
          <div className="flex gap-1">
            {SIZE_TABS.map(t => (
              <button
                key={t.value}
                onClick={() => setSizeBy(t.value as 'market_cap' | 'volume')}
                className="rounded px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: sizeBy === t.value ? 'var(--accent-blue)' : 'transparent',
                  color: sizeBy === t.value ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${sizeBy === t.value ? 'var(--accent-blue)' : 'var(--border)'}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ad slot */}
        <div className="flex justify-center">
          <AdSlot size="leaderboard" slotId="heatmap-top" />
        </div>

        {/* Heatmap */}
        <div ref={containerRef} className="w-full rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
          {isLoading || dims.w === 0
            ? <Skeleton className="w-full" style={{ height: 500 }} />
            : sectors.length === 0
              ? (
                <div className="flex items-center justify-center h-64 text-sm"
                  style={{ color: 'var(--text-muted)' }}>
                  暫無資料
                </div>
              )
              : (
                <HeatMap
                  sectors={sectors}
                  sizeBy={sizeBy}
                  containerWidth={dims.w}
                  containerHeight={dims.h}
                />
              )
          }
        </div>

        {/* Color legend — Taiwan convention: red=up, green=down */}
        <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          {[
            { color: '#7B0000', label: '+5%以上' },
            { color: '#FF4D6D', label: '+2%~+5%' },
            { color: '#FF9AA2', label: '0%~+2%'  },
            { color: '#4DFFCC', label: '-2%~0%'  },
            { color: '#00D4AA', label: '-5%~-2%' },
            { color: '#005F46', label: '-5%以下' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
              <span>{label}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
