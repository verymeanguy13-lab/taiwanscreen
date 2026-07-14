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
// This loops over every distinct date already in institutional_flows and
// runs the existing computeConsecutiveDays()/computeTripleBuy() functions
// (same logic cron/daily already uses for "today") against each one, so
// historical rows get real values instead of NULL. Safe to re-run.
//
// Usage:
//   curl -X POST https://taiwanscreen.vercel.app/api/admin/backfill-consecutive-days \
//     -H "x-cron-secret: <CRON_SECRET>"
//
// Takes a while — one query per symbol per date. Check Vercel function logs
// for progress if it runs long.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { computeConsecutiveDays, computeTripleBuy } from '@/lib/ingest';

export const maxDuration = 300; // 5 minutes -- same as other heavy admin endpoints

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dates = await queryUnsafe<{ date: string }>(
    `SELECT DISTINCT date::text AS date FROM institutional_flows ORDER BY date`,
    [],
  );

  console.log(`[backfill-consecutive-days] Processing ${dates.length} dates…`);

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

  console.log(`[backfill-consecutive-days] Done. Processed ${processed}/${dates.length} dates, ${errors.length} errors.`);

  return NextResponse.json({
    success: true,
    processed,
    total: dates.length,
    errors,
  });
}