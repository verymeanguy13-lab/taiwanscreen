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