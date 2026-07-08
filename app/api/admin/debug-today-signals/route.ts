// app/api/admin/debug-today-signals/route.ts
//
// TEMPORARY debug tool — shows raw counts of signal_results rows created
// today, broken down by signal_type, with no maturity filter. Used to
// verify whether breakout signals are actually being inserted.
// Delete this file once confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayDate = new Date().toISOString().split('T')[0];

  const rows = await queryUnsafe<{ signal_type: string; count: string }>(
    `SELECT signal_type, COUNT(*) AS count
     FROM signal_results
     WHERE signal_date = $1
     GROUP BY signal_type
     ORDER BY count DESC`,
    [todayDate],
  );

  return NextResponse.json({ todayDate, rows });
}