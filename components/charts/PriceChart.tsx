'use client';

import { useMemo, useState } from 'react';
import {
  ComposedChart, Line, Bar,
  XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { subDays, subMonths, parseISO, isAfter } from 'date-fns';

interface PricePoint {
  date:   string;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

interface PriceChartProps {
  data: PricePoint[];
}

type Range = '1W' | '1M' | '3M' | '6M' | '1Y';

const RANGES: { label: string; key: Range }[] = [
  { label: '1週', key: '1W' },
  { label: '1月', key: '1M' },
  { label: '3月', key: '3M' },
  { label: '6月', key: '6M' },
  { label: '1年', key: '1Y' },
];

function getCutoff(range: Range): Date {
  const now = new Date();
  switch (range) {
    case '1W': return subDays(now, 7);
    case '1M': return subMonths(now, 1);
    case '3M': return subMonths(now, 3);
    case '6M': return subMonths(now, 6);
    case '1Y': return subMonths(now, 12);
  }
}

// How often to show an x-axis tick based on range
function tickInterval(range: Range, total: number): number {
  if (range === '1W') return 1;
  if (range === '1M') return Math.max(1, Math.floor(total / 6));
  if (range === '3M') return Math.max(1, Math.floor(total / 8));
  if (range === '6M') return Math.max(1, Math.floor(total / 8));
  return Math.max(1, Math.floor(total / 10));
}

function formatDate(dateStr: string, range: Range): string {
  const d = parseISO(dateStr);
  if (range === '1Y' || range === '6M') {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const close  = payload.find(p => p.dataKey === 'close')?.value;
  const volume = payload.find(p => p.dataKey === 'volume')?.value;
  return (
    <div
      className="rounded px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)',
      }}
    >
      <div style={{ color: 'var(--text-muted)' }} className="mb-1">{label}</div>
      <div>
        收盤：
        <span className="num font-semibold" style={{ color: 'var(--accent-green)' }}>
          NT${Number(close ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div>
        成交量：
        <span className="num" style={{ color: 'var(--accent-blue)' }}>
          {Number(volume ?? 0).toLocaleString('en-US')} 張
        </span>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function PriceChart({ data }: PriceChartProps) {
  const [range, setRange] = useState<Range>('3M');

  const filtered = useMemo(() => {
    const cutoff = getCutoff(range);
    return data.filter(d => isAfter(parseISO(d.date), cutoff));
  }, [data, range]);

  const interval = tickInterval(range, filtered.length);

  const tickFormatter = (val: string, index: number) =>
    index % interval === 0 ? formatDate(val, range) : '';

  const yMin = useMemo(() => {
    if (!filtered.length) return 'auto';
    const min = Math.min(...filtered.map(d => d.close));
    return Math.floor(min * 0.97);
  }, [filtered]);

  const yMax = useMemo(() => {
    if (!filtered.length) return 'auto';
    const max = Math.max(...filtered.map(d => d.close));
    return Math.ceil(max * 1.03);
  }, [filtered]);

  return (
    <div
      className="rounded-lg p-4"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}
    >
      {/* Range selector */}
      <div className="mb-4 flex items-center gap-1">
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className="rounded px-3 py-1 text-xs font-medium transition-colors duration-100"
            style={{
              backgroundColor: range === r.key ? 'var(--accent-green)' : 'transparent',
              color: range === r.key ? 'var(--bg-primary)' : 'var(--text-secondary)',
              border: range === r.key ? 'none' : '1px solid var(--border)',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Price chart */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={filtered} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={tickFormatter}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={v => v.toLocaleString('en-US')}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="close"
            stroke="var(--accent-green)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: 'var(--accent-green)' }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Volume chart */}
      <ResponsiveContainer width="100%" height={70}>
        <ComposedChart data={filtered} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis
            tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={56}
            tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(0)}萬` : String(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            dataKey="volume"
            fill="var(--accent-blue)"
            opacity={0.6}
            radius={[1, 1, 0, 0]}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
