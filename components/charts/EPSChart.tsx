'use client';

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface EPSDataPoint {
  period: string;
  eps: number;
}

interface Props {
  data: EPSDataPoint[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const eps = payload[0]?.value ?? 0;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)',
      }}
    >
      <p className="mb-1 font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <p style={{ color: eps >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
        EPS：<span className="num font-semibold">NT${eps.toFixed(2)}</span>
      </p>
    </div>
  );
}

export function EPSChart({ data }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
        每股盈餘 (EPS)
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={v => `${v}`}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
          <Bar dataKey="eps" radius={[3, 3, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.eps >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}
                opacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
