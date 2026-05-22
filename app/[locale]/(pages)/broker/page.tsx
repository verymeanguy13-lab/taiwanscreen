'use client';

import { useState } from 'react';
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
interface BrokerRow {
  broker_id:   string;
  broker_name: string;
  city:        string | null;
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
function fmtVol(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US');
  return v >= 0 ? `+${abs}` : `-${abs}`;
}

// ── Simple broker table ───────────────────────────────────────────────────────
function BrokerTable({
  rows,
  valueKey,
  valueLabel,
  color,
  isLoading,
}: {
  rows: BrokerRow[];
  valueKey: 'total_buy' | 'total_sell' | 'total_net';
  valueLabel: string;
  color: string;
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ minWidth: 280 }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>#</th>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>券商名稱</th>
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
              key={row.broker_id ?? row.broker_name}
              style={{
                backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <td className="num px-3 py-2" style={{ color: idx < 3 ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                {idx + 1}
              </td>
              <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                {row.broker_name}
                {row.city && (
                  <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({row.city})</span>
                )}
              </td>
              <td className="num px-3 py-2 text-right font-semibold" style={{ color }}>
                {fmtVol(row[valueKey])} 張
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
  { label: '今日分點',   value: 'today'         },
  { label: '主力集中度', value: 'concentration'  },
];

export default function BrokerPage() {
  const [activeTab, setActiveTab] = useState('today');
  const router = useRouter();

  const { data: buyersRes,  isLoading: buyersLoading  } = useSWR('/api/broker?mode=top_buyers',  fetcher);
  const { data: sellersRes, isLoading: sellersLoading } = useSWR('/api/broker?mode=top_sellers', fetcher);
  const { data: concRes,    isLoading: concLoading    } = useSWR('/api/broker?mode=concentration', fetcher);

  const buyers:  BrokerRow[]        = buyersRes?.data  ?? [];
  const sellers: BrokerRow[]        = sellersRes?.data ?? [];
  const conc:    ConcentrationRow[] = concRes?.data    ?? [];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Page title ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            券商分點
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            追蹤特定券商分點的買賣動向，掌握主力進出訊號
          </p>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="px-4 pt-4">
            <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
          </div>

          <div className="px-4 py-4">

            {/* ── 今日分點 ──────────────────────────────────────────────── */}
            {activeTab === 'today' && (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Buyers */}
                <div>
                  <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>
                    ▲ 買超最多分點 TOP 20
                  </p>
                  <BrokerTable
                    rows={buyers}
                    valueKey="total_buy"
                    valueLabel="今日買超(張)"
                    color="var(--accent-green)"
                    isLoading={buyersLoading}
                  />
                </div>

                {/* Sellers */}
                <div>
                  <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-red)' }}>
                    ▼ 賣超最多分點 TOP 20
                  </p>
                  <BrokerTable
                    rows={sellers}
                    valueKey="total_net"
                    valueLabel="今日賣超(張)"
                    color="var(--accent-red)"
                    isLoading={sellersLoading}
                  />
                </div>
              </div>
            )}

            {/* ── 主力集中度 ────────────────────────────────────────────── */}
            {activeTab === 'concentration' && (
              <div className="flex flex-col gap-4">
                {/* Explanation */}
                <div
                  className="rounded-lg px-4 py-3 text-xs"
                  style={{
                    backgroundColor: 'rgba(245,183,0,0.08)',
                    border: '1px solid rgba(245,183,0,0.25)',
                    color: 'var(--accent-gold)',
                  }}
                >
                  💡 特定券商買超比例超過 50%，可能代表主力佈局；超過 70% 的個股以金色標示，需特別留意。
                </div>

                {concLoading
                  ? <Skeleton className="h-64 w-full" />
                  : (
                    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
                      <table className="w-full text-xs" style={{ minWidth: 560 }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                            {['代號', '股名', '主力券商', '集中度%', '買超量(張)', '股價', '漲跌%'].map(h => (
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
                              <td colSpan={7} className="px-3 py-6 text-center"
                                style={{ color: 'var(--text-muted)' }}>
                                今日暫無高集中度個股
                              </td>
                            </tr>
                          )}
                          {conc.map((row, idx) => {
                            const isHighConc = row.concentration_pct >= 70;
                            const change     = formatChange(row.change_pct ?? 0);
                            return (
                              <tr
                                key={`${row.symbol}-${row.broker_name}`}
                                className="cursor-pointer transition-colors duration-100"
                                onClick={() => router.push(`/stock/${row.symbol}`)}
                                style={{
                                  backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                                  borderBottom: '1px solid var(--border)',
                                  borderLeft: isHighConc
                                    ? '3px solid var(--accent-gold)'
                                    : '3px solid transparent',
                                }}
                                onMouseEnter={e => {
                                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)';
                                }}
                                onMouseLeave={e => {
                                  (e.currentTarget as HTMLElement).style.backgroundColor =
                                    idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)';
                                }}
                              >
                                {/* 代號 */}
                                <td className="num px-3 py-2 font-semibold"
                                  style={{ color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
                                  {row.symbol}
                                </td>
                                {/* 股名 */}
                                <td className="px-3 py-2" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                                  {row.name_zh}
                                </td>
                                {/* 主力券商 */}
                                <td className="px-3 py-2" style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                  {row.broker_name}
                                </td>
                                {/* 集中度% */}
                                <td className="num px-3 py-2 font-semibold">
                                  <span style={{ color: isHighConc ? 'var(--accent-gold)' : 'var(--accent-orange)' }}>
                                    {Number(row.concentration_pct).toFixed(1)}%
                                  </span>
                                  {isHighConc && (
                                    <Badge variant="gold" className="ml-1.5">高</Badge>
                                  )}
                                </td>
                                {/* 買超量 */}
                                <td className="num px-3 py-2" style={{ color: 'var(--accent-green)' }}>
                                  +{Number(row.buy_volume).toLocaleString('en-US')}
                                </td>
                                {/* 股價 */}
                                <td className="num px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                                  {row.close != null ? Number(row.close).toFixed(2) : '—'}
                                </td>
                                {/* 漲跌% */}
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
