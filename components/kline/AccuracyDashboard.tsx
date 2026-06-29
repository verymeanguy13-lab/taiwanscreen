'use client';

// =============================================================================
// components/kline/AccuracyDashboard.tsx
// =============================================================================

import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { WinRateGauge }  from './WinRateGauge';
import { AccuracyChart } from './AccuracyChart';
import { SignalCard }    from './SignalCard';
import { Skeleton }      from '@/components/ui/Skeleton';
import type { SignalTypeStats, MonthlyWinRate, SignalResult } from '@/app/api/kline/accuracy/route';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const SIGNAL_TYPES = [
  '上漲趨勢突破', '箱型整理突破', '下跌V轉突破',
  '昨日強勢股', '開布林', '突破壓力', '剛轉多', '近五日強勢股',
];

const PERIOD_LABELS: Record<string, string> = {
  '5d': '5日報酬', '10d': '10日報酬', '20d': '20日報酬',
};

const WIN_FILTER_LABELS = ['全部', '僅看勝', '僅看敗'] as const;
type WinFilter = typeof WIN_FILTER_LABELS[number];

const CARD: React.CSSProperties = {
  backgroundColor: 'var(--bg-card)',
  border:          '1px solid var(--border)',
  borderRadius:    12,
  padding:         '16px 20px',
};

export function AccuracyDashboard() {
  const [period,       setPeriod]   = useState<'5d' | '10d' | '20d'>('5d');
  const [signalType,   setType]     = useState('all');
  const [winFilter,    setWinFilter]= useState<WinFilter>('全部');
  const [visibleCount, setVisible]  = useState(20);

  const url = `/api/kline/accuracy?period=${period}&signal_type=${encodeURIComponent(signalType)}&limit=200`;
  const { data, isLoading } = useSWR(url, fetcher, { revalidateOnFocus: false });

  const stats:         SignalTypeStats[] = data?.stats         ?? [];
  const monthlyTrend:  MonthlyWinRate[]  = data?.monthlyTrend  ?? [];
  const recentSignals: SignalResult[]    = data?.recentSignals ?? [];
  const summary = data?.summary ?? {
    totalSignals: 0, priceUpRate: 0, avgReturn: 0,
    bestSignalType: '—', dataStartDate: '—',
  };

  const statsMap = useMemo(() => {
    const m = new Map<string, SignalTypeStats>();
    for (const s of stats) m.set(s.signal_type, s);
    return m;
  }, [stats]);

  const filteredSignals = useMemo(() => {
    const upKey =
      period === '5d'  ? 'price_up_5d'  :
      period === '10d' ? 'price_up_10d' : 'price_up_20d';
    return recentSignals.filter(s => {
      if (winFilter === '僅看勝') return (s as any)[upKey] === true;
      if (winFilter === '僅看敗') return (s as any)[upKey] === false;
      return true;
    });
  }, [recentSignals, winFilter, period]);

  // Taiwan convention: high win rate = bullish = red, low = bearish = green
  const statColor = (v: number) =>
    v >= 60 ? 'var(--accent-red)' : v >= 50 ? 'var(--accent-gold)' : 'var(--accent-green)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── SECTION 1: Summary Banner ─────────────────────────────────────── */}
      <div style={CARD}>
        {isLoading ? (
          <div style={{ display: 'flex', gap: 16 }}>
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 flex-1" />)}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}
              className="sm:grid-cols-4">
              {[
                { label: '總訊號次數',        value: summary.totalSignals.toLocaleString(), color: 'var(--text-primary)' },
                { label: '技術條件後上漲比例', value: `${summary.priceUpRate}%`,             color: statColor(summary.priceUpRate) },
                { label: '平均報酬',          value: `${summary.avgReturn >= 0 ? '+' : ''}${summary.avgReturn}%`, color: summary.avgReturn >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' },
                { label: '最佳訊號類型',      value: summary.bestSignalType,                color: 'var(--accent-gold)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color }}>{value}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
              資料從 {summary.dataStartDate} 起，持續每日更新
            </p>
          </>
        )}
      </div>

      {/* ── SECTION 2: Gauge Grid ────────────────────────────────────────── */}
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
          各型態上漲比例
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }}
          className="sm:grid-cols-4">
          {SIGNAL_TYPES.map(type => {
            const s = statsMap.get(type);
            return (
              <WinRateGauge
                key={type}
                signalType={type}
                priceUpRate={s?.price_up_rate ?? 0}
                totalSignals={s?.total_signals ?? 0}
                isSelected={signalType === type}
                onClick={() => setType(signalType === type ? 'all' : type)}
              />
            );
          })}
        </div>
      </div>

      {/* ── SECTION 3: Chart ─────────────────────────────────────────────── */}
      <div style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            累計績效與月勝率
          </h2>
          <div style={{ display: 'flex', gap: 4 }}>
            {Object.entries(PERIOD_LABELS).map(([p, label]) => (
              <button key={p} onClick={() => setPeriod(p as any)}
                style={{
                  fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  backgroundColor: period === p ? 'var(--accent-red)' : 'transparent',
                  color:           period === p ? '#fff'              : 'var(--text-secondary)',
                  border: `1px solid ${period === p ? 'var(--accent-red)' : 'var(--border)'}`,
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {isLoading
          ? <Skeleton className="w-full h-64" />
          : <AccuracyChart signals={recentSignals} monthlyTrend={monthlyTrend} period={period} signalType={signalType} />
        }
      </div>

      {/* ── SECTION 4: Signal Log ─────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              歷史訊號紀錄
            </h2>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)',
            }}>
              {filteredSignals.length} 筆
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {WIN_FILTER_LABELS.map(f => (
              <button key={f} onClick={() => setWinFilter(f)}
                style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
                  backgroundColor: winFilter === f ? 'var(--accent-blue)' : 'transparent',
                  color:           winFilter === f ? '#fff'               : 'var(--text-secondary)',
                  border: `1px solid ${winFilter === f ? 'var(--accent-blue)' : 'var(--border)'}`,
                }}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : filteredSignals.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            尚無歷史資料（訊號需累積數週後才會顯示）
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredSignals.slice(0, visibleCount).map(s => (
                <SignalCard key={s.id} signal={s} period={period} />
              ))}
            </div>
            {visibleCount < filteredSignals.length && (
              <button
                onClick={() => setVisible(v => v + 20)}
                style={{
                  width: '100%', marginTop: 12, padding: '10px 0',
                  borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  backgroundColor: 'transparent', color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}>
                載入更多（還有 {filteredSignals.length - visibleCount} 筆）
              </button>
            )}
          </>
        )}
      </div>

      {/* ── SECTION 5: Disclaimer ─────────────────────────────────────────── */}
      <div style={{ ...CARD, backgroundColor: 'var(--bg-secondary)' }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.8, margin: 0 }}>
          以上統計為歷史技術型態出現後之價格走勢紀錄，不代表未來績效保證。<br />
          本平台所有訊號僅供參考，不構成投資建議。<br />
          投資一定有風險，請謹慎評估後自行判斷。
        </p>
      </div>
    </div>
  );
}
