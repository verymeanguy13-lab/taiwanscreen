// app/api/admin/migrate-market-cap/route.ts
// ONE-TIME migration: market_cap was BIGINT (whole numbers only), but the
// computed value has 2 decimal places (e.g. 176.97), causing every insert
// with a non-round market cap to fail with "invalid input syntax for type
// bigint". Widening the column fixes this permanently. Delete this file
// after running it once successfully.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await queryUnsafe(
    `ALTER TABLE fundamentals ALTER COLUMN market_cap TYPE NUMERIC(14,2)`,
    [],
  );

  return NextResponse.json({ ok: true, message: 'market_cap column widened to NUMERIC(14,2)' });
}