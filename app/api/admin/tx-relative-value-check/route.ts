// =============================================================================
// app/api/admin/tx-relative-value-check/route.ts
//
// Tests the "5-condition" signal's Priority 1 relative-value hypothesis:
// is the spread between TX (broad TAIEX futures) and 0050-specific futures
// (NYF/SRF) more predictable / different on signal days than on ordinary
// days? This does NOT trade direction — it looks at the relationship
// between two instruments that are simultaneously tradeable, avoiding the
// 05:00-08:45 dead zone entirely (both trade together 17:25-05:00).
//
// Reuses the same signal-detection and front-month-selection logic as
// sox-signal-check/route.ts.
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

// Generalized version of sox-signal-check's fetchTxFuturesDaily — works for
// any FinMind TaiwanFuturesDaily data_id (TX, SRF, NYF). Same front-month
// selection: among rows sharing a date+session, keep the highest-volume one
// (that's the active/front contract).
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

// Builds a date -> { nightOpen, nightClose } map from the after_market
// (night session) rows only, skipping zero/missing values (unlisted
// contract-months report as all-zero rows).
function buildNightSessionMap(rows: FinMindFuturesRow[]) {
  const map = new Map<string, { nightOpen: number; nightClose: number }>();
  for (const row of rows) {
    if (row.trading_session !== 'after_market') continue;
    if (!row.open || !row.close) continue; // 0.0 = no real trading that day
    map.set(row.date, { nightOpen: row.open, nightClose: row.close });
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

// Pearson correlation coefficient between two equal-length arrays.
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

    const txByDate = buildNightSessionMap(txRows);
    const srfByDate = buildNightSessionMap(srfRows);
    const nyfByDate = buildNightSessionMap(nyfRows);

    // Per-day records where TX, SRF, and NYF ALL have real night-session
    // data (this is the binding constraint — SRF/NYF history is shorter
    // than TX's).
    const bullTx: number[] = [], bullSrf: number[] = [], bullNyf: number[] = [];
    const bearTx: number[] = [], bearSrf: number[] = [], bearNyf: number[] = [];
    const baselineTx: number[] = [], baselineSrf: number[] = [], baselineNyf: number[] = [];

    const skipped: Array<{ date: string; reason: string }> = [];
    let commonDaysCount = 0;

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i].date;

      const tx = txByDate.get(today);
      const srf = srfByDate.get(today);
      const nyf = nyfByDate.get(today);
      if (!tx || !srf || !nyf) {
        skipped.push({ date: today, reason: 'missing TX/SRF/NYF night-session data on this date' });
        continue;
      }

      commonDaysCount++;
      const txReturn = pctMove(tx.nightOpen, tx.nightClose);
      const srfReturn = pctMove(srf.nightOpen, srf.nightClose);
      const nyfReturn = pctMove(nyf.nightOpen, nyf.nightClose);

      const dirs = indexResults.map(idx => indexDirection(idx.dates as string[], idx.byDate as Map<string, number>, today));
      const hasAllIndexData = dirs.every(d => d !== null);
      const allUp = hasAllIndexData && dirs.every(d => d!.up);
      const allDown = hasAllIndexData && dirs.every(d => d!.down);

      const nightUp = tx.nightClose > tx.nightOpen;
      const nightDown = tx.nightClose < tx.nightOpen;

      if (allUp && nightUp) {
        bullTx.push(txReturn); bullSrf.push(srfReturn); bullNyf.push(nyfReturn);
      } else if (allDown && nightDown) {
        bearTx.push(txReturn); bearSrf.push(srfReturn); bearNyf.push(nyfReturn);
      } else {
        baselineTx.push(txReturn); baselineSrf.push(srfReturn); baselineNyf.push(nyfReturn);
      }
    }

    const response: Record<string, unknown> = {
      note: 'Tests whether the TX-vs-SRF/NYF night-session return spread behaves differently on signal days vs baseline days. Positive correlation means the two instruments move together (spread stays tight); a spread that is tighter/looser or more one-sided on signal days than baseline is the thing to look for. Sample sizes below are small — SRF/NYF history is much shorter than TX/0050 history, and signal days are rare. Treat any apparent effect as a lead to investigate further, not a result to trade on yet.',
      commonDaysWithAllThreeInstruments: commonDaysCount,
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