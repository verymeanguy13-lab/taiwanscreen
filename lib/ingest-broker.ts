// lib/ingest-broker.ts

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

function toTWSEDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function getTopSymbols(limit = 50, offset = 0): Promise<string[]> {
  const rows = await sql`
    SELECT symbol
    FROM daily_prices
    WHERE date = (SELECT MAX(date) FROM daily_prices)
    ORDER BY volume DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows.map((r: any) => r.symbol as string);
}

interface BrokerFlowRaw {
  symbol:      string;
  broker_id:   string;
  broker_name: string;
  buy_volume:  number;
  sell_volume: number;
  net_volume:  number;
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
      if (!broker_id || !broker_name) continue;
      if (buy_volume === 0 && sell_volume === 0) continue;
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

export interface BrokerIngestResult {
  date:             string;
  symbolsProcessed: number;
  rowsInserted:     number;
  offset:           number;
  errors:           string[];
}

export async function ingestBrokerFlows(
  date: Date,
  symbolLimit = 50,
  offset = 0,
): Promise<BrokerIngestResult> {
  const isoDate  = date.toISOString().split('T')[0];
  const twseDate = toTWSEDate(date);
  const errors: string[] = [];

  const symbols = await getTopSymbols(symbolLimit, offset);
  if (symbols.length === 0) {
    return { date: isoDate, symbolsProcessed: 0, rowsInserted: 0, offset, errors: ['No symbols found'] };
  }

  // ── Phase 1: fetch all data first ────────────────────────────────────────
  const allRows: BrokerFlowRaw[] = [];
  let symbolsProcessed = 0;

  for (const symbol of symbols) {
    const rows = await fetchBrokerDataJSON(symbol, twseDate);
    if (rows.length > 0) {
      allRows.push(...rows);
      symbolsProcessed++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (allRows.length === 0) {
    return { date: isoDate, symbolsProcessed: 0, rowsInserted: 0, offset, errors: ['No data returned from TWSE'] };
  }

  // ── Phase 2: upsert ALL broker_branches first (no FK violation possible) ─
  const branchMap = new Map<string, string>();
  for (const r of allRows) {
    if (!branchMap.has(r.broker_id)) branchMap.set(r.broker_id, r.broker_name);
  }

  for (const [broker_id, broker_name] of branchMap) {
    try {
      await sql`
        INSERT INTO broker_branches (broker_id, broker_name)
        VALUES (${broker_id}, ${broker_name})
        ON CONFLICT (broker_id) DO UPDATE SET broker_name = EXCLUDED.broker_name
      `;
    } catch (e) {
      errors.push(`branch upsert failed for ${broker_id}: ${e}`);
    }
  }

  // ── Phase 3: upsert broker_flows (branches now guaranteed to exist) ──────
  let rowsInserted = 0;
  for (const r of allRows) {
    try {
      await sql`
        INSERT INTO broker_flows (symbol, date, broker_id, buy_volume, sell_volume, net_volume)
        VALUES (${r.symbol}, ${isoDate}, ${r.broker_id}, ${r.buy_volume}, ${r.sell_volume}, ${r.net_volume})
        ON CONFLICT (symbol, date, broker_id) DO UPDATE SET
          buy_volume  = EXCLUDED.buy_volume,
          sell_volume = EXCLUDED.sell_volume,
          net_volume  = EXCLUDED.net_volume
      `;
      rowsInserted++;
    } catch (e) {
      errors.push(`flow insert failed ${r.symbol}/${r.broker_id}: ${e}`);
    }
  }

  return { date: isoDate, symbolsProcessed, rowsInserted, offset, errors };
}