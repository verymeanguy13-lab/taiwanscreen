'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { Badge }    from '@/components/ui/Badge';
import { Card }     from '@/components/ui/Card';
import { Button }   from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface DividendRow {
  symbol:            string;
  name_zh:           string;
  sector:            string | null;
  market:            string;
  close:             number | null;
  change_pct:        number | null;
  latest_yield_pct:  number | null;
  consecutive_years: number | null;
  dividend_frequency: string | null;
  stability_score:   number | null;
  next_ex_date:      string | null;
  last_cash_dividend: number | null;
}

interface Stats {
  above_4pct: number;
  above_5pct: number;
  avg_yield:  number;
  total:      number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtFreq(f: string | null): string {
  if (!f) return '—';
  if (f === 'monthly')   return '月配';
  if (f === 'quarterly') return '季配';
  if (f === 'semi-annual') return '半年配';
  return '年配';
}

function stabilityBadge(score: number | null): { label: string; variant: 'green' | 'gold' | 'red' | 'grey' } {
  if (score == null) return { label: '—', variant: 'grey' };
  if (score >= 70)   return { label: 'A', variant: 'green' };
  if (score >= 40)   return { label: 'B', variant: 'gold' };
  return               { label: 'C', variant: 'red' };
}

// ── Pill toggle group ─────────────────────────────────────────────────────────
function PillGroup<T extends string>({
  options, value, onChange,
}: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className="rounded-full px-3 py-1 text-xs font-medium transition-colors duration-100"
          style={{
            backgroundColor: value === opt.value ? 'var(--accent-green)' : 'transparent',
            color: value === opt.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
            border: `1px solid ${value === opt.value ? 'var(--accent-green)' : 'var(--border)'}`,
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DividendPage() {
  const router = useRouter();

  // Filter state
  const [minYield,    setMinYield]    = useState('4');
  const [consecYears, setConsecYears] = useState<string>('all');
  const [freq,        setFreq]        = useState<string>('all');
  const [page,        setPage]        = useState(1);
  const [applied,     setApplied]     = useState({ minYield: '4', consecYears: 'all', freq: 'all' });

  const apply = () => {
    setApplied({ minYield, consecYears, freq });
    setPage(1);
  };

  // Build API URL from applied filters
  const buildUrl = () => {
    const p = new URLSearchParams({ mode: 'screener', page: String(page) });
    if (applied.minYield) p.set('min_yield', applied.minYield);
    if (applied.consecYears !== 'all') p.set('consecutive_years_min', applied.consecYears);
    if (applied.freq !== 'all') p.set('dividend_freq', applied.freq);
    return `/api/dividend?${p.toString()}`;
  };

  const { data: statsRes } = useSWR('/api/dividend?mode=stats', fetcher);
  const { data: res, isLoading } = useSWR(buildUrl(), fetcher, { keepPreviousData: true });

  const stats: Stats | undefined = statsRes?.data;
  const rows: DividendRow[]      = res?.data?.rows ?? [];
  const total: number            = res?.data?.total ?? 0;
  const totalPages               = Math.ceil(total / 50);

  const CONSEC_OPTIONS = [
    { label: '全部', value: 'all' },
    { label: '3年+', value: '3'  },
    { label: '5年+', value: '5'  },
    { label: '10年+',value: '10' },
  ];

  const FREQ_OPTIONS = [
    { label: '全部', value: 'all'       },
    { label: '年配', value: 'annual'    },
    { label: '季配', value: 'quarterly' },
    { label: '月配', value: 'monthly'   },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-5">

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            台股高殖利率篩選
          </h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            找出最適合存股的標的，比較殖利率與配息穩定度
          </p>
        </div>

        {/* ── Stats bar ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-4 text-xs">
          {[
            { label: '殖利率 > 4%', value: stats ? `${stats.above_4pct} 檔` : '—' },
            { label: '殖利率 > 5%', value: stats ? `${stats.above_5pct} 檔` : '—' },
            { label: '市場平均',    value: stats ? `${Number(stats.avg_yield).toFixed(2)}%` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-lg px-4 py-2"
              style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span className="num font-bold text-sm" style={{ color: 'var(--accent-gold)' }}>{value}</span>
            </div>
          ))}
          {/* Quick links */}
          <div className="ml-auto flex items-center gap-2">
            <Link href="/dividend/calendar">
              <Button variant="outline" size="sm">除息行事曆</Button>
            </Link>
            <Link href="/dividend/calculator">
              <Button variant="outline" size="sm">存股計算機</Button>
            </Link>
          </div>
        </div>

        {/* ── Filter row ─────────────────────────────────────────────────── */}
        <Card>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>殖利率下限 (%)</label>
              <input
                type="number"
                value={minYield}
                onChange={e => setMinYield(e.target.value)}
                placeholder="例：4"
                className="w-24 rounded px-2 py-1.5 text-sm"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>連續配息</span>
              <PillGroup options={CONSEC_OPTIONS} value={consecYears} onChange={setConsecYears} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>配息頻率</span>
              <PillGroup options={FREQ_OPTIONS} value={freq} onChange={setFreq} />
            </div>
            <Button variant="primary" size="sm" onClick={apply}>套用</Button>
          </div>
        </Card>

        {/* ── Results ────────────────────────────────────────────────────── */}
        {isLoading
          ? <Skeleton className="h-64 w-full" />
          : (
            <>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                共找到 {total.toLocaleString('en-US')} 檔
              </p>
              <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
                <table className="w-full text-xs" style={{ minWidth: 700 }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                      {['代號','股名','股價','殖利率','年度股利','連續配息年','穩定分數','配息頻率','近期除息日'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold"
                          style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-8 text-center"
                        style={{ color: 'var(--text-muted)' }}>找不到符合條件的股票</td></tr>
                    )}
                    {rows.map((row, idx) => {
                      const change  = formatChange(row.change_pct ?? 0);
                      const stab    = stabilityBadge(row.stability_score);
                      return (
                        <tr key={row.symbol}
                          className="cursor-pointer transition-colors duration-100"
                          onClick={() => router.push(`/stock/${row.symbol}`)}
                          style={{
                            backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border)',
                          }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'; }}>
                          <td className="num px-3 py-2 font-semibold" style={{ color: 'var(--accent-blue)' }}>{row.symbol}</td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.name_zh}</td>
                          <td className="num px-3 py-2" style={{ color: 'var(--text-primary)' }}>{row.close != null ? Number(row.close).toFixed(2) : '—'}</td>
                          <td className="num px-3 py-2 font-bold" style={{ color: 'var(--accent-gold)' }}>
                            {row.latest_yield_pct != null ? `${Number(row.latest_yield_pct).toFixed(2)}%` : '—'}
                          </td>
                          <td className="num px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                            {row.last_cash_dividend != null ? `NT$${Number(row.last_cash_dividend).toFixed(2)}` : '—'}
                          </td>
                          <td className="num px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                            {row.consecutive_years != null ? `${row.consecutive_years} 年` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={stab.variant}>{stab.label}</Badge>
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{fmtFreq(row.dividend_frequency)}</td>
                          <td className="num px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                            {row.next_ex_date ? String(row.next_ex_date).slice(0, 10) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 py-2">
                  <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一頁</Button>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>第 {page} / {totalPages} 頁</span>
                  <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一頁</Button>
                </div>
              )}
            </>
          )
        }
      </div>
    </div>
  );
}
