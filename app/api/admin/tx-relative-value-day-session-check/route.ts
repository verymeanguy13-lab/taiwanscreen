// =============================================================================
// app/api/admin/tx-relative-value-day-session-check/route.ts
//
// FIX over tx-relative-value-check: that route compared TX's own night-session
// return to SRF/NYF's night-session return on the SAME night — but the signal
// and that night's TX move resolve at the same ~05:00 moment, so it wasn't
// actually tradeable (you'd know the signal only once the thing it's
// measuring is already over).
//
// This route instead tests: does the signal — fully known by ~05:00, using
// the night session that JUST ended — predict the TX-vs-SRF/NYF spread in
// the DAY session that follows (08:45-13:45)? That's a real gap you could
// act in: signal confirmed ~05:00, dead zone until 08:45, then trade at the
// day-session open using information you already had.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface DailyPriceRow {
  date: string;
  open: number | null;
  close: number | null;
}

interface FinMindFuturesRow {
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

async function fetchYahooDaily(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* leave null */ }
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
  return rows;
}

// Same front-month-selection logic as sox-signal-check and
// tx-relative-value-check: among rows sharing a date+session, keep the
// highest-volume one (that's the active/front contract).
async function fetchFuturesDaily(dataId: string, startDate: string) {
  const token = process.env.FINMIND_TOKEN;
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset', 'TaiwanFuturesDaily');
  url.searchParams.set('data_id', dataId);
  url.searchParams.set('start_date', startDate);
  const res = await fetch(url.toString(), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* leave null */ }
  const data = (json?.data ?? []) as FinMindFuturesRow[];

  const bestByKey = new Map<string, FinMindFuturesRow>();
  for (const row of data) {
    const key = `${row.date}|${row.trading_session}`;
    const existing = bestByKey.get(key);
    if (!existing || row.volume > existing.volume) bestByKey.set(key, row);
  }
  return [...bestByKey.values()];
}

// date -> { open, close } from the after_market (NIGHT session) rows.
// FinMind's after_market row dated D is the night session that ENDS at
// ~05:00 on the morning of D — i.e. the night before D's day session opens.
function buildNightSessionMap(rows: FinMindFuturesRow[]) {
  const map = new Map<string, { open: number; close: number }>();
  for (const row of rows) {
    if (row.trading_session !== 'after_market') continue;
    if (!row.open || !row.close) continue;
    map.set(row.date, { open: row.open, close: row.close });
  }
  return map;
}

