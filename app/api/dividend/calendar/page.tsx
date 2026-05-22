'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Skeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface CalendarRow {
  symbol:           string;
  name_zh:          string;
  ex_dividend_date: string;
  cash_dividend:    number | null;
  yield_pct:        number | null;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function DividendCalendarPage() {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed

  // Fetch 3 months of data so navigation doesn't need new fetches
  const { data: res, isLoading } = useSWR(
    `/api/dividend?mode=calendar&months=3`,
    fetcher,
  );

  const allRows: CalendarRow[] = res?.data?.rows ?? [];

  // Build map: dateStr -> rows
  const dateMap = useMemo(() => {
    const m = new Map<string, CalendarRow[]>();
    for (const row of allRows) {
      const key = String(row.ex_dividend_date).slice(0, 10);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(row);
    }
    return m;
  }, [allRows]);

  // Calendar grid
  const firstDay   = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells      = Array.from({ length: firstDay + daysInMonth }, (_, i) =>
    i < firstDay ? null : i - firstDay + 1,
  );
  // Pad to complete final row
  while (cells.length % 7 !== 0) cells.push(null);

  const goBack = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const goNext = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-5">

        {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Link href="/dividend" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>殖利率篩選</Link>
          <span>›</span>
          <span style={{ color: 'var(--text-primary)' }}>除息行事曆</span>
        </nav>

        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>除息行事曆</h1>

        {/* ── Month navigation ───────────────────────────────────────────── */}
        <div className="flex items-center gap-4">
          <button onClick={goBack} className="rounded px-3 py-1.5 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
            ← 上個月
          </button>
          <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            {year} 年 {month + 1} 月
          </span>
          <button onClick={goNext} className="rounded px-3 py-1.5 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; }}>
            下個月 →
          </button>
        </div>

        {isLoading
          ? <Skeleton className="h-96 w-full" />
          : (
            <div className="overflow-x-auto">
              <div style={{ minWidth: 700 }}>
                {/* Weekday headers */}
                <div className="grid grid-cols-7 gap-px mb-px">
                  {WEEKDAYS.map((d, i) => (
                    <div key={d} className="py-2 text-center text-xs font-semibold"
                      style={{ color: i === 0 || i === 6 ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                      {d}
                    </div>
                  ))}
                </div>

                {/* Day cells */}
                <div className="grid grid-cols-7 gap-px"
                  style={{ backgroundColor: 'var(--border)' }}>
                  {cells.map((day, idx) => {
                    const dateStr = day
                      ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      : '';
                    const events  = day ? (dateMap.get(dateStr) ?? []) : [];
                    const isToday = dateStr === today.toISOString().slice(0, 10);
                    const isWeekend = idx % 7 === 0 || idx % 7 === 6;

                    return (
                      <div key={idx}
                        className="flex flex-col gap-1 p-1.5 min-h-[80px]"
                        style={{
                          backgroundColor: day
                            ? (isWeekend ? 'rgba(74,79,106,0.08)' : 'var(--bg-card)')
                            : 'var(--bg-secondary)',
                        }}>
                        {day && (
                          <>
                            <span className="text-xs font-semibold self-end"
                              style={{
                                color: isToday ? 'var(--accent-green)' : isWeekend ? 'var(--text-muted)' : 'var(--text-secondary)',
                                width: 20, height: 20,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                borderRadius: '50%',
                                backgroundColor: isToday ? 'rgba(0,212,170,0.15)' : 'transparent',
                              }}>
                              {day}
                            </span>
                            {events.slice(0, 3).map(ev => (
                              <Link key={ev.symbol} href={`/stock/${ev.symbol}`}
                                className="flex items-center gap-1 rounded px-1 py-0.5 text-xs truncate"
                                style={{
                                  backgroundColor: 'rgba(245,183,0,0.12)',
                                  border: '1px solid rgba(245,183,0,0.25)',
                                  color: 'var(--accent-gold)',
                                }}
                                onClick={e => e.stopPropagation()}>
                                <span className="num font-semibold">{ev.symbol}</span>
                                {ev.yield_pct != null && (
                                  <span style={{ color: 'var(--text-muted)' }}>
                                    {Number(ev.yield_pct).toFixed(1)}%
                                  </span>
                                )}
                              </Link>
                            ))}
                            {events.length > 3 && (
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                +{events.length - 3} 更多
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )
        }
      </div>
    </div>
  );
}
