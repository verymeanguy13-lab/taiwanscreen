// =============================================================================
// app/api/admin/ingest-balance-sheet/route.ts
// Manually triggers a batch of debt_ratio + pb_ratio ingestion from FinMind,
// replacing the old MOPS-based ingestFundamentalsBalanceSheet() (which is
// blocked by MOPS's referer-wall — see Session 74 notes).
// Processes stocks in pages since FinMind's free tier is rate-limited and
// there are ~1,100 stocks — call repeatedly with increasing offset to cover
// the full list (e.g. offset=0, then 200, then 400, ...).
//
// Usage: POST with header x-cron-secret, JSON body { offset, limit }
//   - offset: which stock to start from (default 0)
//   - limit:  how many stocks to process this call (default 150)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestBalanceSheetFinMind } from '@/lib/ingest';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const offset = typeof body?.offset === 'number' ? body.offset : 0;
  const limit  = typeof body?.limit  === 'number' ? body.limit  : 150;

  const result = await ingestBalanceSheetFinMind(offset, limit);

  return NextResponse.json({
    success: true,
    offset,
    limit,
    processedThisBatch: result.count,
    totalStocks: result.totalStocks,
    nextOffset: offset + limit,
    done: offset + limit >= result.totalStocks,
    errors: result.errors,
  });
}