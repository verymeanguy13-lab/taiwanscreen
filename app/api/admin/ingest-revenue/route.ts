// =============================================================================
// app/api/admin/ingest-revenue/route.ts
// Manually triggers monthly revenue ingestion from MOPS, which computes and
// saves revenue_growth_yoy into the fundamentals table for the current period.
//
// Usage: POST with header x-cron-secret, optional JSON body { year, month }
//   - year:  western year, e.g. 2026 (defaults to current year)
//   - month: 1-12 (defaults to previous month, since MOPS publishes with a lag)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestMonthlyRevenue } from '@/lib/ingest';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let year: number | undefined;
  let month: number | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    year  = body?.year;
    month = body?.month;
  } catch { /* no body provided, use defaults */ }

  const now = new Date();
  if (!year || !month) {
    // Default to previous month — MOPS typically publishes a given month's
    // revenue around the 10th of the following month.
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    year  = year  ?? prev.getFullYear();
    month = month ?? (prev.getMonth() + 1);
  }

  const result = await ingestMonthlyRevenue(year, month);

  return NextResponse.json({
    success: result.errors.length === 0,
    year,
    month,
    count:  result.count,
    errors: result.errors,
  });
}