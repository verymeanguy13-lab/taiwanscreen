'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, TooltipProps,
} from 'recharts';
import { Tabs }     from '@/components/ui/Tabs';
import { Card }     from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange } from '@/lib/utils';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface MarketTotalRow {
  date:          string;
  total_margin:  string | number;
  total_short:   string | number;
}

interface MarginRow {
  symbol:                  string;
  name_zh:                 string;
  sector:                  string | null;
  margin_change:           number | null;
  margin_balance:          number | null;
  margin_ratio:            number | null;
  short_balance:           number | null;
  short_change:            number | null;
  short_ratio:             number | null;
  foreign_consecutive_days: number | null;
  foreign_net:             number | null;
  squeeze_score:           number | null;
  close:                   number | null;
  change_pct:              number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const n = (v: unknown) => Number(v ?? 0);

function fmtBil(v: number): string {
  return `NT$${(v / 100_000_000).toFixed(0)}億`;
}

function fmtChange(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US');
  return v >= 0 ? `+${abs}` : `-${abs}`;
}

// ── Trend tooltip ─────────────────────────────────────────────────────────────
function TrendTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      <div className="mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.stroke }}>{p.name}</span>
          <span className="num">{fmtBil(n(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

// ── Info note box ─────────────────────────────────────────────────────────────
function Note({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-4 py-3 text-xs"
      style={{ backgroundColor: `${color}14`, border: `1px solid ${color}40`, color }}>
      💡 {children}
    </div>
  );
}

// ── Generic margin table ──────────────────────────────────────────────────────
function MarginTable({
  rows,
  columns,
  isLoading,
  highlightFn,
}: {
  rows: MarginRow[];
  columns: { label: string; render: (r: MarginRow, i: number) => React.ReactNode }[];
  isLoading: boolean;
  highlightFn?: (r: MarginRow) => boolean;
}) {
  const router = useRouter();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ minWidth: 400 }}>
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
          {rows.map((row, idx) => {
            const highlighted = highlightFn?.(row) ?? false;
            return (
              <tr key={row.symbol}
                className="cursor-pointer transition-colors duration-100"
                onClick={() => router.push(`/stock/${row.symbol}`)}
                style={{
                  backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: highlighted ? '3px solid var(--accent-gold)' : '3px solid transparent',
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared column parts ───────────────────────────────────────────────────────
const symbolCol = { label: '代號', render: (r: MarginRow) => (
  <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span>
)};
const nameCol = { label: '股名', render: (r: MarginRow) => (
  <span style={{ color: 'var(--text-primary)' }}>{r.name_zh}</span>
)};
const changePctCol = { label: '漲跌%', render: (r: MarginRow) => {
  const c = formatChange(r.change_pct ?? 0);
  return <span className="num font-semibold" style={{ color: c.color }}>{c.value}</span>;
}};

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = [
  { label: '融資減少', value: 'decrease' },
  { label: '融資增加', value: 'increase' },
  { label: '融券排行', value: 'short'    },
  { label: '軋空候選', value: 'squeeze'  },
];

export default function MarginPage() {
  const [activeTab, setActiveTab] = useState('decrease');

  const { data: totalRes,    isLoading: totalLoading    } = useSWR('/api/margin?mode=market_total',       fetcher);
  const { data: increaseRes, isLoading: increaseLoading } = useSWR('/api/margin?mode=top_margin_increase', fetcher);
  const { data: decreaseRes, isLoading: decreaseLoading } = useSWR('/api/margin?mode=top_margin_decrease', fetcher);
  const { data: shortRes,    isLoading: shortLoading    } = useSWR('/api/margin?mode=top_short',          fetcher);
  const { data: squeezeRes,  isLoading: squeezeLoading  } = useSWR('/api/margin?mode=short_squeeze',      fetcher);

  const totalRows: MarketTotalRow[] = totalRes?.data ?? [];
  const latest = totalRows[totalRows.length - 1];

  const trendData = totalRows.map(r => ({
    date:   String(r.date).slice(5),
    融資餘額: n(r.total_margin),
    融券餘額: n(r.total_short),
  }));

  // ── Column definitions ────────────────────────────────────────────────────
  const marginChangeColumns = [
    symbolCol, nameCol,
    { label: '融資變化(張)', render: (r: MarginRow) => (
      <span className="num font-semibold"
        style={{ color: n(r.margin_change) >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
        {fmtChange(r.margin_change)}
      </span>
    )},
    { label: '融資餘額', render: (r: MarginRow) => (
      <span className="num" style={{ color: 'var(--text-secondary)' }}>
        {r.margin_balance != null ? n(r.margin_balance).toLocaleString('en-US') : '—'}
      </span>
    )},
    changePctCol,
  ];

  const shortColumns = [
    symbolCol, nameCol,
    { label: '融券餘額(張)', render: (r: MarginRow) => (
      <span className="num font-semibold" style={{ color: 'var(--accent-orange)' }}>
        {r.short_balance != null ? n(r.short_balance).toLocaleString('en-US') : '—'}
      </span>
    )},
    { label: '券資比%', render: (r: MarginRow) => (
      <span className="num" style={{ color: n(r.short_ratio) > 30 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
        {r.short_ratio != null ? `${Number(r.short_ratio).toFixed(2)}%` : '—'}
      </span>
    )},
    changePctCol,
  ];

  const squeezeColumns = [
    symbolCol, nameCol,
    { label: '券資比%', render: (r: MarginRow) => (
      <span className="num font-semibold" style={{ color: 'var(--accent-orange)' }}>
        {r.short_ratio != null ? `${Number(r.short_ratio).toFixed(2)}%` : '—'}
      </span>
    )},
    { label: '外資連買天數', render: (r: MarginRow) => (
      <span className="num font-semibold" style={{ color: 'var(--accent-green)' }}>
        +{n(r.foreign_consecutive_days)} 日
      </span>
    )},
    changePctCol,
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            融資融券
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            追蹤市場融資融券動向，掌握籌碼鬆緊訊號
          </p>
        </div>

        {/* ── Market overview ────────────────────────────────────────────── */}
        {totalLoading
          ? <div className="flex gap-3"><Skeleton className="h-14 flex-1" /><Skeleton className="h-14 flex-1" /></div>
          : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-xl px-4 py-3"
                style={{ backgroundColor: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.25)' }}>
                <span className="text-xs" style={{ color: 'var(--accent-red)' }}>今日全市場融資餘額</span>
                <span className="num text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {latest?.total_margin ? fmtBil(n(latest.total_margin)) : '—'}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-xl px-4 py-3"
                style={{ backgroundColor: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.25)' }}>
                <span className="text-xs" style={{ color: 'var(--accent-green)' }}>今日全市場融券餘額</span>
                <span className="num text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                  {latest?.total_short ? fmtBil(n(latest.total_short)) : '—'}
                </span>
              </div>
            </div>
          )
        }

        {/* ── 60-day trend chart ─────────────────────────────────────────── */}
        <Card>
          <p className="mb-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            近60日融資融券餘額趨勢
          </p>
          {totalLoading
            ? <Skeleton className="h-44 w-full" />
            : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v, i) => i % 10 === 0 ? v : ''} />
                  <YAxis yAxisId="margin" orientation="left"
                    tick={{ fontSize: 10, fill: 'var(--accent-red)' }}
                    axisLine={false} tickLine={false} width={64}
                    tickFormatter={v => v >= 100_000_000 ? `${(v / 100_000_000).toFixed(0)}億` : String(v)} />
                  <YAxis yAxisId="short" orientation="right"
                    tick={{ fontSize: 10, fill: 'var(--accent-green)' }}
                    axisLine={false} tickLine={false} width={54}
                    tickFormatter={v => v >= 100_000_000 ? `${(v / 100_000_000).toFixed(0)}億` : String(v)} />
                  <Tooltip content={<TrendTooltip />} />
                  <Line yAxisId="margin" type="monotone" dataKey="融資餘額"
                    stroke="var(--accent-red)" strokeWidth={1.5} dot={false} name="融資餘額" />
                  <Line yAxisId="short" type="monotone" dataKey="融券餘額"
                    stroke="var(--accent-green)" strokeWidth={1.5} dot={false} name="融券餘額" />
                </LineChart>
              </ResponsiveContainer>
            )
          }
        </Card>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="px-4 pt-4">
            <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
          </div>

          <div className="px-4 py-4 flex flex-col gap-4">

            {activeTab === 'decrease' && (
              <>
                <Note color="var(--accent-green)">
                  融資餘額減少，顯示槓桿部位縮減，結合股價上漲更具參考價值。
                </Note>
                <MarginTable
                  rows={decreaseRes?.data ?? []}
                  columns={marginChangeColumns}
                  isLoading={decreaseLoading}
                />
              </>
            )}

            {activeTab === 'increase' && (
              <>
                <Note color="var(--accent-red)">
                  融資大增可能為散戶追高，注意追高風險，尤其在漲幅已大的個股上更需謹慎。
                </Note>
                <MarginTable
                  rows={increaseRes?.data ?? []}
                  columns={marginChangeColumns}
                  isLoading={increaseLoading}
                />
              </>
            )}

            {activeTab === 'short' && (
              <MarginTable
                rows={shortRes?.data ?? []}
                columns={shortColumns}
                isLoading={shortLoading}
                highlightFn={r => n(r.short_ratio) > 30}
              />
            )}

            {activeTab === 'squeeze' && (
              <>
                <Note color="var(--accent-gold)">
                  融券餘額偏高，同期外資持續買超，兩者呈現背離。軋空分數 = 融券餘額 × 外資連買天數，分數越高代表軋空壓力越大。
                </Note>
                <MarginTable
                  rows={squeezeRes?.data ?? []}
                  columns={squeezeColumns}
                  isLoading={squeezeLoading}
                  highlightFn={r => n(r.short_ratio) > 20 && n(r.foreign_consecutive_days) >= 5}
                />
              </>
            )}

          </div>
        </Card>
      </div>
    </div>
  );
}
