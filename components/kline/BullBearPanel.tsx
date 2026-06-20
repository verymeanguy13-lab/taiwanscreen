'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ScoreGauge }         from './ScoreGauge';
import { TrendStrengthChart } from './TrendStrengthChart';
import { Skeleton }           from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const BORDER   = '#1E2235';
const UP_COLOR = '#FF4D6D';
const DN_COLOR = '#00D4AA';



type Period = 30 | 60 | 90;

function sma(arr: number[], period: number): (number | null)[] {
  return arr.map((_, i) => {
    if (i < period - 1) return null;
    return arr.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
  });
}

export function BullBearPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useSWR(`/api/kline/${symbol}`, fetcher, {
    revalidateOnFocus: false,
  });

  const [period, setPeriod] = useState<Period>(60);
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  if (isLoading) return <Skeleton style={{ height: 400, borderRadius: 8 }} />;
  if (error || !data) return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B8FA8', fontSize: 13 }}>
      ?��?載入資�?
    </div>
  );

  const score      = data.score;
  const candles    = data.candles ?? [];
  const indicators = data.indicators ?? {};
  const afterHours = data.afterHours ?? { bullStrategies: [], bearStrategies: [], bullScore: 0, bearScore: 0 };

  // ?�?� S5: 60-day bull/bear chart data ?�?�
  const sliced    = candles.slice(-period);
  const closes    = sliced.map((c: any) => c.close);
  const volumes   = sliced.map((c: any) => c.volume ?? 0);
  const sma5arr   = sma(closes, 5);
  const sma20arr  = sma(closes, 20);
  const rsi14     = indicators.rsi14 ?? [];
  const rsiSliced = rsi14.slice(-period);
  const avgVol    = volumes.reduce((s: number, v: number) => s + v, 0) / (volumes.length || 1);

  const chartData = sliced.map((c: any, i: number) => {
    const price  = c.close;
    const ma5    = sma5arr[i];
    const ma20   = sma20arr[i];
    const rsi    = rsiSliced[i];
    const volR   = avgVol > 0 ? volumes[i] / avgVol : 0;
    const bullScore =
      (ma5  !== null && price > ma5  ? 25 : 0) +
      (ma20 !== null && price > ma20 ? 25 : 0) +
      (rsi  !== null && rsi   > 50   ? 25 : 0) +
      (volR > 1                      ? 25 : 0);
    return {
      date:      c.date?.slice(5) ?? '',
      bullScore,
      bearScore: 100 - bullScore,
    };
  });

 const DIMENSIONS = [
  { key: 'trend',     label: '趨勢' },
  { key: 'momentum',  label: '動能' },
  { key: 'volume',    label: '量能' },
  { key: 'chips',     label: '籌碼' },
  { key: 'pattern',   label: '型態' },
  { key: 'sentiment', label: '情緒' },
];

  const readingColor =
    score?.overall >= 75 ? DN_COLOR :
    score?.overall >= 50 ? '#7BCF72' :
    score?.overall >= 25 ? '#F5B700' : UP_COLOR;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* S1: Gauge + reading chip */}
      <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16, textAlign: 'center' }}>
        {score ? (
          <>
            <ScoreGauge score={score.overall ?? 0} />
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 700,
                color: readingColor, background: `${readingColor}22`,
                border: `1px solid ${readingColor}44`,
              }}>
                {score.technicalReading}
              </span>
              <span style={{ fontSize: 11, color: '#8B8FA8', alignSelf: 'center' }}>
                綜�?評�? {score.overall}/100
              </span>
            </div>
          </>
        ) : (
          <div style={{ color: '#8B8FA8', fontSize: 13, padding: 24 }}>?�無評�?資�?</div>
        )}
      </div>

      {/* S2: 6 dimension cards */}
      {score?.dimensions && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {DIMENSIONS.map(({ key, label }) => {
            const dim = score.dimensions[key];
            if (!dim) return null;
            const barColor = dim.score > 65 ? DN_COLOR : dim.score > 40 ? '#F5B700' : UP_COLOR;
            const isOpen   = expandedDim === key;
            return (
              <div
                key={key}
                onClick={() => setExpandedDim(isOpen ? null : key)}
                style={{
                  background: '#0F1117', border: `1px solid ${BORDER}`,
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{label}</span>
                  <span style={{ fontSize: 11, color: barColor, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700 }}>
                    {dim.score}
                  </span>
                </div>
                <div style={{ height: 4, background: BORDER, borderRadius: 2, marginBottom: isOpen ? 8 : 0 }}>
                  <div style={{
                    height: '100%', width: `${dim.score}%`,
                    background: barColor, borderRadius: 2, transition: 'width 0.5s ease',
                  }} />
                </div>
                {isOpen && (
                  <div style={{ fontSize: 10, color: '#8B8FA8', lineHeight: 1.5, marginTop: 4 }}>
                    {dim.reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* S3: Trend strength chart */}
      <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>趨勢?��?</div>
        <TrendStrengthChart signals={[]} isLoading={false} />
        <div style={{ fontSize: 11, color: '#8B8FA8', textAlign: 'center', marginTop: 6 }}>
          ?�中訊�?將於?�盤後顯�?        </div>
      </div>

      {/* S5: 60-day bull/bear chart */}
      <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>多空強度走勢</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {([30, 60, 90] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${period === p ? DN_COLOR : BORDER}`,
                background: period === p ? `${DN_COLOR}22` : 'transparent',
                color: period === p ? DN_COLOR : '#8B8FA8',
              }}>
                {p}�?              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" tick={{ fill: '#8B8FA8', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#8B8FA8', fontSize: 9 }} axisLine={false} tickLine={false} domain={[0, 100]} />
            <Tooltip
              contentStyle={{ background: '#0F1117', border: `1px solid ${BORDER}`, fontSize: 11 }}
              labelStyle={{ color: '#8B8FA8' }}
            />
            <Area type="monotone" dataKey="bullScore" stroke={UP_COLOR} fill={`${UP_COLOR}22`} strokeWidth={1.5} name="多方" dot={false} />
            <Area type="monotone" dataKey="bearScore" stroke={DN_COLOR} fill={`${DN_COLOR}22`} strokeWidth={1.5} name="空方" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
