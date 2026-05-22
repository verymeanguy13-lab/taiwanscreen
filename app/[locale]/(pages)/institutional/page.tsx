'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, TooltipProps,
} from 'recharts';
import { Tabs }     from '@/components/ui/Tabs';
import { Badge }    from '@/components/ui/Badge';
import { Card }     from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatNTD, formatChange } from '@/lib/utils';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

function useInstitutional(mode: string, extra = '') {
  return useSWR(`/api/institutional?mode=${mode}${extra}`, fetcher, { keepPreviousData: true });
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SummaryRow {
  date:           string;
  total_foreign:  string | number;
  total_trust:    string | number;
  total_dealer:   string | number;
}

interface FlowRow {
  symbol:                   string;
  name_zh:                  string;
  sector:                   string;
  foreign_net:              number | null;
  trust_net:                number | null;
  dealer_net:               number | null;
  total_net:                number | null;
  foreign_buy:              number | null;
  foreign_sell:             number | null;
  trust_buy:                number | null;
  trust_sell:               number | null;
  foreign_consecutive_days: number | null;
  trust_consecutive_days:   number | null;
  triple_buy_streak:        number | null;
  close:                    number | null;
  change_pct:               number | null;
  period_return_pct:        number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const n = (v: unknown) => Number(v ?? 0);

function fmtNet(v: number | null | undefined, unit = '張'): string {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US');
  return `${v >= 0 ? '+' : '-'}${abs}${unit ? ' ' + unit : ''}`;
}

function NetCell({ v }: { v: number | null | undefined }) {
  const val = n(v);
  return (
    <span className="num font-semibold" style={{ color: val >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
      {fmtNet(val)}
    </span>
  );
}

// ── Trend chart tooltip ───────────────────────────────────────────────────────
function TrendTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      <div className="mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.stroke }}>{p.name}</span>
          <span className="num">{formatNTD(n(p.value) * 1000)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Clickable row ─────────────────────────────────────────────────────────────
function FlowTable({
  rows,
  columns,
  isLoading,
}: {
  rows: FlowRow[];
  columns: { label: string; render: (r: FlowRow, i: number) => React.ReactNode }[];
  isLoading: boolean;
}) {
  const router = useRouter();
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ minWidth: 360 }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
            {columns.map(c => (
              <th key={c.label} className="px-3 py-2 text-left font-semibold"
                style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-6 text-center"
              style={{ color: 'var(--text-muted)' }}>暫無資料</td></tr>
          )}
          {rows.map((row, idx) => (
            <tr key={row.symbol}
              className="cursor-pointer transition-colors duration-100"
              onClick={() => router.push(`/stock/${row.symbol}`)}
              style={{
                backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'; }}
            >
              {columns.map(c => (
                <td key={c.label} className="px-3 py-2" style={{ whiteSpace: 'nowrap' }}>
                  {c.render(row, idx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const MAIN_TABS = [
  { label: '外資動向',   value: 'foreign'     },
  { label: '投信動向',   value: 'trust'       },
  { label: '★ 三買訊號', value: 'triple'      },
  { label: '連續買超',   value: 'consecutive' },
];

const CONSEC_DAYS_OPTIONS = [
  { label: '3日+', value: 3 },
  { label: '5日+', value: 5 },
  { label: '10日+', value: 10 },
];

export default function InstitutionalPage() {
  const [activeTab,  setActiveTab]  = useState('foreign');
  const [consecDays, setConsecDays] = useState(5);

  // ── Data fetches ───────────────────────────────────────────────────────────
  const { data: summaryRes, isLoading: sumLoading } = useInstitutional('market_summary');
  const { data: fbuyRes,    isLoading: fbuyLoading } = useInstitutional('top_foreign_buy', '&limit=20');
  const { data: fsellRes,   isLoading: fsellLoading } = useInstitutional('top_foreign_sell', '&limit=20');
  const { data: trustRes,   isLoading: trustLoading } = useInstitutional('top_trust_buy', '&limit=20');
  const { data: tripleRes,  isLoading: tripleLoading } = useInstitutional('triple_buy');
  const { data: consecRes,  isLoading: consecLoading } = useInstitutional('consecutive_buy', `&days=${consecDays}`);

  // ── Compute today's totals from last summary row ───────────────────────────
  const summaryRows: SummaryRow[] = summaryRes?.data ?? [];
  const today = summaryRows[summaryRows.length - 1];
  const todayForeign = n(today?.total_foreign);
  const todayTrust   = n(today?.total_trust);
  const todayDealer  = n(today?.total_dealer);

  // Trend chart data — convert lot units to NT$ billions for display
  // (lot values are in 張; treat as proxy — scale by 1000 for visual)
  const trendData = summaryRows.map(r => ({
    date:    String(r.date).slice(5), // MM-DD
    外資:    n(r.total_foreign),
    投信:    n(r.total_trust),
    自營商:  n(r.total_dealer),
  }));

  // ── Foreign table columns ─────────────────────────────────────────────────
  const foreignBuyColumns = [
    { label: '#',      render: (_: FlowRow, i: number) => <span style={{ color: 'var(--text-muted)' }}>{i + 1}</span> },
    { label: '代號',   render: (r: FlowRow) => <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span> },
    { label: '股名',   render: (r: FlowRow) => <span style={{ color: 'var(--text-primary)' }}>{r.name_zh}</span> },
    { label: '買超(張)', render: (r: FlowRow) => <NetCell v={r.foreign_net} /> },
    { label: '連買天數', render: (r: FlowRow) => {
      const d = n(r.foreign_consecutive_days);
      return <span className="num" style={{ color: d > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{d > 0 ? `+${d}日` : '—'}</span>;
    }},
    { label: '股價',   render: (r: FlowRow) => <span className="num" style={{ color: 'var(--text-secondary)' }}>{r.close != null ? r.close.toFixed(2) : '—'}</span> },
    { label: '漲跌%',  render: (r: FlowRow) => {
      const c = formatChange(r.change_pct ?? 0);
      return <span className="num font-semibold" style={{ color: c.color }}>{c.value}</span>;
    }},
  ];

  const foreignSellColumns = [
    { label: '#',      render: (_: FlowRow, i: number) => <span style={{ color: 'var(--text-muted)' }}>{i + 1}</span> },
    { label: '代號',   render: (r: FlowRow) => <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span> },
    { label: '股名',   render: (r: FlowRow) => <span style={{ color: 'var(--text-primary)' }}>{r.name_zh}</span> },
    { label: '賣超(張)', render: (r: FlowRow) => <NetCell v={r.foreign_net} /> },
    { label: '連賣天數', render: (r: FlowRow) => {
      const d = n(r.foreign_consecutive_days);
      return <span className="num" style={{ color: d < 0 ? 'var(--accent-red)' : 'var(--text-muted)' }}>{d < 0 ? `${d}日` : '—'}</span>;
    }},
    { label: '股價',   render: (r: FlowRow) => <span className="num" style={{ color: 'var(--text-secondary)' }}>{r.close != null ? r.close.toFixed(2) : '—'}</span> },
    { label: '漲跌%',  render: (r: FlowRow) => {
      const c = formatChange(r.change_pct ?? 0);
      return <span className="num font-semibold" style={{ color: c.color }}>{c.value}</span>;
    }},
  ];

  const trustColumns = [
    { label: '#',      render: (_: FlowRow, i: number) => <span style={{ color: 'var(--text-muted)' }}>{i + 1}</span> },
    { label: '代號',   render: (r: FlowRow) => <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span> },
    { label: '股名',   render: (r: FlowRow) => <span style={{ color: 'var(--text-primary)' }}>{r.name_zh}</span> },
    { label: '買超(張)', render: (r: FlowRow) => <NetCell v={r.trust_net} /> },
    { label: '連買天數', render: (r: FlowRow) => {
      const d = n(r.trust_consecutive_days);
      return <span className="num" style={{ color: d > 0 ? 'var(--accent-green)' : 'var(--text-muted)' }}>{d > 0 ? `+${d}日` : '—'}</span>;
    }},
    { label: '股價',   render: (r: FlowRow) => <span className="num" style={{ color: 'var(--text-secondary)' }}>{r.close != null ? r.close.toFixed(2) : '—'}</span> },
    { label: '漲跌%',  render: (r: FlowRow) => {
      const c = formatChange(r.change_pct ?? 0);
      return <span className="num font-semibold" style={{ color: c.color }}>{c.value}</span>;
    }},
  ];

  const tripleColumns = [
    { label: '代號',    render: (r: FlowRow) => <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span> },
    { label: '股名',    render: (r: FlowRow) => <span style={{ color: 'var(--text-primary)' }}>{r.name_zh}</span> },
    { label: '外資',    render: (r: FlowRow) => <NetCell v={r.foreign_net} /> },
    { label: '投信',    render: (r: FlowRow) => <NetCell v={r.trust_net} /> },
    { label: '自營商',  render: (r: FlowRow) => <NetCell v={r.dealer_net} /> },
    { label: '合計(張)', render: (r: FlowRow) => <NetCell v={r.total_net} /> },
    { label: '連續天數', render: (r: FlowRow) => {
      const d = n(r.triple_buy_streak);
      return <Badge variant="gold">{d > 0 ? `${d}日` : '今日'}</Badge>;
    }},
    { label: '漲跌%',  render: (r: FlowRow) => {
      const c = formatChange(r.change_pct ?? 0);
      return <span className="num font-semibold" style={{ color: c.color }}>{c.value}</span>;
    }},
  ];

  const consecColumns = [
    { label: '代號',    render: (r: FlowRow) => <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span> },
    { label: '股名',    render: (r: FlowRow) => <span style={{ color: 'var(--text-primary)' }}>{r.name_zh}</span> },
    { label: '連續天數', render: (r: FlowRow) => {
      const d = n(r.foreign_consecutive_days);
      return <span className="num font-semibold" style={{ color: 'var(--accent-green)' }}>+{d}日</span>;
    }},
    { label: '期間漲跌%', render: (r: FlowRow) => {
      const v = r.period_return_pct;
      if (v == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
      const c = formatChange(v);
      return <span className="num font-semibold" style={{ color: c.color }}>{c.value}</span>;
    }},
    { label: '累積買超(張)', render: (r: FlowRow) => <NetCell v={r.foreign_net} /> },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Page title ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            法人動向
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            三大法人買賣超資料，每日收盤後更新
          </p>
        </div>

        {/* ── Today's totals ─────────────────────────────────────────────── */}
        {sumLoading
          ? <div className="flex gap-3"><Skeleton className="h-16 flex-1" /><Skeleton className="h-16 flex-1" /><Skeleton className="h-16 flex-1" /></div>
          : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '外資', value: todayForeign, bg: 'rgba(61,142,248,0.12)', border: 'rgba(61,142,248,0.3)', color: 'var(--accent-blue)' },
                { label: '投信', value: todayTrust,   bg: 'rgba(255,140,66,0.12)', border: 'rgba(255,140,66,0.3)', color: 'var(--accent-orange)' },
                { label: '自營商', value: todayDealer, bg: 'rgba(155,89,182,0.12)', border: 'rgba(155,89,182,0.3)', color: 'var(--accent-purple)' },
              ].map(({ label, value, bg, border, color }) => (
                <div key={label} className="flex flex-col items-center justify-center rounded-xl py-4 gap-1"
                  style={{ backgroundColor: bg, border: `1px solid ${border}` }}>
                  <span className="text-xs font-semibold" style={{ color }}>{label}</span>
                  <span className="num text-lg font-bold"
                    style={{ color: value >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                    {value >= 0 ? '+' : ''}{formatNTD(Math.abs(value) * 1000)}
                  </span>
                </div>
              ))}
            </div>
          )
        }

        {/* ── 30-day trend chart ─────────────────────────────────────────── */}
        <Card>
          <p className="mb-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            近30日三大法人買賣超趨勢
          </p>
          {sumLoading
            ? <Skeleton className="h-48 w-full" />
            : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gForeign" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--accent-blue)"   stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-blue)"   stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gTrust" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--accent-orange)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-orange)" stopOpacity={0}   />
                    </linearGradient>
                    <linearGradient id="gDealer" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--accent-purple)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--accent-purple)" stopOpacity={0}   />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={60}
                    tickFormatter={v => v >= 10000 || v <= -10000 ? `${(v/10000).toFixed(0)}萬` : String(v)} />
                  <Tooltip content={<TrendTooltip />} />
                  <Area type="monotone" dataKey="外資"   stroke="var(--accent-blue)"   fill="url(#gForeign)" strokeWidth={1.5} dot={false} name="外資" />
                  <Area type="monotone" dataKey="投信"   stroke="var(--accent-orange)" fill="url(#gTrust)"   strokeWidth={1.5} dot={false} name="投信" />
                  <Area type="monotone" dataKey="自營商" stroke="var(--accent-purple)" fill="url(#gDealer)"  strokeWidth={1.5} dot={false} name="自營商" />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        </Card>

        {/* ── Main tabs ──────────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="px-4 pt-4">
            <Tabs tabs={MAIN_TABS} activeTab={activeTab} onChange={setActiveTab} />
          </div>

          <div className="px-4 py-4">

            {/* 外資動向 */}
            {activeTab === 'foreign' && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>▲ 外資買超排行 TOP 20</p>
                  <FlowTable rows={fbuyRes?.data ?? []} columns={foreignBuyColumns} isLoading={fbuyLoading} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-red)' }}>▼ 外資賣超排行 TOP 20</p>
                  <FlowTable rows={fsellRes?.data ?? []} columns={foreignSellColumns} isLoading={fsellLoading} />
                </div>
              </div>
            )}

            {/* 投信動向 */}
            {activeTab === 'trust' && (
              <div>
                <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-orange)' }}>▲ 投信買超排行 TOP 20</p>
                <FlowTable rows={trustRes?.data ?? []} columns={trustColumns} isLoading={trustLoading} />
              </div>
            )}

            {/* 三買訊號 */}
            {activeTab === 'triple' && (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg px-4 py-3 text-xs"
                  style={{ backgroundColor: 'rgba(61,142,248,0.08)', border: '1px solid rgba(61,142,248,0.2)', color: 'var(--accent-blue)' }}>
                  💡 外資、投信、自營商同時呈現買超，為三方同步流入現象。三買訊號出現時，通常伴隨股價短期強勢表現。
                </div>
                <FlowTable rows={tripleRes?.data ?? []} columns={tripleColumns} isLoading={tripleLoading} />
              </div>
            )}

            {/* 連續買超 */}
            {activeTab === 'consecutive' && (
              <div className="flex flex-col gap-4">
                {/* Filter pills */}
                <div className="flex gap-2">
                  {CONSEC_DAYS_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setConsecDays(opt.value)}
                      className="rounded-full px-4 py-1.5 text-xs font-medium transition-colors duration-100"
                      style={{
                        backgroundColor: consecDays === opt.value ? 'var(--accent-green)' : 'transparent',
                        color: consecDays === opt.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
                        border: `1px solid ${consecDays === opt.value ? 'var(--accent-green)' : 'var(--border)'}`,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <FlowTable rows={consecRes?.data ?? []} columns={consecColumns} isLoading={consecLoading} />
              </div>
            )}

          </div>
        </Card>
      </div>
    </div>
  );
}
