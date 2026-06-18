// =============================================================================
// app/api/cron/daily/route.ts
// Triggered by Vercel Cron at 08:30 UTC = 4:30pm Taiwan time, weekdays.
// Stripped to prices + institutional + margin only to avoid timeout.
// Signal accuracy is updated separately via /api/admin/update-signals
//
// Self-healing: if today's prices are missing, falls back to MI_INDEX
// date-specific endpoint to backfill up to 3 recent missing days.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import {
  ingestStockList,
  ingestDailyPrices,
  ingestInstitutionalFlows,
  ingestMarginData,
} from '@/lib/ingest';

const sql = neon(process.env.DATABASE_URL!);

function toTWSEDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Get last N business days (not including today)
function pastBusinessDays(n: number): Date[] {
  const days: Date[] = [];
  const now = new Date();
  const d = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  while (days.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(d));
  }
  return days.reverse();
}

// Backfill prices for a specific date using MI_INDEX (date-aware endpoint)
async function backfillPricesForDate(twseDate: string, isoDate: string): Promise<number> {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${twseDate}&type=ALLBUT0999`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return 0;
    const json = await res.json();
    if (json.stat !== 'OK') return 0;

    const tables = json.tables as Array<{ title: string; fields: string[]; data: string[][] }>;
    if (!tables) return 0;

    const priceTable = tables.find((t: any) =>
      t.fields && t.fields.length >= 9 && t.fields[0]?.includes('證券代號')
    );
    if (!priceTable?.data) return 0;

    const clean = (s: string) => parseFloat(s.replace(/,/g, '').trim()) || 0;
    let count = 0;

    for (const row of priceTable.data) {
      if (row.length < 9) continue;
      const symbol = row[0]?.trim();
      if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

      const volume     = Math.round(clean(row[2]) / 1000);
      const open       = clean(row[5]);
      const high       = clean(row[6]);
      const low        = clean(row[7]);
      const close      = clean(row[8]);
      const sign       = row[9]?.trim() === '-' ? -1 : 1;
      const change_amt = sign * clean(row[10]);
      const change_pct = (close - change_amt) > 0
        ? Math.round((change_amt / (close - change_amt)) * 10000) / 100
        : 0;

      if (!close || close <= 0) continue;

      try {
        await sql`
          INSERT INTO daily_prices
            (symbol, date, open, high, low, close, volume, change_amt, change_pct)
          VALUES (
            ${symbol}, ${isoDate}, ${open}, ${high}, ${low},
            ${close}, ${volume}, ${change_amt}, ${change_pct}
          )
          ON CONFLICT (symbol, date) DO UPDATE SET
            open       = EXCLUDED.open,
            high       = EXCLUDED.high,
            low        = EXCLUDED.low,
            close      = EXCLUDED.close,
            volume     = EXCLUDED.volume,
            change_amt = EXCLUDED.change_amt,
            change_pct = EXCLUDED.change_pct
        `;
        count++;
      } catch { /* skip FK violations */ }
    }

    return count;
  } catch {
    return 0;
  }
}

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
  const backfillResults: Record<string, number> = {};

  // ── Self-healing: check for missing days and backfill ─────────────────────
  const recentDays = pastBusinessDays(3);
  const [latestPrice] = await sql`SELECT MAX(date) as d FROM daily_prices`;
  const latestPriceDate = latestPrice?.d ? String(latestPrice.d).slice(0, 10) : null;

  for (const day of recentDays) {
    const isoDate = toISO(day);
    if (latestPriceDate && isoDate <= latestPriceDate) continue;

    console.log(`[cron/daily] Missing prices for ${isoDate}, backfilling...`);
    const count = await backfillPricesForDate(toTWSEDate(day), isoDate);
    backfillResults[isoDate] = count;
    if (count === 0) {
      allErrors.push(`Backfill returned 0 rows for ${isoDate}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Main ingestion for today ───────────────────────────────────────────────
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

  // Trigger detect-signals in background (non-blocking)
  fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/admin/detect-signals?offset=0&limit=200`, {
    method: 'POST',
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  }).catch(err => console.error('[daily] detect-signals error:', err));

  console.log(`[cron/daily] Completed for ${taiwanDate}. Errors: ${allErrors.length}`);

  return NextResponse.json({
    success: true,
    date:    taiwanDate,
    results: {
      stocks:        { count: stocks.count },
      prices:        { count: prices.count },
      institutional: { count: institutional.count },
      margin:        { count: margin.count },
      backfill:      backfillResults,
    },
    errors: allErrors,
  });
}