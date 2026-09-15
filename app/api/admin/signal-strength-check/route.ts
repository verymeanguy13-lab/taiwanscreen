// =============================================================================
// app/api/admin/signal-strength-check/route.ts
//
// Tests whether SIGNAL STRENGTH (how far the 5 conditions moved, not just
// whether they all agreed) predicts different 0050 open-to-close outcomes.
// Only evaluates days that already qualify as Bull or Bear under the existing
// 5-condition signal (all four US indexes + TX night session agree in
// direction) — same population as sox-signal-check — then splits those days
// into strength buckets (weakest to strongest) and compares net-of-cost
// open-to-close results across buckets. Uses data already in daily_prices +
// the same Yahoo/FinMind sources as sox-signal-check — no new data source
// needed, no new cost.
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

async function fetchTxFuturesDaily(startDate: string) {
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
  try { json = JSON.parse(raw); } catch { /* leave null */ }
  const data = (json?.data ?? []) as FinMindTXRow[];

  const bestByKey = new Map<string, FinMindTXRow>();
  for (const row of data) {
    const key = `${row.date}|${row.trading_session}`;
    const existing = bestByKey.get(key);
    if (!existing || row.volume > existing.volume) bestByKey.set(key, row);
  }
  return [...bestByKey.values()];
}

// Returns the % change of the index's prior close vs the close before that
// (the move that was already known as of "today"'s ~05:00 signal time),
// plus direction flags — same lookup logic as sox-signal-check.
function indexMove(dates: string[], byDate: Map<string, number>, today: string) {
  const priorDate = [...dates].reverse().find(d => d < today);
  if (!priorDate) return null;
  const priorIdx = dates.indexOf(priorDate);
  if (priorIdx <= 0) return null;
  const close = byDate.get(priorDate)!;
  const prevClose = byDate.get(dates[priorIdx - 1])!;
  if (prevClose === 0) return null;
  const pct = ((close - prevClose) / prevClose) * 100;
  return { up: close > prevClose, down: close < prevClose, pct };
}

function pctMove(from: number, to: number) { return ((to - from) / from) * 100; }

function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[(sorted.length - 1) / 2];
}

function pearsonCorrelation(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs)!, my = mean(ys)!;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

interface SignalDay {
  date: string;
  strengthPct: number;    // avg magnitude of the 5 signal legs, always reported positive
  openToClosePct: number; // net move a same-day entry/exit could capture (positive = profit direction)
  gapHit: boolean;        // did today's open actually gap in the signal's direction
}

interface Bucket {
  label: string;
  days: number;
  strengthRange: [number, number] | null;
  avgStrengthPct: number | null;
  gapHitRate: number | null;
  avgOpenToClosePct: number | null;
  medianOpenToClosePct: number | null;
  pctProfitableNetOfCost: number | null;
}

