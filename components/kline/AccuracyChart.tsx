'use client';

// =============================================================================
// components/kline/AccuracyChart.tsx
// =============================================================================

import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ReferenceLine,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { SignalResult, MonthlyWinRate } from '@/app/api/kline/accuracy/route';

interface AccuracyChartProps {
  signals:      SignalResult[];
  monthlyTrend: MonthlyWinRate[];
  period:       '5d' | '10d' | '20d';
  signalType:   string;
}

function getReturn(s: SignalResult, period: '5d' | '10d' | '20d'): number | null {
  if (period === '5d')  return s.return_5d;
  if (period === '10d') return s.return_10d;
  return s.return_20d;
}

export function AccuracyChart({ signals, monthlyTrend, period, signalType }: AccuracyChartProps) {
  const AXIS_STYLE = { fill: 'var(--text-muted)', fontSize: 11 };
  const GRID_COLOR = 'var(--border)';

  // ── Average return over time ──────────────────────────────────────────────
  const sorted = [...signals]
    .filter(s => getReturn(s, period) !== null)
    .sort((a, b) => a.signal_date.localeCompare(b.signal_date));

  let runningSum = 0;
  const cumulData = sorted.map((s, i) => {
    runningSum += getReturn(s, period) ?? 0;
    return {
      date:       String(s.signal_date).slice(0, 10),
      cumulative: Math.round((runningSum / (i + 1)) * 100) / 100,
    };
  });

  const finalReturn = cumulData[cumulData.length - 1]?.cumulative ?? 0;
  const lineColor   = finalReturn >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  // ── Monthly win rate ──────────────────────────────────────────────────────
  const monthlyFiltered = signalType === 'all'
    ? monthlyTrend
    : monthlyTrend.filter(m => m.signal_type === signalType);

  const monthMap = new Map<string, { total: number; up: number }>();
  for (const m of monthlyFiltered) {
    const e = monthMap.get(m.month) ?? { total: 0, up: 0 };
    monthMap.set(m.month, { total: e.total + m.total, up: e.up + m.price_up_count });
  }

  const monthlyData = [...monthMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, { total, up }]) => ({
      month: month.slice(5),
      rate:  total > 0 ? Math.round((up / total) * 1000) / 10 : 0,
      total,
      up,
    }));

  if (cumulData.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        尚無足夠歷史資料（需等待訊號累積後顯示）
      </div>
    );
  }

  // Deduplicate by date for X-axis (250 signals but only ~10 unique dates)
  const dateData = Array.from(
    cumulData.reduce((map, row) => {
      map.set(row.date, row);
      return map;
    }, new Map<string, typeof cumulData[0]>()).values()
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* TOP — Average return over time */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            平均報酬走勢
          </span>
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: finalReturn >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
            padding: '2px 10px', borderRadius: 8,
            backgroundColor: finalReturn >= 0 ? 'rgba(0,212,170,0.12)' : 'rgba(255,77,109,0.12)',
          }}>
            {finalReturn >= 0 ? '+' : ''}{finalReturn.toFixed(2)}%
          </span>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={dateData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={lineColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0}   />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis
              dataKey="date"
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => v.slice(5)}
              interval={Math.max(0, Math.floor(dateData.length / 6) - 1)}
            />
            <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false}
              tickFormatter={v => `${v}%`} width={48} />
            <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="4 4" />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: unknown) => { const n = Number(v); return [`${n >= 0 ? '+' : ''}${n.toFixed(2)}%`, '平均報酬']; }}
            />
            <Area type="monotone" dataKey="cumulative"
              stroke={lineColor} strokeWidth={2}
              fill="url(#cumGrad)"
              dot={false} activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* BOTTOM — Monthly win rate */}
      {monthlyData.length > 0 && (
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: 8 }}>
            月勝率統計
          </span>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" tick={AXIS_STYLE} tickLine={false} axisLine={false}
                tickFormatter={v => `${v}月`} />
              <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false}
                tickFormatter={v => `${v}%`} width={38} domain={[0, 100]} />
              <ReferenceLine y={50} stroke="var(--accent-gold)" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                formatter={(_: unknown, __: unknown, props: any) => {
                  const { up, total, rate } = props.payload;
                  return [`${up}次上漲 / ${total}次 = ${rate}%`, '勝率'];
                }}
              />
              <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill="var(--accent-green)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}