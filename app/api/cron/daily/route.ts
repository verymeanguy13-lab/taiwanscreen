// =============================================================================
// app/api/cron/daily/route.ts
// Triggered by Vercel Cron at 12:30 UTC = 8:30pm Taiwan time, weekdays.
// Stripped to prices + institutional + margin only to avoid timeout.
// Signal accuracy is updated separately via /api/admin/update-signals
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  ingestStockList,
  ingestDailyPrices,
  ingestInstitutionalFlows,
  ingestMarginData,
} from '@/lib/ingest';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const taiwanMs  = now.getTime() + 8 * 60 * 60 * 1000;
  const taiwanDay = new Date(taiwanMs).getUTCDay();

  if (taiwanDay === 0 || taiwanDay === 6) {
    return NextResponse.json({ message: 'Market closed today' });
  }

  const taiwanDate = new Date(taiwanMs).toISOString().slice(0, 10);
  console.log(`[cron/daily] Running ingestion for ${taiwanDate}`);

  const allErrors: string[] = [];

  const stocks = await (async () => {
    try { return await ingestStockList(); }
    catch (err) {
      const msg = `ingestStockList fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const prices = await (async () => {
    try { return await ingestDailyPrices(taiwanDate); }
    catch (err) {
      const msg = `ingestDailyPrices fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const institutional = await (async () => {
    try { return await ingestInstitutionalFlows(taiwanDate); }
    catch (err) {
      const msg = `ingestInstitutionalFlows fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const margin = await (async () => {
    try { return await ingestMarginData(taiwanDate); }
    catch (err) {
      const msg = `ingestMarginData fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  allErrors.push(...stocks.errors, ...prices.errors, ...institutional.errors, ...margin.errors);

  // Trigger alert checks
  await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/cron/alerts`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  }).catch(err => console.error('[daily] alerts cron error:', err));

  console.log(`[cron/daily] Completed for ${taiwanDate}. Errors: ${allErrors.length}`);

  return NextResponse.json({
    success: true,
    date:    taiwanDate,
    results: {
      stocks:        { count: stocks.count },
      prices:        { count: prices.count },
      institutional: { count: institutional.count },
      margin:        { count: margin.count },
    },
    errors: allErrors,
  });
}