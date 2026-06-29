'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface RevenueDataPoint {
  period: string;
  revenue: number;
  growth_yoy: number;
}

interface Props {
  data: RevenueDataPoint[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const revenue    = payload.find((p: any) => p.dataKey === 'revenue')?.value;
  const growth_yoy = payload.find((p: any) => p.dataKey === 'growth_yoy')?.value;
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
      {revenue != null && (
        <p>營收：<span className="num font-semibold">NT${(Number(revenue) / 1e8).toFixed(1)}億</span></p>
      )}
      {growth_yoy != null && growth_yoy !== 0 && (
        <p style={{ color: Number(growth_yoy) >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
          年增率：<span className="num font-semibold">{Number(growth_yoy) >= 0 ? '+' : ''}{Number(growth_yoy).toFixed(1)}%</span>
        </p>
      )}
    </div>
  );
}

export function RevenueChart({ data }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
        季度營收
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 4, right: 40, left: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
          />
          {/* Left Y axis — revenue in 億 */}
          <YAxis
            yAxisId="revenue"
            orientation="left"
            tickFormatter={v => `${(v / 1e8).toFixed(0)}億`}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          {/* Right Y axis — growth % */}
          <YAxis
            yAxisId="growth"
            orientation="right"
            tickFormatter={v => `${v}%`}
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine yAxisId="growth" y={0} stroke="var(--border)" strokeDasharray="3 3" />
          <Bar
            yAxisId="revenue"
            dataKey="revenue"
            fill="var(--accent-blue)"
            radius={[3, 3, 0, 0]}
            opacity={0.85}
          />
          {/* Taiwan convention: positive growth = bullish = red */}
          <Line
            yAxisId="growth"
            dataKey="growth_yoy"
            type="monotone"
            stroke="var(--accent-red)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--accent-red)' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
