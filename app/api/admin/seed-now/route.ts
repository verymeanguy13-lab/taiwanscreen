/**
 * app/api/admin/seed-now/route.ts
 *
 * Trigger institutional + margin + prices backfill from the browser or curl.
 * Protected by CRON_SECRET header.
 *
 * Usage:
 *   curl -X POST https://taiwanscreen.vercel.app/api/admin/seed-now \
 *     -H "x-cron-secret: mysecret123" \
 *     -H "Content-Type: application/json" \
 *     -d '{"days": 30}'
 */

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { ingestDailyPrices } from "@/lib/ingest";

const sql = neon(process.env.DATABASE_URL!);

function toTWSEDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

function pastBusinessDays(n: number): Date[] {
  const days: Date[] = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(d));
  }
  return days.reverse();
}

async function fetchTWSEInstitutional(date: string) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${date}&selectType=ALLBUT0999`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.stat !== "OK" || !json.data) return null;
    return json.data as string[][];
  } catch {
    return null;
  }
}

async function fetchTWSEMargin(date: string) {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${date}&selectType=ALL`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.stat !== "OK") return null;
    return json as { tables: Array<{ data: string[][] }> };
  } catch {
    return null;
  }
}

const clean = (s: string) => parseInt(s.replace(/,/g, "").trim()) || 0;

async function ingestInstitutional(date: Date): Promise<number> {
  const rows = await fetchTWSEInstitutional(toTWSEDate(date));
  if (!rows) return 0;
  const isoDate = toISO(date);
  let count = 0;

  for (const row of rows) {
    if (row.length < 15) continue;
    const symbol = row[0].trim();
    if (!symbol || symbol.length > 6) continue;

    const foreign_buy = clean(row[2]);
    const foreign_sell = clean(row[3]);
    const foreign_net = clean(row[4]);
    const trust_buy = clean(row[5]);
    const trust_sell = clean(row[6]);
    const trust_net = clean(row[7]);
    const dealer_buy = clean(row[8]) + clean(row[11]);
    const dealer_sell = clean(row[9]) + clean(row[12]);
    const dealer_net = clean(row[10]) + clean(row[13]);
    const total_net = clean(row[14]);
    const triple_buy = foreign_net > 0 && trust_net > 0 && dealer_net > 0;

    try {
      await sql`
        INSERT INTO institutional_flows
          (symbol, date, foreign_buy, foreign_sell, foreign_net,
           trust_buy, trust_sell, trust_net,
           dealer_buy, dealer_sell, dealer_net,
           total_net, triple_buy)
        VALUES (${symbol}, ${isoDate}, ${foreign_buy}, ${foreign_sell}, ${foreign_net},
                ${trust_buy}, ${trust_sell}, ${trust_net},
                ${dealer_buy}, ${dealer_sell}, ${dealer_net},
                ${total_net}, ${triple_buy})
        ON CONFLICT (symbol, date) DO UPDATE SET
          foreign_buy = EXCLUDED.foreign_buy, foreign_sell = EXCLUDED.foreign_sell,
          foreign_net = EXCLUDED.foreign_net, trust_buy = EXCLUDED.trust_buy,
          trust_sell = EXCLUDED.trust_sell, trust_net = EXCLUDED.trust_net,
          dealer_buy = EXCLUDED.dealer_buy, dealer_sell = EXCLUDED.dealer_sell,
          dealer_net = EXCLUDED.dealer_net, total_net = EXCLUDED.total_net,
          triple_buy = EXCLUDED.triple_buy
      `;
      count++;
    } catch {}
  }

  // Recompute consecutive days for this date
  await sql`
    UPDATE institutional_flows i
    SET foreign_consecutive_days = (
      SELECT COALESCE((
        SELECT COUNT(*) FROM generate_series(1, 60) gs
        WHERE NOT EXISTS (
          SELECT 1 FROM institutional_flows
          WHERE symbol = i.symbol
            AND date = (i.date - (gs * INTERVAL '1 day')::interval)::date
            AND foreign_net <= 0
        )
        AND EXISTS (
          SELECT 1 FROM institutional_flows
          WHERE symbol = i.symbol
            AND date <= i.date - ((gs-1) * INTERVAL '1 day')::interval
            AND date >= i.date - (gs * INTERVAL '1 day')::interval
        )
        LIMIT 1
      ), 0)
    )
    WHERE i.date = ${isoDate}
      AND i.foreign_net > 0
  `;

  return count;
}

