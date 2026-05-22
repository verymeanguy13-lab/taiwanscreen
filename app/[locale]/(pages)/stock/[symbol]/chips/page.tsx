'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, ReferenceLine,
  TooltipProps,
} from 'recharts';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { Skeleton } from '@/components/ui/Skeleton';

// ── Types ─────────────────────────────────────────────────────────────────────
interface InstitutionalFlow {
  date:         string;
  foreign_net:  number | null;
  trust_net:    number | null;
  dealer_net:   number | null;
}

interface MarginRow {
  date:           string;
  margin_balance: number | null;
  short_balance:  number | null;
  margin_ratio:   number | null;
}

interface InstitutionalSummary {
  foreign_5d:              number;
  foreign_10d:             number;
  foreign_20d:             number;
  trust_5d:                number;
  trust_10d:               number;
  trust_20d:               number;
  foreign_consecutive_days: number;
  trust_consecutive_days:  number;
  is_triple_buy:           boolean;
}

interface BrokerRow {
  broker_id:   string;
  broker_name: string;
  net_5d:      number;
  net_10d:     number;
  net_20d:     number;
}

interface ChipsData {
  institutionalFlows:   InstitutionalFlow[];
  institutionalSummary: InstitutionalSummary;
  marginData:           MarginRow[];
  brokerRanking: {
    buyers:  BrokerRow[];
    sellers: BrokerRow[];
  };
}

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNet(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n).toLocaleString('en-US');
  return n >= 0 ? `+${abs}` : `-${abs}`;
}

function netColor(n: number): string {
  return n >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

// ── Custom tooltip for institutional chart ────────────────────────────────────
function InstitutionalTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      <div className="mb-1 font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.fill }}>{p.name}</span>
          <span className="num">{fmtNet(p.value as number)} 張</span>
        </div>
      ))}
    </div>
  );
}

// ── Custom tooltip for margin chart ──────────────────────────────────────────
function MarginTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      <div className="mb-1 font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.stroke }}>{p.name}</span>
          <span className="num">{Number(p.value ?? 0).toLocaleString('en-US')} 張</span>
        </div>
      ))}
    </div>
  );
}

