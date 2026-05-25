// =============================================================================
// app/api/cron/daily/route.ts
// Triggered by Vercel Cron at 08:30 UTC = 4:30pm Taiwan time (UTC+8), weekdays.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  ingestStockList,
  ingestDailyPrices,
  ingestInstitutionalFlows,
  ingestMarginData,
} from '@/lib/ingest';

export async function GET(req: NextRequest) {
  // ── 1. Validate cron secret ──────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Skip weekends (Taiwan time) ───────────────────────────────────────
  const now = new Date();
  // Compute Taiwan local day-of-week (UTC+8)
  const taiwanOffset = 8 * 60;
  const taiwanMs = now.getTime() + taiwanOffset * 60 * 1000;
  const taiwanDay = new Date(taiwanMs).getUTCDay(); // 0=Sun, 6=Sat

  if (taiwanDay === 0 || taiwanDay === 6) {
    return NextResponse.json({ message: 'Market closed today' });
  }

  // ── 3. Build today's date string (Taiwan local date) ─────────────────────
  const taiwanDate = new Date(taiwanMs).toISOString().slice(0, 10);
  console.log(`[cron/daily] Running ingestion for ${taiwanDate}…`);

  // ── 4. Run each ingestion step individually ───────────────────────────────
  const allErrors: string[] = [];

  const stocks = await (async () => {
    try {
      return await ingestStockList();
    } catch (err) {
      const msg = `ingestStockList fatal: ${err}`;
      console.error(msg);
      allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const prices = await (async () => {
    try {
      return await ingestDailyPrices(taiwanDate);
    } catch (err) {
      const msg = `ingestDailyPrices fatal: ${err}`;
      console.error(msg);
      allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const institutional = await (async () => {
    try {
      // Also computes consecutive days internally
      return await ingestInstitutionalFlows(taiwanDate);
    } catch (err) {
      const msg = `ingestInstitutionalFlows fatal: ${err}`;
      console.error(msg);
      allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const margin = await (async () => {
    try {
      return await ingestMarginData(taiwanDate);
    } catch (err) {
      const msg = `ingestMarginData fatal: ${err}`;
      console.error(msg);
      allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  // Collect all sub-errors
  allErrors.push(...stocks.errors, ...prices.errors, ...institutional.errors, ...margin.errors);

  // ── 5. Trigger alert checks (after all ingestion is done) ─────────────────
  // We call /api/cron/alerts internally instead of adding a 3rd Vercel cron
  // job (Hobby plan only allows 2). This runs once per day after market close.
  await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/cron/alerts`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  }).catch(err => console.error('[daily] alerts cron error:', err));

  // ── 6. Return summary ─────────────────────────────────────────────────────
  console.log(`[cron/daily] Completed for ${taiwanDate}. Total errors: ${allErrors.length}`);

  return NextResponse.json({
    success: true,
    date: taiwanDate,
    results: {
      stocks:        { count: stocks.count },
      prices:        { count: prices.count },
      institutional: { count: institutional.count },
      margin:        { count: margin.count },
    },
    errors: allErrors,
  });
}