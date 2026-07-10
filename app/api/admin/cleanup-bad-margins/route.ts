// app/api/admin/cleanup-bad-margins/route.ts
// ONE-TIME cleanup: corrects leftover bad gross_margin/net_margin values that
// were written before the revenue > 0 guard existed. These are old, already-
// closed quarters that FinMind won't republish, so the normal ingest rotation
// will never touch them again — this directly nulls out any row where
// revenue is null/zero/negative but a margin was still stored.
// Delete this file after running it once successfully.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await queryUnsafe<{ symbol: string; period: string }>(
    `UPDATE fundamentals
     SET gross_margin = NULL, net_margin = NULL
     WHERE (revenue IS NULL OR revenue <= 0)
       AND (gross_margin IS NOT NULL OR net_margin IS NOT NULL)
     RETURNING symbol, period`,
    [],
  );

  return NextResponse.json({ ok: true, rows_fixed: result.length, fixed: result });
}