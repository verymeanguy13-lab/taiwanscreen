// app/api/admin/debug-dividend-row/route.ts
//
// TEMPORARY debug tool — combined checks used throughout tonight's session:
// dividend data, backtest filter counts, 6901's position in the stock list,
// and the scope of the negative-revenue margin bug. Delete once confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // True count of stocks with latest ROE >= 20 (no LIMIT)
  const roeCheck = await queryUnsafe(
    `SELECT COUNT(DISTINCT s.symbol) AS true_count
     FROM stocks s
     WHERE (
       SELECT roe FROM fundamentals
       WHERE symbol = s.symbol AND roe IS NOT NULL
       ORDER BY period DESC LIMIT 1
     ) >= 20`,
    [],
  );

  // True count of stocks with latest eps_growth_yoy >= 20 AND revenue_growth_yoy >= 15 (no LIMIT)
  const growthCheck = await queryUnsafe(
    `SELECT COUNT(DISTINCT s.symbol) AS true_count
     FROM stocks s
     WHERE (
       SELECT eps_growth_yoy FROM fundamentals
       WHERE symbol = s.symbol AND eps_growth_yoy IS NOT NULL
       ORDER BY period DESC LIMIT 1
     ) >= 20
     AND (
       SELECT revenue_growth_yoy FROM fundamentals
       WHERE symbol = s.symbol AND revenue_growth_yoy IS NOT NULL
       ORDER BY period DESC LIMIT 1
     ) >= 15`,
    [],
  );

  // 6901's position in the alphabetically-sorted stock list, to know which
  // offset/batch will actually reach it
  const positionCheck = await queryUnsafe(
    `SELECT COUNT(*)::int AS offset_for_6901 FROM stocks WHERE symbol < '2637'`,
    [],
  );

  // How widespread the negative-revenue margin bug actually was/is
  const scopeCheck = await queryUnsafe(
    `SELECT
       COUNT(DISTINCT symbol) FILTER (WHERE revenue < 0)        AS negative_revenue_stocks,
       COUNT(*)               FILTER (WHERE revenue < 0)        AS negative_revenue_rows,
       COUNT(*)               FILTER (WHERE gross_margin = 100) AS bogus_100pct_gross_margin_rows,
       COUNT(DISTINCT symbol) FILTER (WHERE gross_margin = 100) AS bogus_100pct_gross_margin_stocks
     FROM fundamentals`,
    [],
  );

  // Every raw row that exists for 6901, exactly as stored — to check whether
  // a separate current-quarter row (holding only pe_ratio/pb_ratio) exists
  // alongside the reported-quarter rows (holding eps/revenue/margins).
  const rawRows6901 = await queryUnsafe(
    `SELECT * FROM fundamentals WHERE symbol = '6901' ORDER BY period DESC`,
    [],
  );

  return NextResponse.json({ roeCheck, growthCheck, positionCheck, scopeCheck, rawRows6901 });
}