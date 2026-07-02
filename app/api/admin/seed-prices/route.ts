// app/api/admin/seed-prices/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
export const maxDuration = 60;
const sql = neon(process.env.DATABASE_URL!);

function toTWSEDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toTPExDate(d: Date): string {
  // TPEx uses YYYY/MM/DD format
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function pastBusinessDays(n: number, offset: number = 0): Date[] {
  const days: Date[] = [];
  const now = new Date();
  const d = new Date(now.getTime() + 8 * 60 * 60 * 1000);
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

interface PriceRow {
  symbol:     string;
  open:       number;
  high:       number;
  low:        number;
  close:      number;
  volume:     number;
  change_amt: number;
  change_pct: number;
}

// ── TWSE prices (MI_INDEX) ────────────────────────────────────────────────────
async function fetchTWSEPricesForDate(twseDate: string): Promise<PriceRow[]> {
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

    const results: PriceRow[] = [];
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

// ── TPEx prices (via TWSE OpenAPI mirror) ─────────────────────────────────────
// tpex.org.tw blocks Vercel datacenter IPs, so we use the TWSE OpenAPI
// which mirrors TPEx daily close data and is proven to work from Vercel.
// Note: this endpoint returns today's data only (no date param) — that's fine
// for the daily cron. For backfill we accept close=open=high=low.
async function fetchTPExPricesForDate(_tpexDate: string): Promise<PriceRow[]> {
  const url = 'https://openapi.twse.com.tw/v1/exchangeReport/TPEX_STOCK_DAY_AVG_ALL';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[seed-prices] TPEx OpenAPI HTTP ${res.status}`);
      return [];
    }
    const json = await res.json() as Array<Record<string, string>>;
    if (!Array.isArray(json)) return [];

    const results: PriceRow[] = [];
    for (const row of json) {
      const symbol = row['Code']?.trim();
      if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

      const close      = parseFloat((row['ClosingPrice'] ?? '0').replace(/,/g, ''));
      if (!close || close <= 0) continue;

      const change_amt = parseFloat((row['Change'] ?? '0').replace(/,/g, ''));
      const prevClose  = close - change_amt;
      const change_pct = prevClose > 0 ? Math.round((change_amt / prevClose) * 10000) / 100 : 0;
      const volume     = Math.round(parseFloat((row['TradeVolume'] ?? '0').replace(/,/g, '')) / 1000);

      results.push({
        symbol,
        open:  close,
        high:  close,
        low:   close,
        close,
        volume,
        change_amt,
        change_pct,
      });
    }
    console.log(`[seed-prices] TPEx OpenAPI: ${results.length} stocks`);
    return results;
  } catch (err) {
    console.error('[seed-prices] TPEx fetch failed:', err);
    return [];
  }
}

// ── Upsert into DB ────────────────────────────────────────────────────────────
async function upsertPrices(isoDate: string, prices: PriceRow[]): Promise<number> {
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
  const days        = Math.min(Math.max(parseInt(body.days)        || 5,   1), 60);
  const startOffset = Math.min(Math.max(parseInt(body.startOffset) || 0,   0), 120);
  const businessDays = pastBusinessDays(days, startOffset);

  const results: Record<string, { twse: number; tpex: number; inserted: number }> = {};

  for (const day of businessDays) {
    const isoDate  = toISO(day);
    const twseDate = toTWSEDate(day);
    const tpexDate = toTPExDate(day);

    // Fetch TWSE and TPEx in parallel
    const [twsePrices, tpexPrices] = await Promise.all([
      fetchTWSEPricesForDate(twseDate),
      fetchTPExPricesForDate(tpexDate),
    ]);

    // Merge: TWSE wins on conflict (same symbol on both exchanges is rare)
    const priceMap = new Map<string, PriceRow>();
    for (const p of tpexPrices) priceMap.set(p.symbol, p);
    for (const p of twsePrices) priceMap.set(p.symbol, p);
    const merged = [...priceMap.values()];

    const inserted = merged.length > 0 ? await upsertPrices(isoDate, merged) : 0;

    results[isoDate] = {
      twse:     twsePrices.length,
      tpex:     tpexPrices.length,
      inserted,
    };

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