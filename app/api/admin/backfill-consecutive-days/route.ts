// app/api/admin/backfill-consecutive-days/route.ts
//
// One-shot backfill (Session 82): triple_buy, foreign_consecutive_days, and
// trust_consecutive_days were only ever computed for whichever date was
// "today" at the moment cron/daily ran that day — every other row in
// institutional_flows has always had these three columns as NULL, since
// nothing ever backfilled them for historical dates. Because a backtest
// always looks at a PAST date, it can never land on "today's" row, so
// filters like foreign_consecutive_min and triple_buy were structurally
// guaranteed to return 0 samples at every period, independent of the
// separate price-history-depth bug fixed earlier this session.
//
// SELF-RESUMING (same pattern as ingestFinancialStatements /
// ingestBalanceSheetFinMind): a single request covering all ~76 dates ×
// thousands of symbols each is far too large for one 300s serverless
// invocation. Each call instead processes a small batch of dates (default
// 5, override with ?limit=N) — whichever distinct dates still have any row
// with foreign_consecutive_days IS NULL, oldest first — and reports how
// many dates are still remaining. Call it repeatedly until "remaining": 0.
//
// Usage:
//   curl -X POST "https://taiwanscreen.vercel.app/api/admin/backfill-consecutive-days?limit=5" \
//     -H "x-cron-secret: <CRON_SECRET>"

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { computeConsecutiveDays, computeTripleBuy } from '@/lib/ingest';

export const maxDuration = 300; // 5 minutes -- same as other heavy admin endpoints

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = req.nextUrl.searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 5;

  const remainingRow = await queryUnsafe<{ cnt: string }>(
    `SELECT COUNT(DISTINCT date)::int AS cnt
     FROM institutional_flows
     WHERE foreign_consecutive_days IS NULL`,
    [],
  );
  const remainingBefore = parseInt(String(remainingRow[0]?.cnt ?? '0'), 10);

  const dates = await queryUnsafe<{ date: string }>(
    `SELECT DISTINCT date::text AS date
     FROM institutional_flows
     WHERE foreign_consecutive_days IS NULL
     ORDER BY date
     LIMIT $1`,
    [limit],
  );

  console.log(`[backfill-consecutive-days] Processing ${dates.length} dates (${remainingBefore} remaining before this batch)…`);

  let processed = 0;
  const errors: string[] = [];

  for (const { date } of dates) {
    try {
      await computeTripleBuy(date);
      await computeConsecutiveDays(date);
      processed++;
    } catch (err) {
      const msg = `[backfill-consecutive-days] Failed for ${date}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  const remaining = Math.max(0, remainingBefore - processed);
  console.log(`[backfill-consecutive-days] Done. Processed ${processed}/${dates.length} dates, ${errors.length} errors, ${remaining} still remaining.`);

  return NextResponse.json({
    success: true,
    processed,
    datesThisBatch: dates.map(d => d.date),
    remaining,
    errors,
  });
}