// =============================================================================
// app/api/admin/backfill-0050-history/route.ts
// POST /api/admin/backfill-0050-history
//
// One-time backfill of 0050's price history further back than the existing
// /api/admin/backfill route reaches (that one is capped at 6 months before
// today). This walks FORWARD from a chosen starting month, one call at a
// time, so it fits Vercel Hobby's 10-second function timeout. Call it
// repeatedly, passing the returned nextStartMonth back in, until done: true.
//
// Reuses fetchHistoricalPrices from lib/twse.ts (TWSE's own STOCK_DAY
// endpoint) and the same ON CONFLICT DO NOTHING insert pattern as the
// existing backfill route — safe to re-run, will not duplicate rows.
//
// Body: { startMonth?: string, monthsPerCall?: number }
//   startMonth    — "YYYYMM", e.g. "200306" (0050 started trading June 2003).
//                    Defaults to "200306" on first call.
//   monthsPerCall — how many months to process this call (default 6, max 12).
//
// Protected by x-cron-secret header, same as the existing backfill route.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { fetchHistoricalPrices } from '@/lib/twse';

const SYMBOL = '0050';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseYyyymm(yyyymm: string): { year: number; month: number } {
  const year = parseInt(yyyymm.slice(0, 4), 10);
  const month = parseInt(yyyymm.slice(4, 6), 10);
  return { year, month };
}

function addMonths(yyyymm: string, count: number): string {
  const { year, month } = parseYyyymm(yyyymm);
  const total = year * 12 + (month - 1) + count;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${newYear}${String(newMonth).padStart(2, '0')}`;
}

function currentYyyymm(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { startMonth?: string; monthsPerCall?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const startMonth = /^\d{6}$/.test(body.startMonth ?? '') ? body.startMonth! : '200306';
  const monthsPerCall = Math.min(12, Math.max(1, body.monthsPerCall ?? 6));
  const nowMonth = currentYyyymm();

  const monthKeys: string[] = [];
  let cursor = startMonth;
  for (let i = 0; i < monthsPerCall; i++) {
    if (cursor >= nowMonth) break;
    monthKeys.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  if (monthKeys.length === 0) {
    return NextResponse.json({
      success: true,
      symbol: SYMBOL,
      message: 'Reached the current month — backfill complete.',
      processedMonths: [],
      inserted: 0,
      errors: 0,
      nextStartMonth: null,
      done: true,
    });
  }

  let inserted = 0;
  let errors = 0;

  for (const monthKey of monthKeys) {
    try {
      await sleep(300);
      const prices = await fetchHistoricalPrices(SYMBOL, `${monthKey}01`);

      for (const p of prices) {
        try {
          await queryUnsafe(
            `INSERT INTO daily_prices
               (symbol, date, open, high, low, close, volume, change_amt, change_pct)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (symbol, date) DO NOTHING`,
            [SYMBOL, p.date, p.open, p.high, p.low, p.close, p.volume, p.change_amt, p.change_pct],
          );
          inserted++;
        } catch (dbErr) {
          console.error(`[backfill-0050-history] DB error ${monthKey}:`, dbErr);
          errors++;
        }
      }
    } catch (fetchErr) {
      console.error(`[backfill-0050-history] Fetch error ${monthKey}:`, fetchErr);
      errors++;
    }
  }

  const nextStartMonth = cursor >= nowMonth ? null : cursor;

  return NextResponse.json({
    success: true,
    symbol: SYMBOL,
    processedMonths: monthKeys,
    inserted,
    errors,
    nextStartMonth,
    done: nextStartMonth === null,
  });
}
