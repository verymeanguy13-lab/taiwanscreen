// =============================================================================
// app/api/admin/ingest-financials/route.ts
// Manually (or cron-) triggers a batch of EPS growth + ROE ingestion from
// FinMind. Self-resuming: each call automatically picks the next batch of
// stocks that don't have eps_growth_yoy yet — no offset tracking needed.
// Call repeatedly (e.g. a recurring cron-job.org job) until "remaining": 0.
//
// Usage: POST with header x-cron-secret, JSON body { limit }
//   - limit: how many stocks to process this call (default 60)
//
// maxDuration is set to 60s since ~60 stocks at ~450ms each (FinMind fetch +
// rate-limit pacing) takes roughly 25-30 seconds — comfortably under the cap,
// but the default Vercel timeout (10s) would not be enough.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestFinancialStatements } from '@/lib/ingest';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = typeof body?.limit === 'number' ? body.limit : 60;

  const result = await ingestFinancialStatements(limit);

  return NextResponse.json({
    success: true,
    limit,
    processedThisBatch: result.count,
    remaining: result.remaining,
    done: result.remaining === 0,
    errors: result.errors,
  });
}