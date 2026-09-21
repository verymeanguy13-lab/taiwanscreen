// =============================================================================
// app/api/admin/taiex-post-open-reaction/route.ts
//
// READ-ONLY. Fetches FinMind's TaiwanVariousIndicators5Seconds (TAIEX,
// confirmed free -- no data_id param) and, for each trading day, extracts:
//   - prevClose: last 5-second observation of the previous trading day
//     present in this same dataset (documented as such; not an official
//     TWSE closing print, just this dataset's own last tick)
//   - openPrice: the 09:00:00 (or earliest available) observation
//   - price at each required horizon: 09:00:05, 09:01, 09:02, 09:03,
//     09:05, 09:10, 09:15, 09:30, 10:00, 11:00, 12:00, 13:30 (nearest
//     available tick within +/-15s of the target, since exact grid
//     alignment isn't guaranteed every day)
//
// Fetching the full 2023-2026 range in one call would exceed Vercel's
// function timeout, so this processes month-by-month starting at
// `cursor` (default: start_date) and stops with enough time budget left
// to respond cleanly, returning `nextCursor` to resume from. Call
// repeatedly with ?cursor=<nextCursor> until `done: true`.
//
// Query params: start_date, end_date (both required on the first call).
// cursor optional (defaults to start_date).
// =============================================================================

import { NextResponse } from 'next/server';

interface FinMindRow {
  date: string; // "YYYY-MM-DD HH:MM:SS"
  TAIEX: number;
}

const HORIZONS = ['09:00:05', '09:01:00', '09:02:00', '09:03:00', '09:05:00',
                   '09:10:00', '09:15:00', '09:30:00', '10:00:00', '11:00:00',
                   '12:00:00', '13:30:00'];

async function fetchMonth(monthStart: string, monthEnd: string): Promise<FinMindRow[]> {
  const token = process.env.FINMIND_TOKEN;
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset', 'TaiwanVariousIndicators5Seconds');
  url.searchParams.set('start_date', monthStart);
  url.searchParams.set('end_date', monthEnd);
  const res = await fetch(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const json = await res.json() as { data?: FinMindRow[]; msg?: string };
  if (!json.data) throw new Error(`FinMind error for ${monthStart}..${monthEnd}: ${json.msg ?? 'unknown'}`);
  return json.data;
}

function nextMonthStart(d: string): string {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(1);
  return dt.toISOString().slice(0, 10);
}

function monthEnd(monthStartStr: string): string {
  const dt = new Date(monthStartStr + 'T00:00:00Z');
  dt.setUTCMonth(dt.getUTCMonth() + 1);
  dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

function timeToSeconds(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const cursor = searchParams.get('cursor') ?? startDate;
  if (!startDate || !endDate || !cursor) {
    return NextResponse.json({ error: 'start_date and end_date (YYYY-MM-DD) are required' }, { status: 400 });
  }

  const deadline = Date.now() + 8000; // leave buffer under the 10s Hobby limit
  const perDay: Array<Record<string, unknown>> = [];
  let cur = cursor;
  let prevDayLastTick: number | null = null; // carries across month boundaries within this call

  try {
    while (cur <= endDate && Date.now() < deadline) {
      const mEnd = monthEnd(cur) > endDate ? endDate : monthEnd(cur);
      const rows = await fetchMonth(cur, mEnd);

      const byDay = new Map<string, FinMindRow[]>();
      for (const r of rows) {
        const [datePart] = r.date.split(' ');
        if (!byDay.has(datePart)) byDay.set(datePart, []);
        byDay.get(datePart)!.push(r);
      }

      const days = [...byDay.keys()].sort();
      for (const day of days) {
        const dayRows = byDay.get(day)!.sort((a, b) => a.date.localeCompare(b.date));
        if (dayRows.length === 0) continue;

        const prevClose = prevDayLastTick;
        const openRow = dayRows.find(r => r.date.endsWith('09:00:00')) ?? dayRows[0];
        const openPrice = openRow.TAIEX;

        const horizonPrices: Record<string, number | null> = {};
        for (const h of HORIZONS) {
          const targetSec = timeToSeconds(h);
          let best: FinMindRow | null = null;
          let bestDiff = Infinity;
          for (const r of dayRows) {
            const t = r.date.split(' ')[1];
            const diff = Math.abs(timeToSeconds(t) - targetSec);
            if (diff < bestDiff && diff <= 15) { bestDiff = diff; best = r; }
          }
          horizonPrices[h] = best ? best.TAIEX : null;
        }

        perDay.push({ date: day, prevClose, openPrice, ...horizonPrices, tickCount: dayRows.length });
        prevDayLastTick = dayRows[dayRows.length - 1].TAIEX;
      }

      cur = nextMonthStart(cur);
    }

    const done = cur > endDate;
    return NextResponse.json({
      note: 'Read-only. prevClose is this dataset\'s own last tick of the prior trading day, not an official TWSE close. Horizon prices are nearest tick within 15s.',
      startDate, endDate,
      processedThrough: done ? endDate : cur,
      done,
      nextCursor: done ? null : cur,
      dayCount: perDay.length,
      days: perDay,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, processedThrough: cur, dayCount: perDay.length, days: perDay }, { status: 500 });
  }
}
