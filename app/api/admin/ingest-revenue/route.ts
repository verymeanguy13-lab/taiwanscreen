// =============================================================================
// app/api/admin/ingest-revenue/route.ts
// Manually triggers monthly revenue ingestion from TWSE's official OpenAPI,
// which computes and saves revenue_growth_yoy into the fundamentals table.
//
// NOTE: TWSE only serves the most recently published month of data — there is
// no way to request a specific past month — so this endpoint takes no body.
//
// Usage: POST with header x-cron-secret (no body needed)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestMonthlyRevenue } from '@/lib/ingest';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await ingestMonthlyRevenue();

  return NextResponse.json({
    success: result.errors.length === 0,
    count:  result.count,
    errors: result.errors,
  });
}