// ── Section title ─────────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
      {children}
    </h2>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ChipsPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const [brokerTab, setBrokerTab] = useState('buyers');

  const { data: res, isLoading } = useSWR(
    symbol ? `/api/stock/${symbol}/chips` : null,
    fetcher,
  );

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-5">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const chips = res?.data as ChipsData | undefined;
  if (!chips) {
    return (
      <div className="flex h-64 items-center justify-center text-sm"
        style={{ color: 'var(--text-muted)' }}>
        暫無籌碼資料
      </div>
    );
  }

  const { institutionalFlows, institutionalSummary: s, marginData, brokerRanking } = chips;

  // Last 60 days of flows
  const flowData60 = institutionalFlows.slice(-60).map(r => ({
    date:     r.date,
    外資:     Number(r.foreign_net ?? 0),
    投信:     Number(r.trust_net   ?? 0),
    自營商:   Number(r.dealer_net  ?? 0),
  }));

  const marginData60 = marginData.slice(-60).map(r => ({
    date:          r.date,
    融資餘額:      Number(r.margin_balance ?? 0),
    融券餘額:      Number(r.short_balance  ?? 0),
    margin_ratio:  Number(r.margin_ratio   ?? 0),
  }));

  const latestMarginRatio = marginData60[marginData60.length - 1]?.margin_ratio ?? 0;

  const xTickFormatter = (val: string, idx: number) =>
    idx % 10 === 0 ? val.slice(5) : ''; // show MM-DD every 10th

  const brokerTabOptions = [
    { label: '買超前10名', value: 'buyers'  },
    { label: '賣超前10名', value: 'sellers' },
  ];

  const activeBrokers = brokerTab === 'buyers'
    ? brokerRanking.buyers
    : brokerRanking.sellers;

  const isBuyers = brokerTab === 'buyers';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Breadcrumb ────────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Link href="/" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>台股雷達</Link>
          <span>›</span>
          <Link href={`/stock/${symbol}`} className="hover:underline" style={{ color: 'var(--text-secondary)' }}>
            {symbol}
          </Link>
          <span>›</span>
          <span style={{ color: 'var(--text-primary)' }}>籌碼面</span>
        </nav>

        {/* ══ PANEL 1 — 三大法人 ══════════════════════════════════════════ */}
        <Card>
          <SectionTitle>📊 三大法人買賣超（近60日）</SectionTitle>

          {/* Summary row */}
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <span style={{ color: 'var(--text-secondary)' }}>
              外資近5日：
              <span className="num font-semibold" style={{ color: netColor(s.foreign_5d) }}>
                {fmtNet(s.foreign_5d)} 張
              </span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              近10日：
              <span className="num font-semibold" style={{ color: netColor(s.foreign_10d) }}>
                {fmtNet(s.foreign_10d)} 張
              </span>
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>
              近20日：
              <span className="num font-semibold" style={{ color: netColor(s.foreign_20d) }}>
                {fmtNet(s.foreign_20d)} 張
              </span>
            </span>
          </div>

          {/* Signal badges */}
          <div className="mb-4 flex flex-wrap gap-2">
            {s.foreign_consecutive_days > 0 && (
              <Badge variant="green">外資連買 {s.foreign_consecutive_days} 日</Badge>
            )}
            {s.foreign_consecutive_days < 0 && (
              <Badge variant="red">外資連賣 {Math.abs(s.foreign_consecutive_days)} 日</Badge>
            )}
            {s.trust_consecutive_days > 0 && (
              <Badge variant="blue">投信連買 {s.trust_consecutive_days} 日</Badge>
            )}
            {s.is_triple_buy && (
              <Badge variant="gold">★ 三買訊號</Badge>
            )}
          </div>

          {/* Stacked bar chart */}
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={flowData60} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} stackOffset="sign">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={xTickFormatter}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={60}
                tickFormatter={v => v >= 10000 || v <= -10000
                  ? `${(v / 10000).toFixed(1)}萬`
                  : v.toLocaleString('en-US')}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip content={<InstitutionalTooltip />} />
              <Bar dataKey="外資"  stackId="a" fill="var(--accent-blue)"   name="外資" />
              <Bar dataKey="投信"  stackId="a" fill="var(--accent-orange)" name="投信" />
              <Bar dataKey="自營商" stackId="a" fill="var(--accent-purple)" name="自營商" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* ══ PANEL 2 — 融資融券 ══════════════════════════════════════════ */}
        <Card>
          <SectionTitle>📉 融資融券餘額（近60日）</SectionTitle>

          {/* 融資使用率 */}
          <div className="mb-4 flex items-center gap-2 text-xs">
            <span style={{ color: 'var(--text-secondary)' }}>融資使用率：</span>
            <span
              className="num font-semibold text-sm"
              style={{ color: latestMarginRatio > 70 ? 'var(--accent-red)' : 'var(--accent-green)' }}
            >
              {latestMarginRatio.toFixed(2)}%
            </span>
            {latestMarginRatio > 70 && (
              <Badge variant="red">融資偏高</Badge>
            )}
          </div>

          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={marginData60} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={xTickFormatter}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              {/* Left Y axis: 融資 (larger scale) */}
              <YAxis
                yAxisId="margin"
                orientation="left"
                tick={{ fontSize: 10, fill: 'var(--accent-red)' }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(0)}萬` : String(v)}
              />
              {/* Right Y axis: 融券 (smaller scale) */}
              <YAxis
                yAxisId="short"
                orientation="right"
                tick={{ fontSize: 10, fill: 'var(--accent-green)' }}
                axisLine={false}
                tickLine={false}
                width={54}
                tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(0)}萬` : String(v)}
              />
              <Tooltip content={<MarginTooltip />} />
              <Line
                yAxisId="margin"
                type="monotone"
                dataKey="融資餘額"
                stroke="var(--accent-red)"
                strokeWidth={1.5}
                dot={false}
                name="融資餘額"
              />
              <Line
                yAxisId="short"
                type="monotone"
                dataKey="融券餘額"
                stroke="var(--accent-green)"
                strokeWidth={1.5}
                dot={false}
                name="融券餘額"
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* ══ PANEL 3 — 券商分點 ══════════════════════════════════════════ */}
        <Card className="p-0">
          <div className="px-4 pt-4">
            <SectionTitle>🏦 券商分點排行（近20日）</SectionTitle>
            <Tabs
              tabs={brokerTabOptions}
              activeTab={brokerTab}
              onChange={setBrokerTab}
            />
          </div>

          <div className="overflow-x-auto px-4 pb-4 pt-3">
            <table className="w-full text-xs" style={{ minWidth: 420 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['排名', '券商名稱', '近5日(張)', '近10日(張)', '近20日(張)'].map(h => (
                    <th key={h}
                      className="pb-2 text-left font-semibold"
                      style={{ color: 'var(--text-muted)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeBrokers.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center" style={{ color: 'var(--text-muted)' }}>
                      暫無資料
                    </td>
                  </tr>
                )}
                {activeBrokers.map((row, idx) => (
                  <tr
                    key={row.broker_id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    {/* 排名 */}
                    <td className="num py-2 pr-4 font-semibold"
                      style={{ color: idx < 3 ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                      {idx + 1}
                    </td>
                    {/* 券商名稱 */}
                    <td className="py-2 pr-4" style={{ color: 'var(--text-primary)' }}>
                      {row.broker_name}
                      <span className="ml-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                        ({row.broker_id})
                      </span>
                    </td>
                    {/* 近5日 */}
                    <td className="num py-2 pr-4 font-semibold"
                      style={{ color: isBuyers ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {fmtNet(row.net_5d)}
                    </td>
                    {/* 近10日 */}
                    <td className="num py-2 pr-4"
                      style={{ color: isBuyers ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {fmtNet(row.net_10d)}
                    </td>
                    {/* 近20日 */}
                    <td className="num py-2"
                      style={{ color: isBuyers ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {fmtNet(row.net_20d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    </div>
  );
}
