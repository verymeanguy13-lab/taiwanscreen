// app/api/admin/migrate-operating-margin/route.ts
// ONE-TIME migration: adds the operating_margin column, which never existed
// before. Delete this file after running it once successfully.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await queryUnsafe(
    `ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS operating_margin DECIMAL(6,2)`,
    [],
  );

  return NextResponse.json({ ok: true, message: 'operating_margin column added' });
}