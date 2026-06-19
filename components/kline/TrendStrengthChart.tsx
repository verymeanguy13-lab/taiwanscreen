'use client';

import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { IntradaySignalEvent } from '@/lib/bullbearSignals';
import { computeTrendStrength } from '@/lib/bullbearSignals';

interface Props {
  signals:   IntradaySignalEvent[];
  isLoading: boolean;
}

const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';

export function TrendStrengthChart({ signals, isLoading }: Props) {
  const trend = computeTrendStrength(signals);

  const dominantColor =
    trend.dominantSide === 'bull' ? UP_COLOR :
    trend.dominantSide === 'bear' ? DOWN_COLOR : '#8B8FA8';

  const dominantLabel =
    trend.dominantSide === 'bull' ? '多方主導' :
    trend.dominantSide === 'bear' ? '空方主導' : '多空均衡';

  if (isLoading) {
    return (
      <div style={{
        height: 120, background: '#08090E', borderRadius: 6,
        border: '1px solid #1E2235', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: '#8B8FA8', fontSize: 12,
      }}>
        掃描中...
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div style={{
        height: 120, background: '#08090E', borderRadius: 6,
        border: '1px solid #1E2235', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: '#8B8FA8', fontSize: 12,
      }}>
        尚無訊號
      </div>
    );
  }

  return (
    <div style={{ background: '#08090E', borderRadius: 6, border: '1px solid #1E2235', padding: '8px 12px' }}>
      {/* Summary row */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 6, fontSize: 11 }}>
        <span style={{ color: UP_COLOR }}>多方 {trend.bullScore}</span>
        <span style={{ color: DOWN_COLOR }}>空方 {trend.bearScore}</span>
        <span style={{
          padding: '1px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700,
          color: dominantColor, background: `${dominantColor}22`,
          border: `1px solid ${dominantColor}44`,
        }}>
          {dominantLabel}
        </span>
      </div>

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={trend.bars} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis dataKey="time" tick={{ fill: '#8B8FA8', fontSize: 9 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#8B8FA8', fontSize: 9 }} axisLine={false} tickLine={false} />
          <ReferenceLine y={0} stroke="#1E2235" />
          <Bar dataKey="value" radius={[2, 2, 0, 0]}>
            {trend.bars.map((entry, i) => (
              <Cell key={i} fill={entry.value >= 0 ? UP_COLOR : DOWN_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}