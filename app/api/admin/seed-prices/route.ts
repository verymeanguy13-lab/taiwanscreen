// app/api/admin/seed-prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

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

function pastBusinessDays(n: number, offset: number = 0): Date[] {
  const days: Date[] = [];
  const d = new Date();
  let skipped = 0;
  while (days.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      if (skipped < offset) {
        skipped++;
        continue;
      }
      days.push(new Date(d));
    }
  }
  return days.reverse();
}

const clean = (s: string) => parseFloat(s.replace(/,/g, '').trim()) || 0;

async function fetchPricesForDate(twseDate: string): Promise<{
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change_amt: number;
  change_pct: number;
}[]> {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${twseDate}&type=ALLBUT0999`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.stat !== 'OK') return [];

    const tables = json.tables as Array<{ title: string; fields: string[]; data: string[][] }>;
    if (!tables) return [];

    const priceTable = tables.find(t =>
      t.fields && t.fields.length >= 9 &&
      t.fields[0]?.includes('證券代號')
    );

    if (!priceTable?.data) return [];

    const results = [];
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
      const change_pct = open > 0 ? Math.round((change_amt / (close - change_amt)) * 10000) / 100 : 0;

      if (!close || close <= 0) continue;

      results.push({ symbol, open, high, low, close, volume, change_amt, change_pct });
    }

    return results;
  } catch {
    return [];
  }
}

async function upsertPrices(
  isoDate: string,
  prices: Awaited<ReturnType<typeof fetchPricesForDate>>,
): Promise<number> {
  let count = 0;
  for (const p of prices) {
    try {
      await sql`
        INSERT INTO daily_prices
          (symbol, date, open, high, low, close, volume, change_amt, change_pct)
        VALUES (
          ${p.symbol}, ${isoDate}, ${p.open}, ${p.high}, ${p.low},
          ${p.close}, ${p.volume}, ${p.change_amt}, ${p.change_pct}
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
    } catch {
      // Skip — symbol likely not in stocks table (FK violation)
    }
  }
  return count;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(parseInt(body.days) || 5, 1), 60);
  const startOffset = Math.min(Math.max(parseInt(body.startOffset) || 0, 0), 120);
  const businessDays = pastBusinessDays(days, startOffset);

  const results: Record<string, { fetched: number; inserted: number }> = {};

  for (const day of businessDays) {
    const isoDate  = toISO(day);
    const twseDate = toTWSEDate(day);

    const prices = await fetchPricesForDate(twseDate);
    const inserted = prices.length > 0 ? await upsertPrices(isoDate, prices) : 0;

    results[isoDate] = { fetched: prices.length, inserted };

    await new Promise(r => setTimeout(r, 500));
  }

  return NextResponse.json({
    ok: true,
    daysProcessed: businessDays.length,
    startOffset,
    results,
  });
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [latestPrice] = await sql`SELECT MAX(date) as d, COUNT(DISTINCT date) as days FROM daily_prices`;
  const [countRow]    = await sql`SELECT COUNT(*) as n FROM daily_prices`;

  return NextResponse.json({
    latest_price_date: latestPrice.d,
    distinct_days:     latestPrice.days,
    total_rows:        countRow.n,
  });
}