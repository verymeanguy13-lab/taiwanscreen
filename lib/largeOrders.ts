// =============================================================================
// lib/largeOrders.ts
// REBUILT — no longer scrapes TWSE TWT38U (that endpoint is a market-wide
// foreign-buying table, not broker-level data — see Session 62 notes).
//
// Now reads from institutional_flows, which already has correct per-stock
// foreign/trust/dealer net buy-sell figures and pre-computed streak columns.
//
// ASSUMPTION: lib/db.ts exports a Neon tagged-template client as `sql`
// (standard @neondatabase/serverless pattern). Adjust the import below if
// your actual db client differs.
// =============================================================================

import { sql } from '@/lib/db';

export type DailyFlow = {
  symbol:                  string;
  date:                    string;  // YYYY-MM-DD
  foreignNet:              number;  // 張 (lots)
  trustNet:                number;
  dealerNet:               number;
  totalNet:                number;
  foreignConsecutiveDays:  number;
  trustConsecutiveDays:    number;
  tripleBuy:               boolean;
};

export type MarketRank = {
  date:         string;
  symbol:       string;
  rank:         number;
  totalStocks:  number;
  foreignNet:   number;   // 張
  percentile:   number;   // 0–100, higher = more foreign buying than peers
};

const SHARES_PER_LOT = 1_000;

function toLots(shares: number | string | null | undefined): number {
  const n = Number(shares ?? 0);
  return Math.round(n / SHARES_PER_LOT);
}

// ---------------------------------------------------------------------------
// fetchStockFlows — this stock's own daily foreign/trust/dealer net buy-sell
// over the last N trading days present in the DB.
// ---------------------------------------------------------------------------
export async function fetchStockFlows(
  symbol: string,
  days: number = 5,
): Promise<DailyFlow[]> {
  const limit = Math.min(Math.max(days, 1), 30);

  const rows = await sql`
    SELECT
      symbol,
      date,
      foreign_net,
      trust_net,
      dealer_net,
      total_net,
      foreign_consecutive_days,
      trust_consecutive_days,
      triple_buy
    FROM institutional_flows
    WHERE symbol = ${symbol}
    ORDER BY date DESC
    LIMIT ${limit}
  `;

  return (rows as any[]).map((r) => ({
    symbol:                 r.symbol,
    date:                   typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10),
    foreignNet:             toLots(r.foreign_net),
    trustNet:               toLots(r.trust_net),
    dealerNet:              toLots(r.dealer_net),
    totalNet:               toLots(r.total_net),
    foreignConsecutiveDays: Number(r.foreign_consecutive_days ?? 0),
    trustConsecutiveDays:   Number(r.trust_consecutive_days ?? 0),
    tripleBuy:              Boolean(r.triple_buy),
  }));
}

// ---------------------------------------------------------------------------
// fetchMarketRank — where this stock ranks today (or its most recent trading
// day in the DB) among ALL stocks by foreign net buying. Complements the
// market-wide /institutional page rather than duplicating it.
// ---------------------------------------------------------------------------
export async function fetchMarketRank(symbol: string): Promise<MarketRank | null> {
  // Most recent date this symbol has a row for.
  const latest = await sql`
    SELECT date
    FROM institutional_flows
    WHERE symbol = ${symbol}
    ORDER BY date DESC
    LIMIT 1
  `;

  if ((latest as any[]).length === 0) return null;

  const date = (latest as any[])[0].date;

  const ranked = await sql`
    WITH ranked AS (
      SELECT
        symbol,
        foreign_net,
        RANK() OVER (ORDER BY foreign_net DESC) AS rank,
        COUNT(*) OVER () AS total_stocks
      FROM institutional_flows
      WHERE date = ${date}
    )
    SELECT * FROM ranked WHERE symbol = ${symbol}
  `;

  if ((ranked as any[]).length === 0) return null;

  const r = (ranked as any[])[0];
  const rank = Number(r.rank);
  const total = Number(r.total_stocks);

  return {
    date:        typeof date === 'string' ? date : new Date(date).toISOString().slice(0, 10),
    symbol,
    rank,
    totalStocks: total,
    foreignNet:  toLots(r.foreign_net),
    percentile:  total > 1 ? Math.round((1 - (rank - 1) / (total - 1)) * 100) : 100,
  };
}