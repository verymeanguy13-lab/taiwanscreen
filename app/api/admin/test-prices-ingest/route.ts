// app/api/admin/test-prices-ingest/route.ts
// TEMPORARY — isolated test for the batched ingestDailyPrices rewrite.
// Writes to a throwaway fake date so it doesn't touch real data.
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

  const start = Date.now();
  const result = await ingestDailyPrices(TEST_DATE);
  const elapsedMs = Date.now() - start;

  return NextResponse.json({ testDate: TEST_DATE, elapsedMs, ...result });
}

// Call this with DELETE to clean up the test data afterward
export async function DELETE(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const deleted = await queryUnsafe(
    `DELETE FROM daily_prices WHERE date = $1 RETURNING symbol`,
    [TEST_DATE],
  );

  return NextResponse.json({ deletedRows: deleted.length });
}