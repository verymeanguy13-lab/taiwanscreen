// =============================================================================
// lib/ingest.ts — TWSE data ingestion pipeline
// =============================================================================
import { fetchStockFinancials, fetchLatestPBR, fetchStockBalanceSheet, sleep } from '@/lib/finmind';
import { queryUnsafe } from '@/lib/db';
import {
  fetchStockList,
  fetchAllStockPrices,
  fetchInstitutionalFlows,
  fetchMarginData,
  fetchFundamentals,
} from '@/lib/twse';
import { fetchBalanceSheet, fetchBookValue, fetchMonthlyRevenue } from '@/lib/mops';

type IngestResult = { count: number; errors: string[] };

export async function ingestStockList(): Promise<IngestResult> {
  console.log('[ingestStockList] Fetching stock list from TWSE…');
  const errors: string[] = [];
  let count = 0;

  const stocks = await fetchStockList();
  console.log(`[ingestStockList] Fetched ${stocks.length} stocks.`);

  for (const stock of stocks) {
    try {
      await queryUnsafe(
        `INSERT INTO stocks (symbol, name_zh, sector, market, shares_outstanding)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (symbol) DO UPDATE
           SET name_zh            = EXCLUDED.name_zh,
               sector             = COALESCE(NULLIF(EXCLUDED.sector, ''), stocks.sector),
               market             = EXCLUDED.market,
               shares_outstanding = COALESCE(EXCLUDED.shares_outstanding, stocks.shares_outstanding)`,
        [stock.symbol, stock.name_zh, stock.sector ?? null, stock.market, stock.shares_outstanding ?? null],
      );
      count++;
    } catch (err) {
      const msg = `[ingestStockList] Failed to upsert ${stock.symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`[ingestStockList] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

export async function ingestDailyPrices(date: string): Promise<IngestResult> {
  console.log(`[ingestDailyPrices] Fetching prices for ${date}…`);
  const errors: string[] = [];
  let count = 0;

  const prices = await fetchAllStockPrices();
  console.log(`[ingestDailyPrices] Fetched ${prices.length} price records.`);

  // Safety check — STOCK_DAY_ALL returns the latest trading day's data.
  // If today is a holiday or the exchange hasn't published yet,
  // the data may be from a previous day. Skip ingestion to avoid duplicates.
  const alreadyExists = await queryUnsafe<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM daily_prices WHERE date = $1`,
    [date],
  );
  if (parseInt(alreadyExists[0]?.cnt ?? '0', 10) > 100) {
    console.log(`[ingestDailyPrices] Data for ${date} already exists (${alreadyExists[0].cnt} rows), skipping.`);
    return { count: 0, errors: [] };
  }

  for (const p of prices) {
    try {
      await queryUnsafe(
        `INSERT INTO daily_prices
           (symbol, date, open, high, low, close, volume, change_amt, change_pct)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (symbol, date) DO UPDATE
           SET open       = EXCLUDED.open,
               high       = EXCLUDED.high,
               low        = EXCLUDED.low,
               close      = EXCLUDED.close,
               volume     = EXCLUDED.volume,
               change_amt = EXCLUDED.change_amt,
               change_pct = EXCLUDED.change_pct`,
        [p.symbol, date, p.open, p.high, p.low, p.close, p.volume, p.change_amt, p.change_pct],
      );
      count++;
    } catch (err) {
      const msg = `[ingestDailyPrices] Failed to upsert ${p.symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`[ingestDailyPrices] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

export async function ingestInstitutionalFlows(date: string): Promise<IngestResult> {
  console.log(`[ingestInstitutionalFlows] Fetching institutional flows for ${date}…`);
  const errors: string[] = [];
  let count = 0;

  const flows = await fetchInstitutionalFlows(date.replace(/-/g, ''));
  console.log(`[ingestInstitutionalFlows] Fetched ${flows.length} records.`);

  for (const f of flows) {
    try {
      await queryUnsafe(
        `INSERT INTO institutional_flows
           (symbol, date,
            foreign_buy, foreign_sell, foreign_net,
            trust_buy, trust_sell, trust_net,
            dealer_buy, dealer_sell, dealer_net,
            total_net)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (symbol, date) DO UPDATE
           SET foreign_buy  = EXCLUDED.foreign_buy,
               foreign_sell = EXCLUDED.foreign_sell,
               foreign_net  = EXCLUDED.foreign_net,
               trust_buy    = EXCLUDED.trust_buy,
               trust_sell   = EXCLUDED.trust_sell,
               trust_net    = EXCLUDED.trust_net,
               dealer_buy   = EXCLUDED.dealer_buy,
               dealer_sell  = EXCLUDED.dealer_sell,
               dealer_net   = EXCLUDED.dealer_net,
               total_net    = EXCLUDED.total_net`,
        [
          f.symbol, date,
          f.foreign_buy, f.foreign_sell, f.foreign_net,
          f.trust_buy,   f.trust_sell,   f.trust_net,
          f.dealer_buy,  f.dealer_sell,  f.dealer_net,
          f.total_net,
        ],
      );
      count++;
    } catch (err) {
      const msg = `[ingestInstitutionalFlows] Failed to upsert ${f.symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  try {
    await computeTripleBuy(date);
  } catch (err) {
    const msg = `[ingestInstitutionalFlows] Failed to compute triple_buy: ${err}`;
    console.error(msg);
    errors.push(msg);
  }

  await computeConsecutiveDays(date);

  console.log(`[ingestInstitutionalFlows] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

export async function computeTripleBuy(date: string): Promise<void> {
  await queryUnsafe(
    `UPDATE institutional_flows
     SET triple_buy = (foreign_net > 0 AND trust_net > 0 AND dealer_net > 0)
     WHERE date = $1`,
    [date],
  );
}

export async function computeConsecutiveDays(date: string): Promise<void> {
  console.log(`[computeConsecutiveDays] Starting for date ${date}…`);

  try {
    const symbols = await queryUnsafe<{ symbol: string }>(
      `SELECT DISTINCT symbol FROM institutional_flows WHERE date = $1`,
      [date],
    );

    for (const { symbol } of symbols) {
      try {
        const rows = await queryUnsafe<{
          date: string;
          foreign_net: number;
          trust_net: number;
        }>(
          `SELECT date, foreign_net, trust_net
           FROM institutional_flows
           WHERE symbol = $1 AND date <= $2
           ORDER BY date DESC LIMIT 60`,
          [symbol, date],
        );

        if (rows.length === 0) continue;

        let foreignStreak = 0;
        const firstForeignPositive = (rows[0].foreign_net ?? 0) > 0;
        for (const row of rows) {
          const positive = (row.foreign_net ?? 0) > 0;
          if (positive === firstForeignPositive) foreignStreak += firstForeignPositive ? 1 : -1;
          else break;
        }

        let trustStreak = 0;
        const firstTrustPositive = (rows[0].trust_net ?? 0) > 0;
        for (const row of rows) {
          const positive = (row.trust_net ?? 0) > 0;
          if (positive === firstTrustPositive) trustStreak += firstTrustPositive ? 1 : -1;
          else break;
        }

        await queryUnsafe(
          `UPDATE institutional_flows
           SET foreign_consecutive_days = $1,
               trust_consecutive_days   = $2
           WHERE symbol = $3 AND date = $4`,
          [foreignStreak, trustStreak, symbol, date],
        );
      } catch (err) {
        console.error(`[computeConsecutiveDays] Failed for ${symbol}: ${err}`);
      }
    }
  } catch (err) {
    console.error(`[computeConsecutiveDays] Fatal error: ${err}`);
  }
}

export async function ingestMarginData(date: string): Promise<IngestResult> {
  console.log(`[ingestMarginData] Fetching margin data for ${date}…`);
  const errors: string[] = [];

  const records = await fetchMarginData();
  console.log(`[ingestMarginData] Fetched ${records.length} records.`);

  if (records.length === 0) {
    return { count: 0, errors: ['[ingestMarginData] No records fetched from TWSE'] };
  }

  const validSymbolRows = await queryUnsafe<{ symbol: string }>(
    `SELECT symbol FROM stocks`,
    [],
  );
  const validSymbols = new Set(validSymbolRows.map(r => r.symbol));
  const skipped = records.filter(m => !validSymbols.has(m.symbol));
  if (skipped.length > 0) {
    console.log(`[ingestMarginData] Skipping ${skipped.length} symbols not in stocks table`);
  }

  const symbols: string[] = [];
  const balances: number[] = [];
  const changes: number[] = [];
  const shortBalances: number[] = [];
  const shortChanges: number[] = [];
  const ratios: number[] = [];

  for (const m of records.filter(m => validSymbols.has(m.symbol))) {
    const margin_ratio =
      m.margin_balance + m.short_balance > 0
        ? (m.margin_balance / (m.margin_balance + m.short_balance)) * 100
        : 0;

    symbols.push(m.symbol);
    balances.push(m.margin_balance);
    changes.push(m.margin_change);
    shortBalances.push(m.short_balance);
    shortChanges.push(m.short_change);
    ratios.push(Math.round(margin_ratio * 100) / 100);
  }

  let count = 0;
  try {
    await queryUnsafe(
      `INSERT INTO margin_data
         (symbol, date, margin_balance, margin_change,
          short_balance, short_change, margin_ratio)
       SELECT t.symbol, $7::date, t.margin_balance, t.margin_change,
              t.short_balance, t.short_change, t.margin_ratio
       FROM UNNEST(
         $1::text[], $2::numeric[], $3::numeric[],
         $4::numeric[], $5::numeric[], $6::numeric[]
       ) AS t(symbol, margin_balance, margin_change, short_balance, short_change, margin_ratio)
       ON CONFLICT (symbol, date) DO UPDATE
         SET margin_balance = EXCLUDED.margin_balance,
             margin_change  = EXCLUDED.margin_change,
             short_balance  = EXCLUDED.short_balance,
             short_change   = EXCLUDED.short_change,
             margin_ratio   = EXCLUDED.margin_ratio`,
      [symbols, balances, changes, shortBalances, shortChanges, ratios, date],
    );
    count = records.length;
  } catch (err) {
    const msg = `[ingestMarginData] Batch insert failed: ${err}`;
    console.error(msg);
    errors.push(msg);
  }

  console.log(`[ingestMarginData] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

export async function ingestFundamentals(): Promise<IngestResult> {
  console.log('[ingestFundamentals] Fetching fundamentals from TWSE…');
  const errors: string[] = [];
  let count = 0;

  const records = await fetchFundamentals();
  console.log(`[ingestFundamentals] Fetched ${records.length} records.`);

  if (records.length === 0) {
    return { count: 0, errors: ['No fundamentals data returned from TWSE'] };
  }

  const now     = new Date();
  const year    = now.getFullYear();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const period  = `${year}Q${quarter}`;

  for (const f of records) {
    try {
      await queryUnsafe(
        `INSERT INTO fundamentals (symbol, period, pe_ratio, pb_ratio)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol, period) DO UPDATE
           SET pe_ratio = EXCLUDED.pe_ratio,
               pb_ratio = EXCLUDED.pb_ratio`,
        [f.symbol, period, f.pe_ratio, f.pb_ratio],
      );
      count++;

      if (f.dividend_yield !== null && f.dividend_yield > 0) {
        await queryUnsafe(
          `INSERT INTO dividend_summary (symbol, latest_yield_pct)
           VALUES ($1, $2)
           ON CONFLICT (symbol) DO UPDATE
             SET latest_yield_pct = EXCLUDED.latest_yield_pct`,
          [f.symbol, f.dividend_yield],
        );
      }
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('foreign key') && !msg.includes('violates')) {
        errors.push(`[ingestFundamentals] Failed ${f.symbol}: ${msg}`);
      }
    }
  }

  console.log(`[ingestFundamentals] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

// =============================================================================
// ingestFundamentalsBalanceSheet — fetches debt_ratio + pb_ratio from MOPS
// =============================================================================

export async function ingestFundamentalsBalanceSheet(
  year: number,
  season: number,
): Promise<IngestResult> {
  const errors: string[] = [];
  let count = 0;
  const period = `${year}Q${season}`;

  console.log(`[ingestFundamentalsBalanceSheet] fetchBalanceSheet ${period}…`);
  const balanceSheets = await fetchBalanceSheet(year, season);
  if (balanceSheets.length === 0) {
    errors.push(`fetchBalanceSheet returned 0 rows for ${period}`);
  }

  console.log(`[ingestFundamentalsBalanceSheet] fetchBookValue ${period}…`);
  const bookValues = await fetchBookValue(year, season);
  if (bookValues.length === 0) {
    errors.push(`fetchBookValue returned 0 rows for ${period}`);
  }

  const debtMap = new Map(balanceSheets.map(r => [r.symbol, r.debtRatio]));
  const bookMap = new Map(bookValues.map(r => [r.symbol, r.bookValuePerShare]));
  const allSymbols = new Set([...debtMap.keys(), ...bookMap.keys()]);

  if (allSymbols.size === 0) {
    return { count: 0, errors };
  }

  console.log(`[ingestFundamentalsBalanceSheet] Fetching latest prices…`);
  let latestPrices: Map<string, number> = new Map();
  try {
    const priceRows = await queryUnsafe<{ symbol: string; close: number }>(
      `SELECT DISTINCT ON (symbol) symbol, close
       FROM daily_prices
       WHERE close IS NOT NULL AND close > 0
       ORDER BY symbol, date DESC`,
    );
    latestPrices = new Map(priceRows.map(r => [r.symbol, Number(r.close)]));
  } catch (e) {
    errors.push(`Failed to fetch latest prices: ${e}`);
  }

  console.log(`[ingestFundamentalsBalanceSheet] Upserting ${allSymbols.size} stocks…`);

  let i = 0;
  for (const symbol of allSymbols) {
    const debtRatio   = debtMap.get(symbol) ?? null;
    const bookValue   = bookMap.get(symbol) ?? null;
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
        [symbol, period, debtRatio, pbRatio],
      );
      count++;
    } catch (err) {
      const msg = `[ingestFundamentalsBalanceSheet] Failed ${symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }

    i++;
    if (i % 500 === 0) {
      console.log(`[ingestFundamentalsBalanceSheet] Progress: ${i}/${allSymbols.size}`);
    }
  }

  console.log(`[ingestFundamentalsBalanceSheet] Done. ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

// =============================================================================
// ingestMonthlyRevenue — fetches the latest published monthly revenue + YoY
// growth from TWSE's official OpenAPI and saves revenue_growth_yoy into the
// fundamentals table under the fiscal quarter the data actually covers.
//
// NOTE: TWSE only serves the most recently published month — it does not
// support requesting a specific past month — so this function takes no
// parameters. It always ingests whatever is currently available.
// =============================================================================

export async function ingestMonthlyRevenue(): Promise<IngestResult> {
  const errors: string[] = [];
  let count = 0;

  console.log('[ingestMonthlyRevenue] Fetching latest monthly revenue from TWSE OpenAPI…');
  const records = await fetchMonthlyRevenue();
  console.log(`[ingestMonthlyRevenue] Fetched ${records.length} records.`);

  if (records.length === 0) {
    return { count: 0, errors: ['No revenue data returned from TWSE OpenAPI'] };
  }

  // Derive the fiscal quarter from the data's own reported period (e.g. "11505"
  // = ROC year 115, month 05 = May 2026), rather than today's date, since TWSE
  // publishes with a lag (May's data appears in mid-June, etc).
  const sampleYYYMM = records[0].periodYYYMM;
  let period: string;
  if (/^\d{5,6}$/.test(sampleYYYMM)) {
    const month       = parseInt(sampleYYYMM.slice(-2), 10);
    const rocYear     = parseInt(sampleYYYMM.slice(0, sampleYYYMM.length - 2), 10);
    const westernYear = rocYear + 1911;
    const quarter     = Math.ceil(month / 3);
    period = `${westernYear}Q${quarter}`;
  } else {
    const now = new Date();
    period = `${now.getFullYear()}Q${Math.ceil((now.getMonth() + 1) / 3)}`;
  }

  for (const r of records) {
    try {
      await queryUnsafe(
        `INSERT INTO fundamentals (symbol, period, revenue_growth_yoy)
         VALUES ($1, $2, $3)
         ON CONFLICT (symbol, period) DO UPDATE
           SET revenue_growth_yoy = EXCLUDED.revenue_growth_yoy`,
        [r.symbol, period, r.yoy_growth],
      );
      count++;
    } catch (err) {
      const msg = `[ingestMonthlyRevenue] Failed to upsert ${r.symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`[ingestMonthlyRevenue] Done. Upserted ${count} rows under period ${period}, ${errors.length} errors.`);
  return { count, errors };
}
// =============================================================================
// ingestFinancialStatements — fetches quarterly EPS, net income, and equity
// from FinMind for a batch of stocks, computes eps_growth_yoy (vs. same
// quarter one year ago) and roe, and saves both into the fundamentals table.
//
// Self-resuming: instead of offset/limit pagination, each call picks the next
// batch of stocks that don't have eps_growth_yoy filled in yet. Call this
// repeatedly (e.g. via a recurring cron-job.org job, same pattern as
// update-signals) and it naturally works through the full ~1,100-stock list
// over time without needing to track progress yourself. Note: ETFs and a few
// other symbols will never have this data (FinMind has none for them) — they
// get retried harmlessly on every call, which costs a wasted API call each
// time but doesn't block progress on real stocks.
// =============================================================================

export async function ingestFinancialStatements(
  limit: number,
): Promise<IngestResult & { remaining: number }> {
  const errors: string[] = [];
  let count = 0;

  const remainingRow = await queryUnsafe<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM stocks s
     WHERE s.market IN ('TWSE', 'TPEx') AND s.symbol NOT LIKE '00%' AND s.symbol NOT LIKE '00%'
       AND NOT EXISTS (
         SELECT 1 FROM fundamentals f
         WHERE f.symbol = s.symbol AND f.eps_growth_yoy IS NOT NULL
       )`,
    [],
  );
  const remainingBefore = parseInt(remainingRow[0]?.cnt ?? '0', 10);

  const stockRows = await queryUnsafe<{ symbol: string }>(
    `SELECT s.symbol FROM stocks s
     WHERE s.market IN ('TWSE', 'TPEx') AND s.symbol NOT LIKE '00%' AND s.symbol NOT LIKE '00%'
       AND NOT EXISTS (
         SELECT 1 FROM fundamentals f
         WHERE f.symbol = s.symbol AND f.eps_growth_yoy IS NOT NULL
       )
     ORDER BY RANDOM()
     LIMIT $1`,
    [limit],
  );

  console.log(`[ingestFinancialStatements] Processing ${stockRows.length} stocks (${remainingBefore} remaining before this batch)…`);

  for (const { symbol } of stockRows) {
    try {
      const quarters = await fetchStockFinancials(symbol);
      if (quarters.length === 0) {
        errors.push(`No financial data returned for ${symbol}`);
        await sleep(150);
        continue;
      }

      const latest = quarters[quarters.length - 1];

      // Find the same fiscal quarter one year earlier (exact date match,
      // since quarter-end dates are consistent, e.g. "2025-09-30" → "2024-09-30")
      const latestDate = new Date(latest.date);
      const priorYearDate = new Date(latestDate);
      priorYearDate.setFullYear(priorYearDate.getFullYear() - 1);
      const priorDateStr = priorYearDate.toISOString().slice(0, 10);
      const prior = quarters.find(q => q.date === priorDateStr);

      const epsGrowth =
        prior?.eps != null && latest.eps != null && prior.eps !== 0
          ? Math.round(((latest.eps - prior.eps) / Math.abs(prior.eps)) * 10000) / 100
          : null;

      const roe =
        latest.netIncome != null && latest.equity != null && latest.equity !== 0
          ? Math.round((latest.netIncome / latest.equity) * 10000) / 100
          : null;

      // Derive fiscal quarter period from the latest report's own date
      const [yearStr, monthStr] = latest.date.split('-');
      const period = `${yearStr}Q${Math.ceil(parseInt(monthStr, 10) / 3)}`;

      await queryUnsafe(
        `INSERT INTO fundamentals (symbol, period, eps_growth_yoy, roe)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol, period) DO UPDATE
           SET eps_growth_yoy = COALESCE($3, fundamentals.eps_growth_yoy),
               roe            = COALESCE($4, fundamentals.roe)`,
        [symbol, period, epsGrowth, roe],
      );
      count++;
    } catch (err) {
      const msg = `[ingestFinancialStatements] Failed for ${symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }

    // Pace requests to stay comfortably under FinMind's rate limit
    await sleep(150);
  }

  const remaining = Math.max(0, remainingBefore - count);
  console.log(`[ingestFinancialStatements] Done. Upserted ${count}/${stockRows.length} rows, ${errors.length} errors, ${remaining} still remaining.`);
  return { count, errors, remaining };
}

// =============================================================================
// ingestBalanceSheetFinMind — replaces the old MOPS-based
// ingestFundamentalsBalanceSheet(). The MOPS ajax_t164sb03 (balance sheet)
// and ajax_t05st22 (book value) endpoints are behind a referer-wall that
// blocks automated requests (confirmed for ajax_t05st22, suspected for
// ajax_t164sb03 — see Session 74 notes). This uses FinMind instead:
//   - pb_ratio comes directly from FinMind's TaiwanStockPER dataset (PBR
//     column) — no need to compute book value per share ourselves.
//   - debt_ratio is computed from FinMind's TaiwanStockBalanceSheet dataset
//     (totalLiabilities / totalAssets × 100).
//
// Self-resuming, same pattern as ingestFinancialStatements: each call picks
// the next batch of stocks missing both debt_ratio and pb_ratio. Call
// repeatedly (e.g. via a recurring cron-job.org job) to work through the
// full list over time without tracking an offset yourself.
// =============================================================================

export async function ingestBalanceSheetFinMind(
  limit: number,
): Promise<IngestResult & { remaining: number }> {
  const errors: string[] = [];
  let count = 0;

  const remainingRow = await queryUnsafe<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM stocks s
     WHERE s.market IN ('TWSE', 'TPEx') AND s.symbol NOT LIKE '00%' AND s.symbol NOT LIKE '00%'
       AND NOT EXISTS (
         SELECT 1 FROM fundamentals f
         WHERE f.symbol = s.symbol
           AND (f.debt_ratio IS NOT NULL OR f.pb_ratio IS NOT NULL)
       )`,
    [],
  );
  const remainingBefore = parseInt(remainingRow[0]?.cnt ?? '0', 10);

  const stockRows = await queryUnsafe<{ symbol: string }>(
    `SELECT s.symbol FROM stocks s
     WHERE s.market IN ('TWSE', 'TPEx') AND s.symbol NOT LIKE '00%' AND s.symbol NOT LIKE '00%'
       AND NOT EXISTS (
         SELECT 1 FROM fundamentals f
         WHERE f.symbol = s.symbol
           AND (f.debt_ratio IS NOT NULL OR f.pb_ratio IS NOT NULL)
       )
     ORDER BY RANDOM()
     LIMIT $1`,
    [limit],
  );

  console.log(`[ingestBalanceSheetFinMind] Processing ${stockRows.length} stocks (${remainingBefore} remaining before this batch)…`);

  for (const { symbol } of stockRows) {
    try {
      const [pbrData, balanceSheets] = await Promise.all([
        fetchLatestPBR(symbol),
        fetchStockBalanceSheet(symbol),
      ]);

      const pbRatio = pbrData?.pbr ?? null;
      // Note: pe_ratio is intentionally left untouched here — it's already
      // populated by ingestFundamentals() from TWSE's daily data, which is
      // more current than FinMind's PER for this purpose.

      const latestBS = balanceSheets[balanceSheets.length - 1];
      const debtRatio =
        latestBS?.totalAssets != null && latestBS?.totalLiabilities != null && latestBS.totalAssets !== 0
          ? Math.round((latestBS.totalLiabilities / latestBS.totalAssets) * 10000) / 100
          : null;

      if (pbRatio === null && debtRatio === null) {
        errors.push(`No PBR or balance sheet data for ${symbol}`);
        await sleep(150);
        continue;
      }

      // Use the balance sheet's own reporting date for the period if we have
      // one; otherwise fall back to the PBR snapshot's date's quarter.
      const periodSourceDate = latestBS?.date ?? pbrData?.date;
      let period: string;
      if (periodSourceDate) {
        const [yearStr, monthStr] = periodSourceDate.split('-');
        period = `${yearStr}Q${Math.ceil(parseInt(monthStr, 10) / 3)}`;
      } else {
        const now = new Date();
        period = `${now.getFullYear()}Q${Math.ceil((now.getMonth() + 1) / 3)}`;
      }

      await queryUnsafe(
        `INSERT INTO fundamentals (symbol, period, debt_ratio, pb_ratio)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol, period) DO UPDATE
           SET debt_ratio = COALESCE($3, fundamentals.debt_ratio),
               pb_ratio   = COALESCE($4, fundamentals.pb_ratio)`,
        [symbol, period, debtRatio, pbRatio],
      );
      count++;
    } catch (err) {
      const msg = `[ingestBalanceSheetFinMind] Failed for ${symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }

    await sleep(150);
  }

  const remaining = Math.max(0, remainingBefore - count);
  console.log(`[ingestBalanceSheetFinMind] Done. Upserted ${count}/${stockRows.length} rows, ${errors.length} errors, ${remaining} still remaining.`);
  return { count, errors, remaining };
}