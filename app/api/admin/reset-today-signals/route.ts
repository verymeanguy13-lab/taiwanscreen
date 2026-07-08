// app/api/admin/reset-today-signals/route.ts
//
// TEMPORARY debug tool — deletes today's signal_results rows so the
// trigger-signals gate re-opens and the next accuracy-page visit
// recomputes signals using the current (fixed) code.
// Delete this file once you've confirmed the fix worked.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayDate = new Date().toISOString().split('T')[0];

  const deleted = await queryUnsafe<{ id: number }>(
    `DELETE FROM signal_results WHERE signal_date = $1 RETURNING id`,
    [todayDate],
  );

  return NextResponse.json({
    ok: true,
    todayDate,
    deletedCount: deleted.length,
  });
}