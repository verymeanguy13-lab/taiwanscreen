// ============================================================
// ADD THIS FUNCTION TO lib/ingest.ts
// Also add these imports at the top of ingest.ts if not already present:
//   import { fetchBalanceSheet, fetchBookValue, getLatestCompletedSeason } from './mops';
// ============================================================

/**
 * Fetches balance sheet data and book value from MOPS, then upserts
 * debt_ratio and pb_ratio into the fundamentals table.
 *
 * pb_ratio is computed as: latest_close_price / book_value_per_share
 * debt_ratio is computed as: total_liabilities / total_assets × 100
 *
 * The `period` key in fundamentals matches MOPS season format: "2025Q1", "2024Q4", etc.
 */
export async function ingestFundamentalsBalanceSheet(
  year: number,
  season: number
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  let count = 0;
  const period = `${year}Q${season}`;

  console.log(`[ingest] fetchBalanceSheet ${period}...`);
  const balanceSheets = await fetchBalanceSheet(year, season);
  if (balanceSheets.length === 0) {
    errors.push(`fetchBalanceSheet returned 0 rows for ${period}`);
  }

  console.log(`[ingest] fetchBookValue ${period}...`);
  const bookValues = await fetchBookValue(year, season);
  if (bookValues.length === 0) {
    errors.push(`fetchBookValue returned 0 rows for ${period}`);
  }

  // Build lookup maps
  const debtMap = new Map(balanceSheets.map(r => [r.symbol, r.debtRatio]));
  const bookMap = new Map(bookValues.map(r => [r.symbol, r.bookValuePerShare]));

  // Get all symbols that appear in either dataset
  const allSymbols = new Set([...debtMap.keys(), ...bookMap.keys()]);
  if (allSymbols.size === 0) {
    return { count: 0, errors };
  }

  // Fetch latest close prices for pb_ratio calculation
  // We do this in one query rather than N queries
  console.log(`[ingest] fetching latest prices for pb_ratio...`);
  let latestPrices: Map<string, number> = new Map();
  try {
    const priceRows = await queryUnsafe<{ symbol: string; close: number }>(
      `SELECT DISTINCT ON (symbol) symbol, close
       FROM daily_prices
       WHERE close IS NOT NULL AND close > 0
       ORDER BY symbol, date DESC`
    );
    latestPrices = new Map(priceRows.map(r => [r.symbol, Number(r.close)]));
  } catch (e) {
    errors.push(`Failed to fetch latest prices: ${e}`);
  }

  console.log(`[ingest] upserting fundamentals for ${allSymbols.size} stocks...`);

  // Upsert in batches of 100 to avoid parameter limits
  const symbols = Array.from(allSymbols);
  const BATCH = 100;

  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);

    for (const symbol of batch) {
      const debtRatio = debtMap.get(symbol) ?? null;
      const bookValue = bookMap.get(symbol) ?? null;
      const latestClose = latestPrices.get(symbol) ?? null;

      const pbRatio =
        bookValue !== null && latestClose !== null && bookValue > 0
          ? parseFloat((latestClose / bookValue).toFixed(2))
          : null;

      try {
        await queryUnsafe(
          `INSERT INTO fundamentals (symbol, period, debt_ratio, pb_ratio)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (symbol, period) DO UPDATE SET
             debt_ratio = COALESCE($3, fundamentals.debt_ratio),
             pb_ratio   = COALESCE($4, fundamentals.pb_ratio)`,
          [symbol, period, debtRatio, pbRatio]
        );
        count++;
      } catch (e) {
        errors.push(`${symbol}: ${e}`);
      }
    }

    if (i % 500 === 0) {
      console.log(`[ingest] progress: ${i}/${symbols.length}`);
    }
  }

  console.log(`[ingest] ingestFundamentalsBalanceSheet done: ${count} rows, ${errors.length} errors`);
  return { count, errors };
}