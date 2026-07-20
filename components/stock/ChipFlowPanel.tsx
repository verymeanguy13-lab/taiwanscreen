'use client';

// =============================================================================
// components/stock/ChipFlowPanel.tsx
// Session 63 — 盤中籌碼動向 (Intraday Chip Flow)
//
// Shown below the main chart on the stock detail page.
//   A) Dual area chart — bigPlayerFlow (blue) vs retailFlow (orange),
//      matching --accent-blue / --accent-orange from the design system.
//   B) CSS-only dominance gauge — horizontal bar, retail (orange, left) to
//      big player (blue, right), current % marked.
//
// Colors here are intentionally NOT the site's red=buy/green=sell convention
// (used for institutional_flows and large-orders) — this chart answers a
// different question ("whose money"), not "buy vs sell", so it uses the
// design system's blue/orange accents instead, per spec.
// =============================================================================

import useSWR from 'swr';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Skeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const BIG_PLAYER_COLOR = '#3D8EF8'; // var(--accent-blue)
const RETAIL_COLOR     = '#FF8C42'; // var(--accent-orange)
const BORDER           = '#1E2235'; // var(--border)

interface ChipFlowSnapshot {
  time: string;
  bigPlayerFlow: number;
  retailFlow: number;
  price: number;
  volume: number;
  cumulativeBigPlayer: number;
  cumulativeRetail: number;
}

interface ChipFlowSummary {
  bigPlayerNetLots: number;
  retailNetLots: number;
  bigPlayerDominance: number;
  signal: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
}

interface ChipFlowResponse {
  symbol: string;
  marketOpen: boolean;
  snapshots: ChipFlowSnapshot[];
  summary: ChipFlowSummary;
}

const SIGNAL_LABEL: Record<ChipFlowSummary['signal'], string> = {
  strong_buy:  '主力強勢買入',
  buy:         '主力小幅買入',
  neutral:     '中性',
  sell:        '散戶賣壓',
  strong_sell: '散戶恐慌',
};

const SIGNAL_COLOR: Record<ChipFlowSummary['signal'], string> = {
  strong_buy:  BIG_PLAYER_COLOR,
  buy:         BIG_PLAYER_COLOR,
  neutral:     '#8B8FA8', // var(--text-secondary)
  sell:        RETAIL_COLOR,
  strong_sell: RETAIL_COLOR,
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        backgroundColor: '#141720',
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 12,
      }}
    >
      <p style={{ color: '#8B8FA8', marginBottom: 4 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey === 'bigPlayerFlow' ? '主力' : '散戶'}：
          {p.value > 0 ? '+' : ''}{p.value.toLocaleString()} 張
        </p>
      ))}
    </div>
  );
}

function DominanceGauge({ dominance, signal }: { dominance: number; signal: ChipFlowSummary['signal'] }) {
  return (
    <div>
      <div
        style={{
          position: 'relative',
          height: 10,
          borderRadius: 5,
          overflow: 'hidden',
          background: `linear-gradient(to right, ${RETAIL_COLOR}, ${BIG_PLAYER_COLOR})`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -3,
            left: `calc(${dominance}% - 2px)`,
            width: 4,
            height: 16,
            borderRadius: 2,
            backgroundColor: '#F0F0F0',
            boxShadow: '0 0 4px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#8B8FA8' }}>
        <span>散戶</span>
        <span style={{ color: '#F0F0F0', fontWeight: 600 }}>主力佔比 {dominance}%</span>
        <span>主力</span>
      </div>
      <p className="num" style={{ marginTop: 8, textAlign: 'center', fontSize: 13, fontWeight: 700, color: SIGNAL_COLOR[signal] }}>
        {SIGNAL_LABEL[signal]}
      </p>
    </div>
  );
}

export function ChipFlowPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useSWR<ChipFlowResponse>(
    `/api/chip-flow/${symbol}`,
    fetcher,
    { refreshInterval: 60 * 1000, revalidateOnFocus: false },
  );

  if (isLoading) return <Skeleton style={{ height: 260, borderRadius: 8 }} />;

  if (error || !data) {
    return (
      <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B8FA8', fontSize: 13 }}>
        無法載入籌碼動向資料
      </div>
    );
  }

  const { marketOpen, snapshots, summary } = data;

  return (
    <div
      style={{
        backgroundColor: '#141720',
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#F0F0F0' }}>
          盤中籌碼動向
        </h3>
        {!marketOpen && (
          <span style={{ fontSize: 11, color: '#8B8FA8', backgroundColor: 'rgba(139,143,168,0.15)', padding: '2px 8px', borderRadius: 4 }}>
            市場收盤 · 上一交易日資料
          </span>
        )}
      </div>

      {snapshots.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 13, color: '#8B8FA8' }}>
          今日尚無盤中資料
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={snapshots} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: '#4A4F6A' }}
                interval="preserveStartEnd"
                axisLine={{ stroke: BORDER }}
                tickLine={false}
              />
              <YAxis tick={{ fontSize: 10, fill: '#4A4F6A' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="bigPlayerFlow"
                stroke={BIG_PLAYER_COLOR}
                fill={`${BIG_PLAYER_COLOR}33`}
                strokeWidth={1.5}
                name="主力"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="retailFlow"
                stroke={RETAIL_COLOR}
                fill={`${RETAIL_COLOR}33`}
                strokeWidth={1.5}
                name="散戶"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${BORDER}` }}>
            <DominanceGauge dominance={summary.bigPlayerDominance} signal={summary.signal} />
          </div>

          <div style={{ display: 'flex', gap: 24, marginTop: 12, fontSize: 12 }}>
            <span style={{ color: '#8B8FA8' }}>
              主力淨額：
              <span className="num" style={{ color: BIG_PLAYER_COLOR, fontWeight: 600 }}>
                {summary.bigPlayerNetLots > 0 ? '+' : ''}{summary.bigPlayerNetLots.toLocaleString()} 張
              </span>
            </span>
            <span style={{ color: '#8B8FA8' }}>
              散戶淨額：
              <span className="num" style={{ color: RETAIL_COLOR, fontWeight: 600 }}>
                {summary.retailNetLots > 0 ? '+' : ''}{summary.retailNetLots.toLocaleString()} 張
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
