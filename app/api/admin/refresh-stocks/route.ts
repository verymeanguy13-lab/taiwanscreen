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