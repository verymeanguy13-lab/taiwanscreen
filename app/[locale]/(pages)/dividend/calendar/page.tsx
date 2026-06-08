'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface CalendarRow {
  symbol:           string;
  name_zh:          string;
  sector:           string;
  ex_dividend_date: string;
  cash_dividend:    number;
  yield_pct:        number | null;
  year:             string;
  period:           string;
}

export default function DividendCalendarPage() {
  const [months, setMonths] = useState(3);
  const { data, isLoading } = useSWR(`/api/dividend?mode=calendar&months=${months}`, fetcher);
  const rows: CalendarRow[] = data?.data?.rows ?? [];

  const grouped: Record<string, CalendarRow[]> = {};
  for (const row of rows) {
    const date = String(row.ex_dividend_date).slice(0, 10);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(row);
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-5">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>除息行事曆</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>即將除息的台股一覽</p>
          </div>
          <Link href="/dividend">
            <Button variant="outline" size="sm">← 回殖利率篩選</Button>
          </Link>
        </div>

        <div className="flex gap-2">
          {[1, 2, 3, 6].map(m => (
            <button key={m} onClick={() => setMonths(m)}
              className="rounded-full px-4 py-1.5 text-xs font-medium transition-colors"
              style={{
                backgroundColor: months === m ? 'var(--accent-green)' : 'transparent',
                color: months === m ? 'var(--bg-primary)' : 'var(--text-secondary)',
                border: `1px solid ${months === m ? 'var(--accent-green)' : 'var(--border)'}`,
              }}>
              {m}個月
            </button>
          ))}
        </div>

        {isLoading
          ? <div className="h-48 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--bg-card)' }} />
          : rows.length === 0
            ? <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>暫無除息資料</div>
            : Object.entries(grouped).map(([date, dateRows]) => (
              <div key={date}>
                <div className="mb-2 text-xs font-semibold px-1" style={{ color: 'var(--text-muted)' }}>
                  {date}
                </div>
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <table className="w-full text-xs" style={{ minWidth: 500 }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        {['代號', '股名', '股利', '殖利率', '期間'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold"
                            style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dateRows.map((row, idx) => (
                        <tr key={row.symbol + idx}
                          style={{
                            backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border)',
                          }}>
                          <td className="num px-3 py-2 font-semibold" style={{ color: 'var(--accent-blue)' }}>
                            <Link href={`/stock/${row.symbol}`}>{row.symbol}</Link>
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.name_zh}</td>
                          <td className="num px-3 py-2 font-bold" style={{ color: 'var(--accent-gold)' }}>
                            NT${Number(row.cash_dividend).toFixed(2)}
                          </td>
                          <td className="num px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                            {row.yield_pct != null ? `${Number(row.yield_pct).toFixed(2)}%` : '—'}
                          </td>
                          <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{row.period}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
        }
      </div>
    </div>
  );
}