// app/api/admin/debug-cron-state/route.ts
//
// TEMPORARY debug tool — shows the current signal-scan bookmark position
// and how many distinct stocks got signals written recently, to confirm
// the daily cron is actually rotating through the market.
// Handles the case where cron_state doesn't exist yet (cron hasn't run
// since the fix was deployed).
// Delete this file once confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let bookmarkInfo: string | number = 'cron_state table does not exist yet — the daily cron has not run since the fix was deployed';

  try {
    const cursorRow = await queryUnsafe<{ value: number }>(
      `SELECT value FROM cron_state WHERE key = 'signal_scan_offset'`,
      [],
    );
    bookmarkInfo = cursorRow[0]?.value ?? 'table exists but no bookmark row yet';
  } catch {
    // table doesn't exist yet — leave the default message
  }

  const totalRow = await queryUnsafe<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM stocks`,
    [],
  );

  const recentSymbols = await queryUnsafe<{ symbol: string; days_seen: number }>(
    `SELECT symbol, COUNT(DISTINCT signal_date) AS days_seen
     FROM signal_results
     WHERE signal_date >= (CURRENT_DATE - INTERVAL '2 days')
       AND signal_type != '__sentinel__'
     GROUP BY symbol
     ORDER BY symbol`,
    [],
  );

  return NextResponse.json({
    currentBookmark: bookmarkInfo,
    totalStocksInSystem: totalRow[0]?.n ?? 0,
    distinctStocksScannedLast2Days: recentSymbols.length,
    symbols: recentSymbols.map(r => r.symbol),
  });
}