async function ingestMargin(date: Date): Promise<number> {
  const data = await fetchTWSEMargin(toTWSEDate(date));
  if (!data?.tables) return 0;
  const isoDate = toISO(date);

  const marginMap = new Map<string, { balance: number; change: number }>();
  for (const row of data.tables[0]?.data ?? []) {
    const symbol = row[0]?.trim();
    if (!symbol || symbol.length > 6) continue;
    const balance = clean(row[6]);
    marginMap.set(symbol, { balance, change: balance - clean(row[2]) });
  }

  const shortMap = new Map<string, { balance: number; change: number }>();
  for (const row of data.tables[1]?.data ?? []) {
    const symbol = row[0]?.trim();
    if (!symbol || symbol.length > 6) continue;
    const balance = clean(row[6]);
    shortMap.set(symbol, { balance, change: balance - clean(row[2]) });
  }

  const symbols = new Set([...marginMap.keys(), ...shortMap.keys()]);
  let count = 0;

  for (const symbol of symbols) {
    const m = marginMap.get(symbol) ?? { balance: 0, change: 0 };
    const s = shortMap.get(symbol) ?? { balance: 0, change: 0 };
    const total = m.balance + s.balance;
    const margin_ratio =
      total > 0 ? Math.round((m.balance / total) * 10000) / 100 : 0;

    try {
      await sql`
        INSERT INTO margin_data
          (symbol, date, margin_balance, margin_change, short_balance, short_change, margin_ratio)
        VALUES (${symbol}, ${isoDate}, ${m.balance}, ${m.change}, ${s.balance}, ${s.change}, ${margin_ratio})
        ON CONFLICT (symbol, date) DO UPDATE SET
          margin_balance = EXCLUDED.margin_balance, margin_change = EXCLUDED.margin_change,
          short_balance = EXCLUDED.short_balance, short_change = EXCLUDED.short_change,
          margin_ratio = EXCLUDED.margin_ratio
      `;
      count++;
    } catch {}
  }

  return count;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const days = Math.min(Math.max(parseInt(body.days) || 5, 1), 60);
  const businessDays = pastBusinessDays(days);

  const results: Record<string, { institutional: number; margin: number; prices: number }> = {};

  for (const day of businessDays) {
    const isoDate = toISO(day);
    const [inst, marg, prices] = await Promise.all([
      ingestInstitutional(day),
      ingestMargin(day),
      ingestDailyPrices(isoDate).catch(() => ({ count: 0, errors: [] })),
    ]);
    results[isoDate] = { institutional: inst, margin: marg, prices: prices.count };
    // polite delay
    await new Promise((r) => setTimeout(r, 800));
  }

  return NextResponse.json({
    ok: true,
    daysProcessed: businessDays.length,
    results,
  });
}

// Also support GET for quick single-day check
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [instCount] = await sql`SELECT COUNT(*) as n FROM institutional_flows`;
  const [margCount] = await sql`SELECT COUNT(*) as n FROM margin_data`;
  const [latestInst] = await sql`SELECT MAX(date) as d FROM institutional_flows`;
  const [latestMarg] = await sql`SELECT MAX(date) as d FROM margin_data`;
  const [latestPrices] = await sql`SELECT MAX(date) as d FROM daily_prices`;

  return NextResponse.json({
    institutional_flows_rows: instCount.n,
    margin_data_rows: margCount.n,
    latest_institutional_date: latestInst.d,
    latest_margin_date: latestMarg.d,
    latest_prices_date: latestPrices.d,
  });
}