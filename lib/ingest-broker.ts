// lib/ingest-broker.ts
//
// Fetches TWSE broker branch transaction data (分點券商) per stock.
//
// IMPORTANT: TWSE TWT38U returns data per-stock, so we can't ingest all ~900
// stocks in one Vercel function call. Strategy: ingest only the top N stocks
// by recent volume. This keeps the function under 60s while covering the
// most actionable stocks.
//
// Called from: app/api/admin/seed-broker/route.ts

import { neon } from '@neondatabase/serverless';
import { parseBrokerFlowText, parseBrokerCSV } from './broker-parser';

const sql = neon(process.env.DATABASE_URL!);

function toTWSEDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// Fetch the top N symbols by recent volume from daily_prices
async function getTopSymbols(limit = 150): Promise<string[]> {
  const rows = await sql`
    SELECT symbol
    FROM daily_prices
    WHERE date = (SELECT MAX(date) FROM daily_prices)
    ORDER BY volume DESC
    LIMIT ${limit}
  `;
  return rows.map((r: { symbol: string }) => r.symbol);
}

// Fetch broker transaction data for one stock on one date from TWSE TWT38U
async function fetchBrokerData(symbol: string, twseDate: string): Promise<string | null> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/TWT38U?response=json&stockNo=${symbol}&date=${twseDate}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    // TWT38U returns { stat, title, data: string[][] }
    if (json.stat !== 'OK' || !json.data) return null;
    // Convert JSON data array back to text format for the existing parser
    // Format: each row is [broker_id, broker_name, buy_volume, sell_volume]
    const lines: string[] = [`${symbol} placeholder`]; // stock header
    for (const row of json.data as string[][]) {
      if (row.length >= 4) {
        lines.push(row.join('\t'));
      }
    }
    return lines.join('\n');
  } catch {
    return null;
  }
}

// Parse TWT38U JSON response directly (more reliable than text parsing)
interface BrokerFlowRaw {
  symbol: string;
  broker_id: string;
  broker_name: string;
  buy_volume: number;
  sell_volume: number;
  net_volume: number;
}

async function fetchBrokerDataJSON(symbol: string, twseDate: string): Promise<BrokerFlowRaw[]> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/TWT38U?response=json&stockNo=${symbol}&date=${twseDate}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    if (json.stat !== 'OK' || !json.data) return [];

    const results: BrokerFlowRaw[] = [];
    for (const row of json.data as string[][]) {
      if (row.length < 4) continue;
      const broker_id   = row[0]?.trim();
      const broker_name = row[1]?.trim();
      const buy_volume  = parseInt(String(row[2]).replace(/,/g, '')) || 0;
      const sell_volume = parseInt(String(row[3]).replace(/,/g, '')) || 0;
      if (!broker_id || (buy_volume === 0 && sell_volume === 0)) continue;
      results.push({
        symbol,
        broker_id,
        broker_name,
        buy_volume,
        sell_volume,
        net_volume: buy_volume - sell_volume,
      });
    }
    return results;
  } catch {
    return [];
  }
}

// Upsert broker_branches (name registry)
async function upsertBrokerBranches(rows: BrokerFlowRaw[]): Promise<void> {
  const seen = new Map<string, string>();
  for (const r of rows) {
    if (!seen.has(r.broker_id)) seen.set(r.broker_id, r.broker_name);
  }
  for (const [broker_id, broker_name] of seen) {
    await sql`
      INSERT INTO broker_branches (broker_id, broker_name)
      VALUES (${broker_id}, ${broker_name})
      ON CONFLICT (broker_id) DO UPDATE SET broker_name = EXCLUDED.broker_name
    `;
  }
}

// Upsert broker_flows for one stock + date
async function upsertBrokerFlows(rows: BrokerFlowRaw[], isoDate: string): Promise<number> {
  let count = 0;
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO broker_flows (symbol, date, broker_id, buy_volume, sell_volume, net_volume)
        VALUES (${r.symbol}, ${isoDate}, ${r.broker_id}, ${r.buy_volume}, ${r.sell_volume}, ${r.net_volume})
        ON CONFLICT (symbol, date, broker_id) DO UPDATE SET
          buy_volume  = EXCLUDED.buy_volume,
          sell_volume = EXCLUDED.sell_volume,
          net_volume  = EXCLUDED.net_volume
      `;
      count++;
    } catch {
      // Skip if broker_id not in broker_branches (FK violation) — will be inserted next run
    }
  }
  return count;
}

export interface BrokerIngestResult {
  date: string;
  symbolsProcessed: number;
  rowsInserted: number;
  errors: string[];
}

export async function ingestBrokerFlows(
  date: Date,
  symbolLimit = 150
): Promise<BrokerIngestResult> {
  const isoDate  = date.toISOString().split('T')[0];
  const twseDate = toTWSEDate(date);
  const errors: string[] = [];

  const symbols = await getTopSymbols(symbolLimit);
  if (symbols.length === 0) {
    return { date: isoDate, symbolsProcessed: 0, rowsInserted: 0, errors: ['No symbols found in daily_prices'] };
  }

  let totalRows = 0;
  let symbolsProcessed = 0;

  for (const symbol of symbols) {
    const rows = await fetchBrokerDataJSON(symbol, twseDate);
    if (rows.length === 0) {
      // No data for this symbol on this date — skip silently
      continue;
    }

    // Upsert broker name registry first
    await upsertBrokerBranches(rows);

    // Then upsert flows
    const inserted = await upsertBrokerFlows(rows, isoDate);
    totalRows += inserted;
    symbolsProcessed++;

    // Polite delay — TWSE rate limits aggressively
    await new Promise(r => setTimeout(r, 300));
  }

  return {
    date: isoDate,
    symbolsProcessed,
    rowsInserted: totalRows,
    errors,
  };
}