// =============================================================================
// app/api/admin/sox-signal-check/route.ts
//
// v4 fixes:
//   - Stooq was blocking server requests with a JS bot-check (confirmed via
//     diagnostics) -> switched to Yahoo Finance's public chart JSON endpoint,
//     which needs no key and no JS execution.
//   - FinMind TaiwanFuturesDaily returns MULTIPLE contract months per date
//     (front month, next month, quarterly...). Previous code grabbed
//     whichever row came last, often an untraded far-out contract with
//     open=0/close=0. Fixed: now picks the highest-VOLUME row per date+
//     session, i.e. the actively-traded front-month contract.
//
// Still flagged as unverified, check in ?debug=1:
//   - Yahoo tickers used: ^DJI, ^GSPC, ^IXIC, ^SOX. Check DIAGNOSTIC_yahoo
//     for sane latest values (Dow ~40,000s, S&P500 ~5-6,000s, Nasdaq
//     Composite ~17-20,000s, SOX ~5-6,000s).
//   - FinMind night-session date convention (same caveat as before).
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
  trading_session: string;
  open: number;
  close: number;
  volume: number;
}

interface IndexRow {
  date: string;
  close: number;
}

const INDICES = [
  { key: 'dji', ticker: '^DJI', label: 'Dow Jones' },
  { key: 'spx', ticker: '^GSPC', label: 'S&P 500' },
  { key: 'ndq', ticker: '^IXIC', label: 'Nasdaq Composite' },
  { key: 'sox', ticker: '^SOX', label: 'Philadelphia Semiconductor (SOX)' },
] as const;

async function fetchYahooDaily(ticker: string, debug: boolean) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* handled below via null json */ }

  const result = json?.chart?.result?.[0];
  const timestamps: number[] = result?.timestamp ?? [];
  const closes: number[] = result?.indicators?.quote?.[0]?.close ?? [];

  const rows: IndexRow[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    rows.push({ date, close: c });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  return {
    rows,
    debugInfo: debug ? {
      status: res.status,
      ok: res.ok,
      yahooError: json?.chart?.error ?? null,
      rowCount: rows.length,
      bodyPreview: raw.slice(0, 300),
    } : undefined,
  };
}

async function fetchTxFuturesDaily(startDate: string, debug: boolean) {
  const token = process.env.FINMIND_TOKEN;
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset', 'TaiwanFuturesDaily');
  url.searchParams.set('data_id', 'TX');
  url.searchParams.set('start_date', startDate);
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* handled below */ }
  const data = (json?.data ?? []) as FinMindTXRow[];

  // Pick the highest-volume (front-month) row per date+session
  const bestByKey = new Map<string, FinMindTXRow>();
  for (const row of data) {
    const key = `${row.date}|${row.trading_session}`;
    const existing = bestByKey.get(key);
    if (!existing || row.volume > existing.volume) {
      bestByKey.set(key, row);
    }
  }

  return {
    frontMonthRows: [...bestByKey.values()],
    debugInfo: debug ? {
      hasToken: Boolean(token),
      status: res.status,
      ok: res.ok,
      topLevelMsg: json?.msg ?? null,
      rawRowCount: data.length,
      frontMonthRowCount: bestByKey.size,
      sampleFrontMonthRows: [...bestByKey.values()].slice(-6),
    } : undefined,
  };
}

function indexDirection(dates: string[], byDate: Map<string, number>, today: string) {
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

    const indexResults = await Promise.all(
      INDICES.map(async idx => {
        const { rows, debugInfo } = await fetchYahooDaily(idx.ticker, debug);
        return {
          ...idx,
          dates: rows.map(r => r.date),
          byDate: new Map(rows.map(r => [r.date, r.close])),
          latest: rows.slice(-1)[0] ?? null,
          debugInfo,
        };
      })
    );

    const { frontMonthRows, debugInfo: txDebugInfo } = await fetchTxFuturesDaily(earliestDate, debug);
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of frontMonthRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

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
      if (todayOpen == null || prevClose == null) { skipped.push({ date: today.date, reason: 'missing open/prevClose' }); continue; }

      const dirs = indexResults.map(idx => indexDirection(idx.dates as string[], idx.byDate as Map<string, number>, today.date));
      if (dirs.some(d => d === null)) { skipped.push({ date: today.date, reason: 'missing index data' }); continue; }
      const allUp = dirs.every(d => d!.up);
      const allDown = dirs.every(d => d!.down);

      const tx = txByDate.get(today.date);
      if (!tx || !tx.nightOpen || !tx.nightClose) { skipped.push({ date: today.date, reason: 'no TX night session data' }); continue; }
      const nightUp = tx.nightClose > tx.nightOpen;
      const nightDown = tx.nightClose < tx.nightOpen;

      const gapUp = todayOpen > prevClose;
      const gapDown = todayOpen < prevClose;

      totalDaysAll++;
      if (gapUp) gapUpDaysAll++;
      if (gapDown) gapDownDaysAll++;

      if (allUp && nightUp) { bullSignalDays++; if (gapUp) bullHitDays++; bullDetails.push({ date: today.date, gapUp }); }
      if (allDown && nightDown) { bearSignalDays++; if (gapDown) bearHitDays++; bearDetails.push({ date: today.date, gapDown }); }
    }

    const bullHitRate = bullSignalDays > 0 ? (bullHitDays / bullSignalDays) * 100 : null;
    const bearHitRate = bearSignalDays > 0 ? (bearHitDays / bearSignalDays) * 100 : null;
    const gapUpBaseRate = totalDaysAll > 0 ? (gapUpDaysAll / totalDaysAll) * 100 : null;
    const gapDownBaseRate = totalDaysAll > 0 ? (gapDownDaysAll / totalDaysAll) * 100 : null;

    const response: Record<string, unknown> = {
      note: 'Measures 0050 OPEN vs PRIOR CLOSE (a gap test), not the first-15-minutes move.',
      bull: {
        signalDays: bullSignalDays, hitDays: bullHitDays, hitRate: bullHitRate,
        baseRate: gapUpBaseRate,
        edge: bullHitRate !== null && gapUpBaseRate !== null ? bullHitRate - gapUpBaseRate : null,
        recent: bullDetails.slice(-20),
      },
      bear: {
        signalDays: bearSignalDays, hitDays: bearHitDays, hitRate: bearHitRate,
        baseRate: gapDownBaseRate,
        edge: bearHitRate !== null && gapDownBaseRate !== null ? bearHitRate - gapDownBaseRate : null,
        recent: bearDetails.slice(-20),
      },
      totalDaysEvaluated: totalDaysAll,
    };

    if (debug) {
      response.DIAGNOSTIC_yahoo = indexResults.map(idx => ({ key: idx.key, ticker: idx.ticker, latest: idx.latest, ...idx.debugInfo }));
      response.DIAGNOSTIC_finmind = txDebugInfo;
      response.skippedSample = skipped.slice(-20);
      response.skippedCount = skipped.length;
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
