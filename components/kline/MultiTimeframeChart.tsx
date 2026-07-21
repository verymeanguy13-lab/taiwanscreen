'use client';

// =============================================================================
// components/kline/MultiTimeframeChart.tsx
// Session 65 — 多週期走勢 (Multi-timeframe Trend View)
//
// Split panel: daily chart on top (60%, reuses the existing CandlestickChart
// — now with weekly-derived support/resistance overlaid via extraLevels),
// a new lightweight weekly/monthly candlestick on the bottom (40%), a 月線
// toggle to switch the bottom panel, and a trend badge on each panel.
//
// Self-contained collapsible section (title + expand/collapse), so the stock
// detail page only needs one line added — no separate wiring for the
// collapse behavior itself.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { CandlestickChart } from './CandlestickChart';
import type { TimeframeData, Trend } from '@/lib/multiTimeframe';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const BORDER   = '#1E2235';
const CHART_BG = '#08090E';
const UP       = '#FF4D6D';   // Taiwan convention: red = up
const DOWN     = '#00D4AA';   // green = down
const NEUTRAL  = '#8B8FA8';

const TREND_LABEL: Record<Trend, string> = {
  strong_up:   '強勢多頭',
  up:          '偏多',
  neutral:     '中性',
  down:        '偏空',
  strong_down: '強勢空頭',
};

function trendColor(trend: Trend): string {
  if (trend === 'strong_up' || trend === 'up') return UP;
  if (trend === 'strong_down' || trend === 'down') return DOWN;
  return NEUTRAL;
}

function TrendBadge({ label, trend }: { label: string; trend: Trend }) {
  const color = trendColor(trend);
  return (
    <span
      style={{
        position: 'absolute', top: 8, right: 8, zIndex: 5,
        fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
        backgroundColor: `${color}22`, color,
      }}
    >
      {label}{TREND_LABEL[trend]}
    </span>
  );
}

// ── Lightweight bottom panel: weekly or monthly candles only ────────────────
function SimpleCandlePanel({ tf, height }: { tf: TimeframeData; height: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || tf.candles.length === 0) return;
    let chart: { remove: () => void } | null = null;

    import('lightweight-charts').then((lc) => {
      const c = lc.createChart(ref.current!, {
        width: ref.current!.clientWidth,
        height,
        layout: { background: { color: CHART_BG }, textColor: NEUTRAL, fontSize: 10 },
        grid: { vertLines: { color: BORDER }, horzLines: { color: BORDER } },
        rightPriceScale: { borderColor: BORDER },
        timeScale: { borderColor: BORDER, timeVisible: false },
        crosshair: { mode: lc.CrosshairMode.Normal },
      });
      chart = c;

      const series = c.addSeries(lc.CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderVisible: false,
        wickUpColor: UP, wickDownColor: DOWN,
      });
      series.setData(tf.candles.map(cd => ({
        time: cd.date as string, open: cd.open, high: cd.high, low: cd.low, close: cd.close,
      })));

      // Same-style dashed key-level lines as the daily chart, for visual consistency
      for (const lvl of tf.keyLevels) {
        const color = lvl.type === 'resistance' ? `${UP}50` : `${DOWN}50`;
        c.addSeries(lc.LineSeries, { color, lineWidth: 1, lineStyle: lc.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
          .setData([
            { time: tf.candles[0].date as string, value: lvl.price },
            { time: tf.candles[tf.candles.length - 1].date as string, value: lvl.price },
          ]);
      }

      c.timeScale().fitContent();
    });

    return () => { chart?.remove(); };
  }, [tf, height]);

  return <div ref={ref} style={{ width: '100%', height }} />;
}

export function MultiTimeframeChart({ symbol }: { symbol: string }) {
  const { data } = useSWR<{ data: TimeframeData[] }>(
    `/api/multi-timeframe/${symbol}`, fetcher, { revalidateOnFocus: false },
  );

  const [bottomTf, setBottomTf] = useState<'weekly' | 'monthly'>('weekly');
  const [expanded, setExpanded] = useState(true);

  // Default collapsed on mobile, expanded on desktop, per spec.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) {
      setExpanded(false);
    }
  }, []);

  const timeframes = data?.data ?? [];
  const daily   = timeframes.find(t => t.timeframe === 'daily');
  const weekly  = timeframes.find(t => t.timeframe === 'weekly');
  const monthly = timeframes.find(t => t.timeframe === 'monthly');
  const bottom  = bottomTf === 'weekly' ? weekly : monthly;

  const dailyExtraLevels = weekly?.keyLevels.map(l => ({ price: l.price, type: l.type })) ?? [];

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', backgroundColor: '#141720', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>多週期走勢</span>
        <span style={{ color: NEUTRAL, fontSize: 12 }}>{expanded ? '收合 ▲' : '展開 ▼'}</span>
      </button>

      {expanded && (
        <div>
          {/* ── Daily panel (60%) — reuses existing CandlestickChart ────── */}
          <div style={{ position: 'relative' }}>
            {daily && <TrendBadge label="日線" trend={daily.trend} />}
            <CandlestickChart symbol={symbol} extraLevels={dailyExtraLevels} />
          </div>

          {/* ── Weekly/Monthly panel (40%) ───────────────────────────────── */}
          <div style={{ borderTop: `1px solid ${BORDER}`, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['weekly', 'monthly'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setBottomTf(k)}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      backgroundColor: bottomTf === k ? '#3D8EF8' : 'transparent',
                      color: bottomTf === k ? '#08090E' : NEUTRAL,
                    }}
                  >
                    {k === 'weekly' ? '週線' : '月線'}
                  </button>
                ))}
              </div>
              {bottom && (
                <span style={{ fontSize: 11, fontWeight: 700, color: trendColor(bottom.trend) }}>
                  {bottomTf === 'weekly' ? '週線' : '月線'}{TREND_LABEL[bottom.trend]}
                </span>
              )}
            </div>
            {bottom
              ? <SimpleCandlePanel tf={bottom} height={220} />
              : <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: NEUTRAL, fontSize: 12 }}>載入中…</div>
            }
          </div>
        </div>
      )}
    </div>
  );
}
