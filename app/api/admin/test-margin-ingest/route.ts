// app/api/admin/test-margin-ingest/route.ts
// TEMPORARY — isolated test for the batched ingestMarginData rewrite.
// Delete once the fix is confirmed working and folded into the daily cron.

import { NextRequest, NextResponse } from 'next/server';
import { ingestMarginData } from '@/lib/ingest';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const taiwanMs = now.getTime() + 8 * 60 * 60 * 1000;
  const taiwanDate = new Date(taiwanMs).toISOString().slice(0, 10);

  const start = Date.now();
  const result = await ingestMarginData(taiwanDate);
  const elapsedMs = Date.now() - start;

  return NextResponse.json({ date: taiwanDate, elapsedMs, ...result });
}