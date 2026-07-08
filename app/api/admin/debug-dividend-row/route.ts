// app/api/admin/debug-dividend-row/route.ts
//
// TEMPORARY debug tool — shows the raw dividend_summary row for a symbol,
// plus a breakdown of how many stocks meet various consecutive_years/yield
// thresholds, to diagnose why 存股族 backtest shows 0 samples.
// Delete once confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get('symbol') ?? '0050';

  const rows = await queryUnsafe(
    `SELECT * FROM dividend_summary WHERE symbol = $1`,
    [symbol],
  );

  const counts = await queryUnsafe(
    `SELECT
       COUNT(*) FILTER (WHERE consecutive_years >= 5)                                  AS years_5plus,
       COUNT(*) FILTER (WHERE latest_yield_pct >= 4)                                   AS yield_4plus,
       COUNT(*) FILTER (WHERE consecutive_years >= 5 AND latest_yield_pct >= 4)        AS both,
       COUNT(*)                                                                        AS total_rows
     FROM dividend_summary`,
    [],
  );

  return NextResponse.json({ symbol, rows, counts });
}