function bucketStats(days: SignalDay[], bucketCount: number, roundTripCostPct: number): Bucket[] {
  const sorted = [...days].sort((a, b) => a.strengthPct - b.strengthPct);
  const bucketSize = Math.ceil(sorted.length / bucketCount);
  const labels = bucketCount === 4
    ? ['weakest quartile', '2nd quartile', '3rd quartile', 'strongest quartile']
    : Array.from({ length: bucketCount }, (_, i) => `bucket ${i + 1} of ${bucketCount}`);

  const buckets: Bucket[] = [];
  for (let b = 0; b < bucketCount; b++) {
    const slice = sorted.slice(b * bucketSize, (b + 1) * bucketSize);
    if (slice.length === 0) {
      buckets.push({ label: labels[b], days: 0, strengthRange: null, avgStrengthPct: null, gapHitRate: null, avgOpenToClosePct: null, medianOpenToClosePct: null, pctProfitableNetOfCost: null });
      continue;
    }
    const moves = slice.map(d => d.openToClosePct);
    const strengths = slice.map(d => d.strengthPct);
    const gapHits = slice.filter(d => d.gapHit).length;
    buckets.push({
      label: labels[b],
      days: slice.length,
      strengthRange: [strengths[0], strengths[strengths.length - 1]],
      avgStrengthPct: mean(strengths),
      gapHitRate: (gapHits / slice.length) * 100,
      avgOpenToClosePct: mean(moves),
      medianOpenToClosePct: median(moves),
      pctProfitableNetOfCost: (moves.filter(v => v > roundTripCostPct).length / moves.length) * 100,
    });
  }
  return buckets;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const debug = searchParams.get('debug') === '1';
  const roundTripCostPct = Number(searchParams.get('costPct') ?? '0.2');
  const bucketCount = Number(searchParams.get('buckets') ?? '4');

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

    const frontMonthRows = await fetchTxFuturesDaily(earliestDate);
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of frontMonthRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

    const bullDays: SignalDay[] = [];
    const bearDays: SignalDay[] = [];
    const skipped: Array<{ date: string; reason: string }> = [];

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      const prevClose = priceRows[i - 1].close;
      const todayOpen = today.open;
      const todayClose = today.close;
      if (todayOpen == null || prevClose == null || todayClose == null) { skipped.push({ date: today.date, reason: 'missing open/close/prevClose' }); continue; }

      const moves = indexResults.map(idx => indexMove(idx.dates as string[], idx.byDate as Map<string, number>, today.date));
      if (moves.some(m => m === null)) { skipped.push({ date: today.date, reason: 'missing index data' }); continue; }
      const allUp = moves.every(m => m!.up);
      const allDown = moves.every(m => m!.down);
      if (!allUp && !allDown) continue; // not a signal day — same population as sox-signal-check

      const tx = txByDate.get(today.date);
      if (!tx || !tx.nightOpen || !tx.nightClose) { skipped.push({ date: today.date, reason: 'no TX night session data' }); continue; }
      const txPct = ((tx.nightClose - tx.nightOpen) / tx.nightOpen) * 100;
      const nightUp = tx.nightClose > tx.nightOpen;
      const nightDown = tx.nightClose < tx.nightOpen;

      const legPcts = [...moves.map(m => m!.pct), txPct];

      if (allUp && nightUp) {
        const gapUp = todayOpen > prevClose;
        const strengthPct = mean(legPcts)!; // all 5 legs positive here, so mean is already the magnitude
        const openToClosePct = pctMove(todayOpen, todayClose); // positive = long gained
        bullDays.push({ date: today.date, strengthPct, openToClosePct, gapHit: gapUp });
      } else if (allDown && nightDown) {
        const gapDown = todayOpen < prevClose;
        const strengthPct = Math.abs(mean(legPcts)!); // all 5 legs negative here; report magnitude as positive
        const openToClosePct = -pctMove(todayOpen, todayClose); // positive = short gained
        bearDays.push({ date: today.date, strengthPct, openToClosePct, gapHit: gapDown });
      }
    }

    const bullBuckets = bucketStats(bullDays, bucketCount, roundTripCostPct);
    const bearBuckets = bucketStats(bearDays, bucketCount, roundTripCostPct);

    const bullCorrelation = pearsonCorrelation(bullDays.map(d => d.strengthPct), bullDays.map(d => d.openToClosePct));
    const bearCorrelation = pearsonCorrelation(bearDays.map(d => d.strengthPct), bearDays.map(d => d.openToClosePct));

    const response: Record<string, unknown> = {
      note: "strengthPct = average magnitude of the 5 signal legs (Dow/S&P/Nasdaq/SOX/TX night session) on days that already qualify as Bull or Bear under the existing 5-condition signal. Days are split into buckets from weakest to strongest signal, then each bucket's open-to-close move (net of an estimated round-trip cost) is compared — same net-of-cost definition as sox-signal-check. correlationStrengthVsMove is the Pearson correlation between signal strength and open-to-close move across all signal days (not bucketed) — a quick check for whether stronger signals produce bigger moves in general, independent of the bucket cutoffs.",
      roundTripCostPctUsed: roundTripCostPct,
      bucketCount,
      bull: {
        totalSignalDays: bullDays.length,
        correlationStrengthVsMove: bullCorrelation,
        buckets: bullBuckets,
      },
      bear: {
        totalSignalDays: bearDays.length,
        correlationStrengthVsMove: bearCorrelation,
        buckets: bearBuckets,
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

