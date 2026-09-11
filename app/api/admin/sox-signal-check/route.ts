// =============================================================================
// app/api/admin/sox-signal-check/route.ts
//
// DIAGNOSTIC VERSION — same logic as before, but ?debug=1 now also returns
// the RAW response info from Stooq and FinMind (status codes + first ~300
// chars of body) so we can see exactly why they returned empty/zero data
// last time, instead of guessing.
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

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/csv,text/plain,*/*',
};

async function fetchStooqDaily(ticker: string, debug: boolean) {
  const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&i=d`, {
    headers: BROWSER_HEADERS,
  });
  const raw = await res.text();
  const lines = raw.trim().split('\n').slice(1);
  const rows: StooqRow[] = [];
  for (const line of lines) {
    const parts = line.split(',');
    const date = parts[0];
    const close = parseFloat(parts[4]);
    if (date && !Number.isNaN(close)) rows.push({ date, close });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return {
    rows,
    debugInfo: debug ? { status: res.status, ok: res.ok, bodyPreview: raw.slice(0, 300) } : undefined,
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
  try { json = JSON.parse(raw); } catch { /* leave null, raw preview will show why */ }
  const data = (json?.data ?? []) as FinMindTXRow[];
  return {
    data,
    debugInfo: debug ? {
      hasToken: Boolean(token),
      status: res.status,
      ok: res.ok,
      topLevelMsg: json?.msg ?? null,
      topLevelStatus: json?.status ?? null,
      rowCount: data.length,
      firstFewRows: data.slice(0, 6),
      rawPreview: raw.slice(0, 300),
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
        const { rows, debugInfo } = await fetchStooqDaily(idx.ticker, debug);
        return {
          ...idx,
          dates: rows.map(r => r.date),
          byDate: new Map(rows.map(r => [r.date, r.close])),
          latest: rows.slice(-1)[0] ?? null,
          debugInfo,
        };
      })
    );

    const { data: txRows, debugInfo: txDebugInfo } = await fetchTxFuturesDaily(earliestDate, debug);
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of txRows) {
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
      response.DIAGNOSTIC_stooq = indexResults.map(idx => ({ key: idx.key, ticker: idx.ticker, latest: idx.latest, ...idx.debugInfo }));
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
