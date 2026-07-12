// app/api/admin/backfill-dividend-period/route.ts
//
// ONE-TIME fix: every existing row in `dividends` had `period` set equal to
// `year` (a bug in ingest-dividends -- now fixed there for future inserts).
// This collapsed all of a stock's payouts in a given year into a single
// indistinguishable period, which broke dividend_frequency / stability_score
// downstream. Rather than re-fetching all ~300 symbols from FinMind again,
// this directly recomputes `period` from each row's own ex_dividend_date
// (same logic as the fixed ingest-dividends code) in a single UPDATE.
// Delete this file once confirmed working -- it's a one-shot repair, not
// something that needs to run again.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await queryUnsafe<{ symbol: string }>(
    `UPDATE dividends
     SET period = TO_CHAR(ex_dividend_date, 'MM')
     WHERE ex_dividend_date IS NOT NULL
     RETURNING symbol`,
    [],
  );

  return NextResponse.json({
    message: 'Backfilled period from ex_dividend_date month',
    rows_updated: result.length,
  });
}