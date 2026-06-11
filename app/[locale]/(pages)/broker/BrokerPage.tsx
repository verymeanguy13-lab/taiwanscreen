'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Tabs }     from '@/components/ui/Tabs';
import { Card }     from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Badge }    from '@/components/ui/Badge';
import { formatChange } from '@/lib/utils';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface InstitutionalRow {
  broker_id:   string; // actually symbol
  broker_name: string; // actually name_zh
  city:        string | null; // actually sector
  total_buy:   number | null;
  total_sell:  number | null;
  total_net:   number | null;
}

interface ConcentrationRow {
  symbol:            string;
  name_zh:           string;
  broker_name:       string;
  concentration_pct: number;
  buy_volume:        number;
  close:             number | null;
  change_pct:        number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNet(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US');
  return v >= 0 ? `+${abs}` : `-${abs}`;
}

// ── Institutional flow table ──────────────────────────────────────────────────
function InstTable({
  rows,
  valueKey,
  valueLabel,
  color,
  isLoading,
}: {
  rows: InstitutionalRow[];
  valueKey: 'total_buy' | 'total_sell' | 'total_net';
  valueLabel: string;
  color: string;
  isLoading: boolean;
}) {
  const router = useRouter();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ minWidth: 280 }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>#</th>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>代號／股名</th>
            <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>{valueLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center" style={{ color: 'var(--text-muted)' }}>暫無資料</td>
            </tr>
          )}
          {rows.map((row, idx) => (
            <tr
              key={row.broker_id}
              className="cursor-pointer transition-colors duration-100"
              onClick={() => router.push(`/stock/${row.broker_id}`)}
              style={{
                backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'; }}
            >
              <td className="num px-3 py-2" style={{ color: idx < 3 ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                {idx + 1}
              </td>
              <td className="px-3 py-2">
                <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{row.broker_id}</span>
                <span className="ml-1.5" style={{ color: 'var(--text-primary)' }}>{row.broker_name}</span>
                {row.city && (
                  <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({row.city})</span>
                )}
              </td>
              <td className="num px-3 py-2 text-right font-semibold" style={{ color }}>
                {fmtNet(row[valueKey])} 張
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const TABS = [
  { label: '今日法人動向', value: 'today'         },
  { label: '外資投信同買', value: 'concentration'  },
];

export default function BrokerPage() {
  const [activeTab, setActiveTab] = useState('today');
  const router = useRouter();

  // Remove broker ingestion trigger — broker_flows data is no longer used here.
  // Real broker branch scraping (bsr.twse.com.tw) will be added in a future session.

  const { data: buyersRes,  isLoading: buyersLoading  } = useSWR('/api/broker?mode=top_buyers',  fetcher);
  const { data: sellersRes, isLoading: sellersLoading } = useSWR('/api/broker?mode=top_sellers', fetcher);
  const { data: concRes,    isLoading: concLoading    } = useSWR('/api/broker?mode=concentration', fetcher);

  const buyers:  InstitutionalRow[] = buyersRes?.data  ?? [];
  const sellers: InstitutionalRow[] = sellersRes?.data ?? [];
  const conc:    ConcentrationRow[] = concRes?.data    ?? [];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Page title ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            法人籌碼
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            追蹤外資、投信每日買賣動向，掌握主力進出訊號
          </p>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="px-4 pt-4">
            <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
          </div>

          <div className="px-4 py-4">

            {/* ── 今日法人動向 ───────────────────────────────────────────── */}
            {activeTab === 'today' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-red)' }}>
                    ▲ 外資買超排行 TOP 20
                  </p>
                  <InstTable
                    rows={buyers}
                    valueKey="total_buy"
                    valueLabel="外資買超(張)"
                    color="var(--accent-red)"
                    isLoading={buyersLoading}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>
                    ▼ 外資賣超排行 TOP 20
                  </p>
                  <InstTable
                    rows={sellers}
                    valueKey="total_sell"
                    valueLabel="外資賣超(張)"
                    color="var(--accent-green)"
                    isLoading={sellersLoading}
                  />
                </div>
              </div>
            )}

            {/* ── 外資投信同買 ────────────────────────────────────────────── */}
            {activeTab === 'concentration' && (
              <div className="flex flex-col gap-4">
                <div
                  className="rounded-lg px-4 py-3 text-xs"
                  style={{
                    backgroundColor: 'rgba(245,183,0,0.08)',
                    border: '1px solid rgba(245,183,0,0.25)',
                    color: 'var(--accent-gold)',
                  }}
                >
                  💡 外資與投信同時買超，代表兩大法人同步看好；合計買超量越大，籌碼集中度越高，值得重點追蹤。
                </div>

                {concLoading
                  ? <Skeleton className="h-64 w-full" />
                  : (
                    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
                      <table className="w-full text-xs" style={{ minWidth: 560 }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['代號', '股名', '訊號', '合計買超(張)', '股價', '漲跌%'].map(h => (
                              <th key={h} className="px-3 py-2 text-left font-semibold"
                                style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {conc.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-3 py-6 text-center"
                                style={{ color: 'var(--text-muted)' }}>
                                今日暫無外資投信同買個股
                              </td>
                            </tr>
                          )}
                          {conc.map((row, idx) => {
                            const change = formatChange(row.change_pct ?? 0);
                            return (
                              <tr
                                key={row.symbol}
                                className="cursor-pointer transition-colors duration-100"
                                onClick={() => router.push(`/stock/${row.symbol}`)}
                                style={{
                                  backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                                  borderBottom: '1px solid var(--border)',
                                  borderLeft: '3px solid var(--accent-gold)',
                                }}
                                onMouseEnter={e => {
                                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)';
                                }}
                                onMouseLeave={e => {
                                  (e.currentTarget as HTMLElement).style.backgroundColor =
                                    idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)';
                                }}
                              >
                                <td className="num px-3 py-2 font-semibold"
                                  style={{ color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
                                  {row.symbol}
                                </td>
                                <td className="px-3 py-2" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                  {row.name_zh}
                                </td>
                                <td className="px-3 py-2">
                                  <Badge variant="gold">外資投信同買</Badge>
                                </td>
                                <td className="num px-3 py-2 font-semibold" style={{ color: 'var(--accent-red)' }}>
                                  +{Number(row.buy_volume).toLocaleString('en-US')}
                                </td>
                                <td className="num px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                                  {row.close != null ? Number(row.close).toFixed(2) : '—'}
                                </td>
                                <td className="num px-3 py-2 font-semibold" style={{ color: change.color }}>
                                  {change.value}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                }
              </div>
            )}

          </div>
        </Card>
      </div>
    </div>
  );
}
