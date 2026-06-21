// app/api/admin/mops-apply/route.ts
//
// Called by GitHub Actions after mops-cache has stored both datasets.
// Reads from mops_raw_cache and upserts debt_ratio + pb_ratio into fundamentals.
// Fast — no external calls, just DB reads/writes.
//
// Query: ?year=2025&season=1  (optional — auto-detects if omitted)

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { getLatestCompletedSeason } from '@/lib/mops';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let year: number, season: number;
  if (searchParams.has('year') && searchParams.has('season')) {
    year   = parseInt(searchParams.get('year')!);
    season = parseInt(searchParams.get('season')!);
  } else {
    ({ year, season } = getLatestCompletedSeason());
  }

  const period = `${year}Q${season}`;
  console.log(`[mops-apply] Applying cached data for ${period}…`);

  // Read both cached datasets
  const cacheRows = await queryUnsafe<{ type: string; data: unknown[] }>(
    `SELECT type, data FROM mops_raw_cache WHERE period = $1`,
    [period]
  );

  const balanceRow = cacheRows.find(r => r.type === 'balance_sheet');
  const bookRow    = cacheRows.find(r => r.type === 'book_value');

  if (!balanceRow && !bookRow) {
    return NextResponse.json(
      { error: `No cached data found for ${period}. Run mops-cache first.` },
      { status: 400 }
    );
  }

  type BalanceRow = { symbol: string; debtRatio: number };
  type BookRow    = { symbol: string; bookValuePerShare: number };

  const balanceSheets = (balanceRow?.data ?? []) as BalanceRow[];
  const bookValues    = (bookRow?.data    ?? []) as BookRow[];

  const debtMap = new Map(balanceSheets.map(r => [r.symbol, r.debtRatio]));
  const bookMap = new Map(bookValues.map(r => [r.symbol, r.bookValuePerShare]));
  const allSymbols = new Set([...debtMap.keys(), ...bookMap.keys()]);

  // Fetch latest prices in one query
  const priceRows = await queryUnsafe<{ symbol: string; close: number }>(
    `SELECT DISTINCT ON (symbol) symbol, close
     FROM daily_prices
     WHERE close IS NOT NULL AND close > 0
     ORDER BY symbol, date DESC`
  );
  const latestPrices = new Map(priceRows.map(r => [r.symbol, Number(r.close)]));

  let count = 0;
  const errors: string[] = [];

  for (const symbol of allSymbols) {
    const debtRatio  = debtMap.get(symbol) ?? null;
    const bookValue  = bookMap.get(symbol) ?? null;
    const latestClose = latestPrices.get(symbol) ?? null;

    const pbRatio =
      bookValue !== null && latestClose !== null && bookValue > 0
        ? parseFloat((latestClose / bookValue).toFixed(2))
        : null;

    try {
      await queryUnsafe(
        `INSERT INTO fundamentals (symbol, period, debt_ratio, pb_ratio)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol, period) DO UPDATE
           SET debt_ratio = COALESCE($3, fundamentals.debt_ratio),
               pb_ratio   = COALESCE($4, fundamentals.pb_ratio)`,
        [symbol, period, debtRatio, pbRatio]
      );
      count++;
    } catch (err) {
      errors.push(`${symbol}: ${err}`);
    }
  }

  console.log(`[mops-apply] Done. ${count} rows upserted, ${errors.length} errors.`);
  return NextResponse.json({ success: true, period, count, errors });
}