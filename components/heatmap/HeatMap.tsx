'use client';

import { useMemo, useState } from 'react';
import { squarify } from '@/lib/treemap';
import type { Bounds, LayoutRect } from '@/lib/treemap';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface HeatMapStockData {
  symbol:     string;
  name_zh:    string;
  change_pct: number | null;
  volume:     number | null;
  market_cap: number | null;
}

export interface HeatMapSector {
  name:   string;
  stocks: HeatMapStockData[];
}

interface HeatMapProps {
  sectors:         HeatMapSector[];
  sizeBy:          'market_cap' | 'volume';
  containerWidth:  number;
  containerHeight: number;
  containerRef?:   React.RefObject<HTMLDivElement>;
}

interface Tooltip {
  x: number;
  y: number;
  symbol: string;
  name_zh: string;
  change_pct: number;
}

// ── Color function ────────────────────────────────────────────────────────────
export function changeToColor(pct: number): string {
  if (pct >=  5) return '#005F46';
  if (pct >=  2) return '#00D4AA';
  if (pct >=  0) return '#4DFFCC';
  if (pct >= -2) return '#FF9AA2';
  if (pct >= -5) return '#FF4D6D';
  return '#7B0000';
}

function textColor(pct: number): string {
  if (pct >= 0 && pct < 2) return '#003322';
  return '#FFFFFF';
}

// ── Sector label height ───────────────────────────────────────────────────────
const LABEL_H  = 18;
const PADDING  = 2;

export function HeatMap({ sectors, sizeBy, containerWidth, containerHeight, containerRef }: HeatMapProps) {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const sectorLayouts = useMemo(() => {
    if (containerWidth <= 0 || containerHeight <= 0) return [];

    const sectorTotals = sectors.map(sec => ({
      ...sec,
      total: sec.stocks.reduce((s, st) => {
        const v = sizeBy === 'market_cap' ? (st.market_cap ?? 0) : (st.volume ?? 0);
        return s + Math.max(v, 0);
      }, 0),
    })).filter(s => s.total > 0);

    const grandTotal = sectorTotals.reduce((s, sec) => s + sec.total, 0);
    if (grandTotal === 0) return [];

    const sectorItems = sectorTotals.map(s => ({
      symbol:     s.name,
      name_zh:    s.name,
      change_pct: 0,
      value:      s.total,
    }));

    const outerBounds: Bounds = { x: 0, y: 0, w: containerWidth, h: containerHeight };
    const sectorRects = squarify(sectorItems, outerBounds);

    return sectorRects.map((sr, idx) => {
      const sector = sectorTotals[idx];
      if (!sector) return null;

      const stockBounds: Bounds = {
        x: sr.x + PADDING,
        y: sr.y + LABEL_H,
        w: Math.max(sr.w - PADDING * 2, 0),
        h: Math.max(sr.h - LABEL_H - PADDING, 0),
      };

      const stockItems = sector.stocks.map(st => ({
        symbol:     st.symbol,
        name_zh:    st.name_zh,
        change_pct: st.change_pct ?? 0,
        value:      Math.max(sizeBy === 'market_cap' ? (st.market_cap ?? 0) : (st.volume ?? 0), 0),
      }));

      const stockRects = squarify(stockItems, stockBounds);

      return { sectorRect: sr, sectorName: sector.name, stockRects };
    }).filter(Boolean) as {
      sectorRect: LayoutRect;
      sectorName: string;
      stockRects: LayoutRect[];
    }[];
  }, [sectors, sizeBy, containerWidth, containerHeight]);

  if (containerWidth <= 0 || containerHeight <= 0) return null;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: containerHeight }}>
      <svg
        width={containerWidth}
        height={containerHeight}
        style={{ display: 'block' }}
      >
        {sectorLayouts.map(({ sectorRect: sr, sectorName, stockRects }) => (
          <g key={sectorName}>
            {/* Sector background */}
            <rect
              x={sr.x} y={sr.y} width={sr.w} height={sr.h}
              fill="var(--bg-secondary)"
              stroke="var(--bg-primary)"
              strokeWidth={2}
            />
            {/* Sector label */}
            {sr.w > 40 && (
              <text
                x={sr.x + 6}
                y={sr.y + 13}
                fontSize={11}
                fill="var(--text-muted)"
                fontFamily="'Noto Sans TC', sans-serif"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >
                {sectorName}
              </text>
            )}

            {/* Stock rects */}
            {stockRects.map(rect => {
              const pct    = rect.change_pct ?? 0;
              const fill   = changeToColor(pct);
              const tColor = textColor(pct);
              const showSymbol = rect.w >= 35;
              const showPct    = rect.h >= 25;

              return (
                <g
                  key={rect.symbol}
                  style={{ cursor: 'pointer' }}
                  onClick={() => { window.location.href = `/stock/${rect.symbol}`; }}
                  onMouseMove={e => {
                    const svgEl = (e.currentTarget as SVGGElement).closest('svg');
                    const svgRect = svgEl?.getBoundingClientRect();
                    setTooltip({
                      x: e.clientX - (svgRect?.left ?? 0) + 12,
                      y: e.clientY - (svgRect?.top  ?? 0) - 10,
                      symbol:     rect.symbol,
                      name_zh:    rect.name_zh,
                      change_pct: pct,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <rect
                    x={rect.x + 1}
                    y={rect.y + 1}
                    width={Math.max(rect.w - 2, 0)}
                    height={Math.max(rect.h - 2, 0)}
                    fill={fill}
                    rx={2}
                  />
                  {showSymbol && (
                    <text
                      x={rect.x + rect.w / 2}
                      y={rect.y + rect.h / 2 - (showPct ? 7 : 0)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.min(12, rect.w / 4)}
                      fontWeight="600"
                      fill={tColor}
                      fontFamily="'IBM Plex Mono', monospace"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {rect.symbol}
                    </text>
                  )}
                  {showPct && (
                    <text
                      x={rect.x + rect.w / 2}
                      y={rect.y + rect.h / 2 + (showSymbol ? 10 : 0)}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={Math.min(11, rect.w / 5)}
                      fill={tColor}
                      fontFamily="'IBM Plex Mono', monospace"
                      style={{ userSelect: 'none', pointerEvents: 'none' }}
                    >
                      {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded px-2 py-1.5 text-xs shadow-lg"
          style={{
            left: tooltip.x,
            top:  tooltip.y,
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            maxWidth: 160,
          }}
        >
          <div className="font-semibold">{tooltip.symbol} {tooltip.name_zh}</div>
          <div style={{ color: changeToColor(tooltip.change_pct) }}>
            {tooltip.change_pct >= 0 ? '+' : ''}{tooltip.change_pct.toFixed(2)}%
          </div>
        </div>
      )}
    </div>
  );
}
