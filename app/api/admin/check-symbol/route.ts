// app/api/admin/check-symbol/route.ts
// Quick reusable diagnostic: shows the last N days of daily_prices for any symbol.
// Usage: GET /api/admin/check-symbol?symbol=1808

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'Missing ?symbol= param' }, { status: 400 });
  }

  const rows = await queryUnsafe(
    `SELECT date, open, high, low, close, change_amt, change_pct
     FROM daily_prices
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT 5`,
    [symbol],
  );

  const globalLatest = await queryUnsafe<{ max_date: string }>(
    `SELECT MAX(date)::text AS max_date FROM daily_prices`,
    [],
  );

  return NextResponse.json({ symbol, rows, globalLatestDate: globalLatest[0]?.max_date });
}