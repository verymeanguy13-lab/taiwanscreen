// =============================================================================
// app/api/admin/ingest-fundamentals/route.ts
// POST /api/admin/ingest-fundamentals
// Protected by x-cron-secret header.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestFundamentals } from '@/lib/ingest';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    console.log('[ingest-fundamentals] Starting fundamentals ingest…');
    const result = await ingestFundamentals();
    console.log('[ingest-fundamentals] Done:', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[ingest-fundamentals] Fatal error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}