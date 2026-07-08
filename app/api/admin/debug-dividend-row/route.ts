// app/api/admin/debug-dividend-row/route.ts
//
// TEMPORARY debug tool — shows dividend_summary + raw dividends rows for a
// symbol, plus a market-wide breakdown, to diagnose why consecutive_years
// is stuck near 0 for every stock. Delete once confirmed.

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

  return NextResponse.json({ symbol, summary, rawDividends, counts });
}