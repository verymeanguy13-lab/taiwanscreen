// =============================================================================
// app/api/admin/sox-signal-check/route.ts
//
// Tests, in BOTH directions:
//   BULL: Dow + S&P 500 + Nasdaq + SOX all closed UP, AND TX night futures
//         session closed UP -> did 0050 gap UP at next day's open?
//   BEAR: Dow + S&P 500 + Nasdaq + SOX all closed DOWN, AND TX night futures
//         session closed DOWN -> did 0050 gap DOWN at next day's open?
//
// IMPORTANT — what this measures vs. what it doesn't:
// This checks 0050's daily OPEN vs the PRIOR day's CLOSE (a "gap" test), not
// the literal first-15-minutes price move — no free historical intraday
// (minute-level) data source for 0050 was found. Say so if you share these
// numbers anywhere.
//
// Data sources:
//   - 0050 daily open/close: your own `daily_prices` table
//   - TX night session open/close: FinMind `TaiwanFuturesDaily`, via the
//     existing FINMIND_TOKEN env var already used elsewhere in this repo
//   - Dow/S&P/Nasdaq/SOX daily closes: Stooq's free CSV endpoint (no key)
//
// TWO UNVERIFIED ASSUMPTIONS (flagged, not silently assumed correct — check
// both via ?debug=1 before trusting the numbers):
//   1. FinMind night-session date convention — same caveat as before: a
//      night-session row dated `date` is assumed to be the session that
//      feeds into that same date's day-session/open.
//   2. Stooq ticker symbols for the 4 indices: ^dji (Dow), ^spx (S&P 500),
//      ^ndq (Nasdaq Composite), ^sox (Philadelphia Semiconductor). These are
//      Stooq's standard US index tickers but have not been fetched and
//      eyeballed here. In debug mode, check `indexLatestSample` — the
//      magnitudes should look like: Dow ~40,000s, S&P 500 ~5,000-6,000s,
//      Nasdaq Composite ~17,000-20,000s, SOX ~5,000-6,000s. If any of them
//      look off by orders of magnitude or come back empty, the ticker is
//      wrong — tell me and I'll fix it.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface DailyPriceRow {
  date: string;
  open: number | null;
  close: number | null;
}

interface FinMindTXRow {
  date: string;
  trading_session: string; // 'position' | 'after_market'
  open: number;
  close: number;
}

interface StooqRow {
  date: string;
  close: number;
}

const INDICES = [
  { key: 'dji', ticker: '^dji', label: 'Dow Jones' },
  { key: 'spx', ticker: '^spx', label: 'S&P 500' },
  { key: 'ndq', ticker: '^ndq', label: 'Nasdaq Composite' },
  { key: 'sox', ticker: '^sox', label: 'Philadelphia Semiconductor (SOX)' },
] as const;

