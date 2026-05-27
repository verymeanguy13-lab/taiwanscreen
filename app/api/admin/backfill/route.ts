// =============================================================================
// app/api/admin/backfill/route.ts
// POST /api/admin/backfill
// One-time backfill of historical daily_prices for the last N months.
//
// Body: { months?: number, symbols?: string[] }
//   months  — how many months to backfill (default 3, max 6)
//   symbols — optional subset; if omitted, fetches all symbols from stocks table
//
// Protected by x-cron-secret header.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { fetchHistoricalPrices } from '@/lib/twse';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  // Auth
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { months?: number; symbols?: string[]; offset?: number; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const months = Math.min(6, Math.max(1, body.months ?? 3));
  const offset = Math.max(0, body.offset ?? 0);
  const limit  = Math.min(50, Math.max(1, body.limit ?? 30));

  // Build month strings (YYYYMMDD — first day of each month)
  const monthKeys: string[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    monthKeys.push(`${y}${m}01`);
  }

  // Get symbols to backfill
  let symbols: string[];
  if (body.symbols && body.symbols.length > 0) {
    symbols = body.symbols;
  } else {
    const rows = await queryUnsafe<{ symbol: string }>(
      `SELECT symbol FROM stocks WHERE market = 'TWSE' ORDER BY symbol LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    symbols = rows.map(r => r.symbol);
  }

  if (symbols.length === 0) {
    return NextResponse.json({ message: 'No symbols to process', offset, done: true });
  }

  const results: Record<string, { inserted: number; errors: number }> = {};
  let totalInserted = 0;
  let totalErrors   = 0;

  for (const symbol of symbols) {
    results[symbol] = { inserted: 0, errors: 0 };

    for (const monthKey of monthKeys) {
      try {
        await sleep(300);
        const prices = await fetchHistoricalPrices(symbol, monthKey);

        for (const p of prices) {
          try {
            await queryUnsafe(
              `INSERT INTO daily_prices
                 (symbol, date, open, high, low, close, volume, change_amt, change_pct)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (symbol, date) DO NOTHING`,
              [symbol, p.date, p.open, p.high, p.low, p.close, p.volume, p.change_amt, p.change_pct],
            );
            results[symbol].inserted++;
            totalInserted++;
          } catch (dbErr) {
            console.error(`[backfill] DB error ${symbol} ${p.date}:`, dbErr);
            results[symbol].errors++;
            totalErrors++;
          }
        }
      } catch (fetchErr) {
        console.error(`[backfill] Fetch error ${symbol} ${monthKey}:`, fetchErr);
        results[symbol].errors++;
        totalErrors++;
      }
    }
  }

  const totalCount = await queryUnsafe<{ count: string }>(
    `SELECT COUNT(*) AS count FROM stocks WHERE market = 'TWSE'`,
    [],
  );
  const total = parseInt(totalCount[0]?.count ?? '0', 10);
  const nextOffset = offset + symbols.length;
  const done = nextOffset >= total || body.symbols != null;

  return NextResponse.json({
    success: true,
    processed: symbols.length,
    totalInserted,
    totalErrors,
    offset,
    nextOffset: done ? null : nextOffset,
    done,
    months: monthKeys,
    results,
  });
}