// =============================================================================
// app/api/admin/ingest-balance-sheet/route.ts
// Manually (or cron-) triggers a batch of debt_ratio + pb_ratio ingestion
// from FinMind, replacing the old MOPS-based ingestFundamentalsBalanceSheet()
// (blocked by MOPS's referer-wall — see Session 74 notes).
//
// Self-resuming: each call automatically picks the next batch of stocks that
// don't have debt_ratio or pb_ratio yet — no offset tracking needed. Call
// repeatedly (e.g. a recurring cron-job.org job) until "remaining": 0.
//
// Usage: POST with header x-cron-secret, JSON body { limit }
//   - limit: how many stocks to process this call (default 60)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestBalanceSheetFinMind } from '@/lib/ingest';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const limit = typeof body?.limit === 'number' ? body.limit : 60;

  const result = await ingestBalanceSheetFinMind(limit);

  return NextResponse.json({
    success: true,
    limit,
    processedThisBatch: result.count,
    remaining: result.remaining,
    done: result.remaining === 0,
    errors: result.errors,
  });
}