async function fetchStooqDaily(ticker: string): Promise<StooqRow[]> {
  const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`);
  if (!res.ok) throw new Error(`Stooq fetch failed for ${ticker}: ${res.status}`);
  const csv = await res.text();
  const lines = csv.trim().split('\n').slice(1);
  const rows: StooqRow[] = [];
  for (const line of lines) {
    const parts = line.split(',');
    const date = parts[0];
    const close = parseFloat(parts[4]);
    if (date && !Number.isNaN(close)) rows.push({ date, close });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

async function fetchTxFuturesDaily(startDate: string): Promise<FinMindTXRow[]> {
  const token = process.env.FINMIND_TOKEN;
  if (!token) throw new Error('FINMIND_TOKEN not set');
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset', 'TaiwanFuturesDaily');
  url.searchParams.set('data_id', 'TX');
  url.searchParams.set('start_date', startDate);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`FinMind fetch failed: ${res.status}`);
  const json = await res.json();
  return (json.data ?? []) as FinMindTXRow[];
}

// For a given "today" date, find the most recent index close strictly before
// it, and the one before that, and return whether it went up / down.
function indexDirection(dates: string[], byDate: Map<string, number>, today: string): { up: boolean; down: boolean } | null {
  const priorDate = [...dates].reverse().find(d => d < today);
  if (!priorDate) return null;
  const priorIdx = dates.indexOf(priorDate);
  if (priorIdx <= 0) return null;
  const close = byDate.get(priorDate)!;
  const prevClose = byDate.get(dates[priorIdx - 1])!;
  return { up: close > prevClose, down: close < prevClose };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get('debug') === '1';

  try {
    // ---- 1. 0050 daily prices from your own DB ----
    const priceRows = await sql`
      SELECT date::text AS date, open, close
      FROM daily_prices
      WHERE symbol = '0050'
      ORDER BY date ASC
    ` as unknown as DailyPriceRow[];

    if (priceRows.length < 2) {
      return NextResponse.json({ error: 'Not enough 0050 price history in daily_prices' }, { status: 400 });
    }
    const earliestDate = priceRows[0].date;

    // ---- 2. 4 US indices (Stooq, free) ----
    const indexData = await Promise.all(
      INDICES.map(async idx => {
        const rows = await fetchStooqDaily(idx.ticker);
        return {
          ...idx,
          dates: rows.map(r => r.date),
          byDate: new Map(rows.map(r => [r.date, r.close])),
          latest: rows.slice(-1)[0] ?? null,
        };
      })
    );

    // ---- 3. TX futures day+night session (FinMind) ----
    const txRows = await fetchTxFuturesDaily(earliestDate);
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of txRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

    // ---- 4. Walk through 0050 trading days, evaluate both signals ----
    let bullSignalDays = 0, bullHitDays = 0;
    let bearSignalDays = 0, bearHitDays = 0;
    let totalDaysAll = 0, gapUpDaysAll = 0, gapDownDaysAll = 0;

    const bullDetails: Array<{ date: string; gapUp: boolean }> = [];
    const bearDetails: Array<{ date: string; gapDown: boolean }> = [];
    const skipped: Array<{ date: string; reason: string }> = [];

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      const prevClose = priceRows[i - 1].close;
      const todayOpen = today.open;
      if (todayOpen == null || prevClose == null) {
        skipped.push({ date: today.date, reason: 'missing open/prevClose' });
        continue;
      }

      const dirs = indexData.map(idx => indexDirection(idx.dates as string[], idx.byDate as Map<string, number>, today.date));
      if (dirs.some(d => d === null)) {
        skipped.push({ date: today.date, reason: 'missing index data' });
        continue;
      }
      const allUp = dirs.every(d => d!.up);
      const allDown = dirs.every(d => d!.down);

      const tx = txByDate.get(today.date);
      if (!tx || tx.nightOpen == null || tx.nightClose == null) {
        skipped.push({ date: today.date, reason: 'no TX night session data' });
        continue;
      }
      const nightUp = tx.nightClose > tx.nightOpen;
      const nightDown = tx.nightClose < tx.nightOpen;

      const gapUp = todayOpen > prevClose;
      const gapDown = todayOpen < prevClose;

      totalDaysAll++;
      if (gapUp) gapUpDaysAll++;
      if (gapDown) gapDownDaysAll++;

      if (allUp && nightUp) {
        bullSignalDays++;
        if (gapUp) bullHitDays++;
        bullDetails.push({ date: today.date, gapUp });
      }
      if (allDown && nightDown) {
        bearSignalDays++;
        if (gapDown) bearHitDays++;
        bearDetails.push({ date: today.date, gapDown });
      }
    }

    const bullHitRate = bullSignalDays > 0 ? (bullHitDays / bullSignalDays) * 100 : null;
    const bearHitRate = bearSignalDays > 0 ? (bearHitDays / bearSignalDays) * 100 : null;
    const gapUpBaseRate = totalDaysAll > 0 ? (gapUpDaysAll / totalDaysAll) * 100 : null;
    const gapDownBaseRate = totalDaysAll > 0 ? (gapDownDaysAll / totalDaysAll) * 100 : null;

    const response: Record<string, unknown> = {
      note: 'Measures 0050 OPEN vs PRIOR CLOSE (a gap test), not the first-15-minutes move.',
      bull: {
        description: 'Dow+SP500+Nasdaq+SOX all up AND TX night session up -> 0050 gapped up next day?',
        signalDays: bullSignalDays,
        hitDays: bullHitDays,
        hitRate: bullHitRate,
        baseRate: gapUpBaseRate,
        edge: bullHitRate !== null && gapUpBaseRate !== null ? bullHitRate - gapUpBaseRate : null,
        recent: bullDetails.slice(-20),
      },
      bear: {
        description: 'Dow+SP500+Nasdaq+SOX all down AND TX night session down -> 0050 gapped down next day?',
        signalDays: bearSignalDays,
        hitDays: bearHitDays,
        hitRate: bearHitRate,
        baseRate: gapDownBaseRate,
        edge: bearHitRate !== null && gapDownBaseRate !== null ? bearHitRate - gapDownBaseRate : null,
        recent: bearDetails.slice(-20),
      },
      totalDaysEvaluated: totalDaysAll,
    };

    if (debug) {
      response.indexLatestSample = indexData.map(idx => ({ key: idx.key, label: idx.label, ticker: idx.ticker, latest: idx.latest }));
      response.txSampleAlignment = priceRows.slice(-10).map(p => ({ date: p.date, tx: txByDate.get(p.date) ?? null }));
      response.skippedSample = skipped.slice(-20);
      response.skippedCount = skipped.length;
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
