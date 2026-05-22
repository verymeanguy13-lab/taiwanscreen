// =============================================================================
// lib/ingest.ts — TWSE data ingestion pipeline
// Fetches from TWSE APIs and upserts into Neon PostgreSQL.
// =============================================================================

import { queryUnsafe } from '@/lib/db';
import {
  fetchStockList,
  fetchAllStockPrices,
  fetchInstitutionalFlows,
  fetchMarginData,
} from '@/lib/twse';

type IngestResult = { count: number; errors: string[] };

// -----------------------------------------------------------------------------
// 1. ingestStockList
// -----------------------------------------------------------------------------

export async function ingestStockList(): Promise<IngestResult> {
  console.log('[ingestStockList] Fetching stock list from TWSE…');
  const errors: string[] = [];
  let count = 0;

  const stocks = await fetchStockList();
  console.log(`[ingestStockList] Fetched ${stocks.length} stocks.`);

  for (const stock of stocks) {
    try {
      await queryUnsafe(
        `INSERT INTO stocks (symbol, name_zh, sector, market)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol) DO UPDATE
           SET name_zh = EXCLUDED.name_zh,
               sector  = EXCLUDED.sector`,
        [stock.symbol, stock.name_zh, stock.sector ?? null, 'TWSE'],
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

// -----------------------------------------------------------------------------
// 2. ingestDailyPrices
// -----------------------------------------------------------------------------

export async function ingestDailyPrices(date: string): Promise<IngestResult> {
  console.log(`[ingestDailyPrices] Fetching prices for ${date}…`);
  const errors: string[] = [];
  let count = 0;

  const prices = await fetchAllStockPrices();
  console.log(`[ingestDailyPrices] Fetched ${prices.length} price records.`);

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

// -----------------------------------------------------------------------------
// 3. ingestInstitutionalFlows
// -----------------------------------------------------------------------------

export async function ingestInstitutionalFlows(date: string): Promise<IngestResult> {
  console.log(`[ingestInstitutionalFlows] Fetching institutional flows for ${date}…`);
  const errors: string[] = [];
  let count = 0;

  const flows = await fetchInstitutionalFlows();
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

  // Mark triple_buy for this date
  console.log(`[ingestInstitutionalFlows] Computing triple_buy for ${date}…`);
  try {
    await queryUnsafe(
      `UPDATE institutional_flows
       SET triple_buy = (foreign_net > 0 AND trust_net > 0 AND dealer_net > 0)
       WHERE date = $1`,
      [date],
    );
  } catch (err) {
    const msg = `[ingestInstitutionalFlows] Failed to compute triple_buy: ${err}`;
    console.error(msg);
    errors.push(msg);
  }

  // Compute consecutive days streaks
  console.log(`[ingestInstitutionalFlows] Computing consecutive days for ${date}…`);
  await computeConsecutiveDays(date);

  console.log(`[ingestInstitutionalFlows] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}

// -----------------------------------------------------------------------------
// 4. computeConsecutiveDays
// -----------------------------------------------------------------------------

export async function computeConsecutiveDays(date: string): Promise<void> {
  console.log(`[computeConsecutiveDays] Starting for date ${date}…`);

  try {
    // Get all symbols that have a record on this date
    const symbols = await queryUnsafe<{ symbol: string }>(
      `SELECT DISTINCT symbol FROM institutional_flows WHERE date = $1`,
      [date],
    );

    console.log(`[computeConsecutiveDays] Processing ${symbols.length} symbols…`);

    for (const { symbol } of symbols) {
      try {
        // Fetch the last 60 days for this symbol, newest first
        const rows = await queryUnsafe<{
          date: string;
          foreign_net: number;
          trust_net: number;
        }>(
          `SELECT date, foreign_net, trust_net
           FROM institutional_flows
           WHERE symbol = $1
             AND date <= $2
           ORDER BY date DESC
           LIMIT 60`,
          [symbol, date],
        );

        if (rows.length === 0) continue;

        // Count foreign consecutive days
        let foreignStreak = 0;
        const firstForeignPositive = (rows[0].foreign_net ?? 0) > 0;
        for (const row of rows) {
          const positive = (row.foreign_net ?? 0) > 0;
          if (positive === firstForeignPositive) {
            foreignStreak += firstForeignPositive ? 1 : -1;
          } else {
            break;
          }
        }

        // Count trust consecutive days
        let trustStreak = 0;
        const firstTrustPositive = (rows[0].trust_net ?? 0) > 0;
        for (const row of rows) {
          const positive = (row.trust_net ?? 0) > 0;
          if (positive === firstTrustPositive) {
            trustStreak += firstTrustPositive ? 1 : -1;
          } else {
            break;
          }
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

    console.log(`[computeConsecutiveDays] Done.`);
  } catch (err) {
    console.error(`[computeConsecutiveDays] Fatal error: ${err}`);
  }
}

// -----------------------------------------------------------------------------
// 5. ingestMarginData
// -----------------------------------------------------------------------------

export async function ingestMarginData(date: string): Promise<IngestResult> {
  console.log(`[ingestMarginData] Fetching margin data for ${date}…`);
  const errors: string[] = [];
  let count = 0;

  const records = await fetchMarginData();
  console.log(`[ingestMarginData] Fetched ${records.length} records.`);

  for (const m of records) {
    try {
      const margin_ratio =
        m.margin_balance + m.short_balance > 0
          ? (m.margin_balance / (m.margin_balance + m.short_balance)) * 100
          : 0;

      await queryUnsafe(
        `INSERT INTO margin_data
           (symbol, date, margin_balance, margin_change,
            short_balance, short_change, margin_ratio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (symbol, date) DO UPDATE
           SET margin_balance = EXCLUDED.margin_balance,
               margin_change  = EXCLUDED.margin_change,
               short_balance  = EXCLUDED.short_balance,
               short_change   = EXCLUDED.short_change,
               margin_ratio   = EXCLUDED.margin_ratio`,
        [
          m.symbol, date,
          m.margin_balance, m.margin_change,
          m.short_balance,  m.short_change,
          Math.round(margin_ratio * 100) / 100,
        ],
      );
      count++;
    } catch (err) {
      const msg = `[ingestMarginData] Failed to upsert ${m.symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`[ingestMarginData] Done. Upserted ${count} rows, ${errors.length} errors.`);
  return { count, errors };
}