// app/api/admin/debug-dividend-row/route.ts
//
// TEMPORARY debug tool — dividend_summary diagnostics plus a check on how
// many stocks currently satisfy the 高成長 backtest thresholds, to see if
// its "0 results" is a real data issue vs a cache/display issue.
// Delete once confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get('symbol') ?? '0050';

  const summary = await queryUnsafe(
    `SELECT * FROM dividend_summary WHERE symbol = $1`,
    [symbol],
  );

  const rawDividends = await queryUnsafe(
    `SELECT symbol, year, period, cash_dividend, stock_dividend, ex_dividend_date, payment_date
     FROM dividends
     WHERE symbol = $1
     ORDER BY year DESC, period DESC`,
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

  const growthCheck = await queryUnsafe(
    `SELECT
       COUNT(DISTINCT symbol) FILTER (
         WHERE eps_growth_yoy IS NOT NULL AND eps_growth_yoy >= 20
       ) AS eps_20plus_count,
       COUNT(DISTINCT symbol) FILTER (
         WHERE revenue_growth_yoy IS NOT NULL AND revenue_growth_yoy >= 15
       ) AS revenue_15plus_count,
       COUNT(DISTINCT symbol) FILTER (
         WHERE eps_growth_yoy IS NOT NULL AND eps_growth_yoy >= 20
           AND symbol IN (
             SELECT symbol FROM fundamentals
             WHERE revenue_growth_yoy IS NOT NULL AND revenue_growth_yoy >= 15
           )
       ) AS both_conditions_any_period
     FROM fundamentals`,
    [],
  );

  return NextResponse.json({ symbol, summary, rawDividends, counts, growthCheck });
}