// =============================================================================
// app/api/admin/refresh-stocks/route.ts
// POST /api/admin/refresh-stocks
// Re-ingests the stock list from TWSE + TPEx, fixing market='TWSE' for all.
//
// PowerShell:
//   Invoke-WebRequest -Uri "https://taiwanscreen.vercel.app/api/admin/refresh-stocks" `
//     -Method POST `
//     -Headers @{"x-cron-secret"="GRsiYRX6H8cyTIzPappLQM4NZvE2GiO3QodPFz6jgFo="} `
//     -UseBasicParsing | Select-Object -ExpandProperty Content
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestStockList } from '@/lib/ingest';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await ingestStockList();
  return NextResponse.json({ message: 'Stock list refreshed', ...result });
}