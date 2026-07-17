// app/api/admin/test-prices-ingest/route.ts
// TEMPORARY — isolated test for the batched ingestDailyPrices rewrite.
// Defaults to a throwaway fake date; pass ?date=YYYY-MM-DD to target a real date.
// Delete once the fix is confirmed and folded into the daily cron.

import { NextRequest, NextResponse } from 'next/server';
import { ingestDailyPrices } from '@/lib/ingest';
import { queryUnsafe } from '@/lib/db';

export const maxDuration = 300;

const TEST_DATE = '2099-01-01';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get('date') ?? TEST_DATE;

  const start = Date.now();
  const result = await ingestDailyPrices(date);
  const elapsedMs = Date.now() - start;

  return NextResponse.json({ date, elapsedMs, ...result });
}

// GET: raw TWSE diagnostic — bypasses all our parsing logic and shows exactly
// what TWSE's MI_INDEX endpoint returns right now, live.
export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = tw.getUTCFullYear();
  const m = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tw.getUTCDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${dateStr}&type=ALLBUT0999`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });

    const status = res.status;
    let body: any = null;
    let parseError: string | null = null;
    try {
      body = await res.json();
    } catch (e) {
      parseError = String(e);
    }

    return NextResponse.json({
      dateStr,
      url,
      httpStatus: status,
      stat: body?.stat ?? null,
      tableTitles: Array.isArray(body?.tables) ? body.tables.map((t: any) => t.title) : null,
      parseError,
    });
  } catch (err) {
    return NextResponse.json({ dateStr, url, fetchError: String(err) });
  }
}

// Call this with DELETE to clean up rows for a given date (defaults to the fake test date)
export async function DELETE(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get('date') ?? TEST_DATE;

  const deleted = await queryUnsafe(
    `DELETE FROM daily_prices WHERE date = $1 RETURNING symbol`,
    [date],
  );

  return NextResponse.json({ date, deletedRows: deleted.length });
}