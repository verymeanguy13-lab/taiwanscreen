// app/api/admin/debug-dividend-row/route.ts
//
// TEMPORARY debug tool — shows the raw dividend_summary row for a symbol,
// with no computation layer in between. Delete once confirmed.

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

  return NextResponse.json({ symbol, rows });
}