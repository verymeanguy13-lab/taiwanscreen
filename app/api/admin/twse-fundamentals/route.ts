// app/api/admin/twse-fundamentals/route.ts
// Fetches pe_ratio, pb_ratio, dividend_yield from TWSE BWIBBU_ALL.
// Called as a background task from daily cron. Completes in ~3-5 seconds.

import { NextRequest, NextResponse } from 'next/server';
import { ingestFundamentals } from '@/lib/ingest';

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await ingestFundamentals();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}