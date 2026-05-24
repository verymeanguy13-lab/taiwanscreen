'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

// ── Constants ─────────────────────────────────────────────────────────────────
const BROKER_COLORS = [
  'var(--accent-blue)',
  'var(--accent-orange)',
  'var(--accent-green)',
  'var(--accent-purple)',
  'var(--accent-gold)',
];

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  data:    Record<string, string | number>[];
  brokers: string[];
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)',
        minWidth: 160,
      }}
    >
      <p className="mb-1.5 font-semibold" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.stroke }}>{p.dataKey}</span>
          <span
            className="num font-semibold"
            style={{ color: p.value >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}
          >
            {p.value >= 0 ? '+' : ''}{Number(p.value).toLocaleString()} 張
          </span>
        </p>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function BrokerTimelineChart({ data, brokers }: Props) {
  if (!data.length || !brokers.length) {
    return (
      <div className="flex h-[260px] items-center justify-center text-xs"
        style={{ color: 'var(--text-muted)' }}>
        暫無券商資料
      </div>
    );
  }

  // Compute cumulative net per broker to decide solid vs dashed
  const cumulativeNet: Record<string, number> = {};
  for (const broker of brokers) {
    cumulativeNet[broker] = data.reduce((sum, row) => {
      const v = row[broker];
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          interval={4} // show every 5th label
          tickFormatter={v => typeof v === 'string' ? v.slice(5) : v} // show MM-DD
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={v => `${(v / 1000).toFixed(0)}K`}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
        <Legend
          formatter={(value) => (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{value}</span>
          )}
        />
        {brokers.map((broker, i) => (
          <Line
            key={broker}
            type="monotone"
            dataKey={broker}
            stroke={BROKER_COLORS[i % BROKER_COLORS.length]}
            strokeWidth={2}
            strokeDasharray={cumulativeNet[broker] < 0 ? '5 3' : undefined}
            dot={false}
            connectNulls
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