// date -> { open, close } from the position (DAY session) rows: 08:45-13:45
// on date D, same calendar date as the night session that just ended.
function buildDaySessionMap(rows: FinMindFuturesRow[]) {
  const map = new Map<string, { open: number; close: number }>();
  for (const row of rows) {
    if (row.trading_session !== 'position') continue;
    if (!row.open || !row.close) continue;
    map.set(row.date, { open: row.open, close: row.close });
  }
  return map;
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

function pctMove(from: number, to: number) {
  return ((to - from) / from) * 100;
}

function mean(values: number[]) {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: number[]) {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function pearsonCorr(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? null : num / denom;
}

function spreadStats(txReturns: number[], otherReturns: number[]) {
  const spreads = txReturns.map((tx, i) => tx - otherReturns[i]);
  return {
    n: spreads.length,
    meanSpreadPct: mean(spreads),
    medianSpreadPct: median(spreads),
    stddevSpreadPct: stddev(spreads),
    correlation: pearsonCorr(txReturns, otherReturns),
  };
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
        const rows = await fetchYahooDaily(idx.ticker);
        return { ...idx, dates: rows.map(r => r.date), byDate: new Map(rows.map(r => [r.date, r.close])) };
      })
    );

    const [txRows, srfRows, nyfRows] = await Promise.all([
      fetchFuturesDaily('TX', earliestDate),
      fetchFuturesDaily('SRF', earliestDate),
      fetchFuturesDaily('NYF', earliestDate),
    ]);

    // NIGHT session (used only to confirm the signal — known by ~05:00)
    const txNightByDate = buildNightSessionMap(txRows);

    // DAY session (what we're actually testing — 08:45-13:45, the
    // tradeable window after the signal is already known)
    const txDayByDate = buildDaySessionMap(txRows);
    const srfDayByDate = buildDaySessionMap(srfRows);
    const nyfDayByDate = buildDaySessionMap(nyfRows);

    const bullTx: number[] = [], bullSrf: number[] = [], bullNyf: number[] = [];
    const bearTx: number[] = [], bearSrf: number[] = [], bearNyf: number[] = [];
    const baselineTx: number[] = [], baselineSrf: number[] = [], baselineNyf: number[] = [];

    const skipped: Array<{ date: string; reason: string }> = [];
    let commonDaysCount = 0;

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i].date;

      // Signal inputs: TX's night session for date D (ends ~05:00 on D,
      // before D's day session opens) + the 4 US indices' prior-close
      // direction relative to D.
      const txNight = txNightByDate.get(today);
      const dirs = indexResults.map(idx => indexDirection(idx.dates as string[], idx.byDate as Map<string, number>, today));
      const hasAllIndexData = dirs.every(d => d !== null);

      if (!txNight || !hasAllIndexData) {
        skipped.push({ date: today, reason: 'missing TX night-session data or index data (needed to confirm signal)' });
        continue;
      }

      const allUp = dirs.every(d => d!.up);
      const allDown = dirs.every(d => d!.down);
      const nightUp = txNight.close > txNight.open;
      const nightDown = txNight.close < txNight.open;

      // What we're testing: the DAY session for the SAME date D — the
      // window that opens at 08:45, after the dead zone, using the signal
      // that was already confirmed by 05:00.
      const txDay = txDayByDate.get(today);
      const srfDay = srfDayByDate.get(today);
      const nyfDay = nyfDayByDate.get(today);
      if (!txDay || !srfDay || !nyfDay) {
        skipped.push({ date: today, reason: 'missing TX/SRF/NYF day-session data on this date' });
        continue;
      }

      commonDaysCount++;
      const txReturn = pctMove(txDay.open, txDay.close);
      const srfReturn = pctMove(srfDay.open, srfDay.close);
      const nyfReturn = pctMove(nyfDay.open, nyfDay.close);

      if (allUp && nightUp) {
        bullTx.push(txReturn); bullSrf.push(srfReturn); bullNyf.push(nyfReturn);
      } else if (allDown && nightDown) {
        bearTx.push(txReturn); bearSrf.push(srfReturn); bearNyf.push(nyfReturn);
      } else {
        baselineTx.push(txReturn); baselineSrf.push(srfReturn); baselineNyf.push(nyfReturn);
      }
    }

    const response: Record<string, unknown> = {
      note: 'Unlike tx-relative-value-check (which compared same-night returns — not actually tradeable), this tests whether the signal known by ~05:00 predicts the TX-vs-SRF/NYF spread in the DAY session that follows (08:45-13:45), after the 05:00-08:45 dead zone. This is the genuinely tradeable version: you would know the signal before the window it is predicting even opens. Sample sizes are still small (SRF/NYF history is ~3 months old).',
      commonDaysWithSignalAndDaySessionData: commonDaysCount,
      bull: {
        signalDays: bullTx.length,
        vsSRF: spreadStats(bullTx, bullSrf),
        vsNYF: spreadStats(bullTx, bullNyf),
      },
      bear: {
        signalDays: bearTx.length,
        vsSRF: spreadStats(bearTx, bearSrf),
        vsNYF: spreadStats(bearTx, bearNyf),
      },
      baseline: {
        days: baselineTx.length,
        vsSRF: spreadStats(baselineTx, baselineSrf),
        vsNYF: spreadStats(baselineTx, baselineNyf),
      },
    };

    if (debug) {
      response.skippedSample = skipped.slice(-20);
      response.skippedCount = skipped.length;
    }

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
