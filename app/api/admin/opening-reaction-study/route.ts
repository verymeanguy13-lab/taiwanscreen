// =============================================================================
// app/api/admin/opening-reaction-study/route.ts
//
// RESEARCH REPORT ONLY. Tests whether the existing 5/5 Bull and 5/5 Bear
// signal has any directional effect on 0050 in the minutes after the
// official market open, compared against an unconditional all-days baseline.
//
// Does NOT build a trading strategy, does NOT optimize thresholds, does NOT
// apply transaction costs, does NOT modify the signal definition. Read-only —
// no database writes.
//
// Uses maxDuration=300 (same convention as other heavy admin routes in this
// project — backfill-fundamentals, backfill-consecutive-days — rather than
// a resumable multi-call importer) because the full Fugle pull, chunked
// under its own <1-year-per-request limit, comfortably fits that budget: a
// 180-day chunk returned ~33k rows quickly in the prior depth-check
// diagnostic, and this study needs only ~4-5 such chunks for the full
// 2023-05-23-to-present range.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Reused signal-classification logic (same as sox-signal-check /
// signal-strength-check / fugle-open-validation-check) — NOT modified.
// ---------------------------------------------------------------------------

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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1d`;
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

function indexMove(dates: string[], byDate: Map<string, number>, today: string) {
  const priorDate = [...dates].reverse().find(d => d < today);
  if (!priorDate) return null;
  const priorIdx = dates.indexOf(priorDate);
  if (priorIdx <= 0) return null;
  const close = byDate.get(priorDate)!;
  const prevClose = byDate.get(dates[priorIdx - 1])!;
  if (prevClose === 0) return null;
  return { up: close > prevClose, down: close < prevClose };
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

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
function sampleVariance(values: number[]) {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
}
function stdev(values: number[]) {
  const v = sampleVariance(values);
  return v == null ? null : Math.sqrt(v);
}
function percentile(sortedValues: number[], p: number): number | null {
  if (!sortedValues.length) return null;
  const idx = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  const weight = idx - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
function pctMove(from: number, to: number) {
  return ((to - from) / from) * 100;
}

// Abramowitz & Stegun erf approximation -> normal CDF -> two-tailed p-value.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(z: number) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}
function welchTTest(mean1: number | null, var1: number | null, n1: number, mean2: number | null, var2: number | null, n2: number) {
  if (mean1 == null || mean2 == null || var1 == null || var2 == null || n1 < 2 || n2 < 2) {
    return { tStat: null, pValue: null, note: 'insufficient N for a t-test' };
  }
  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) return { tStat: null, pValue: null, note: 'zero pooled variance' };
  const t = (mean1 - mean2) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(t)));
  return { tStat: t, pValue, note: "Welch's t-test; p-value via normal approximation (reasonable given the sample sizes here, not an exact Student-t)" };
}

// ---------------------------------------------------------------------------
// Fugle intraday fetch (same auth pattern as prior diagnostics — env var,
// header, base URL — not importing lib/fugle.ts, for the same reasons as
// before: need raw status/body, not the parsed live-quote shape).
// ---------------------------------------------------------------------------

interface FugleCandle {
  date: string;
  close: number | null;
}

async function fetchFugleRange(fromStr: string, toStr: string): Promise<{ ok: boolean; candles: FugleCandle[]; error?: string }> {
  const key = process.env.FUGLE_API_KEY;
  if (!key) return { ok: false, candles: [], error: 'FUGLE_API_KEY not set' };
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/0050?from=${fromStr}&to=${toStr}&timeframe=1`;
  try {
    const res = await fetch(url, { headers: { 'X-API-KEY': key }, next: { revalidate: 0 } });
    const rawText = await res.text();
    if (!res.ok) return { ok: false, candles: [], error: `HTTP ${res.status}: ${rawText.slice(0, 300)}` };
    let json: any = null;
    try { json = JSON.parse(rawText); } catch { return { ok: false, candles: [], error: 'response was not valid JSON' }; }
    const rows = Array.isArray(json?.data) ? (json.data as Record<string, unknown>[]) : [];
    const candles: FugleCandle[] = rows.map(r => ({
      date: (r.date as string) ?? '',
      close: (r.close as number) ?? null,
    }));
    return { ok: true, candles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, candles: [], error: message };
  }
}
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function hhmm(dateStr: string): string {
  const tIdx = dateStr.indexOf('T');
  return tIdx >= 0 ? dateStr.slice(tIdx + 1, tIdx + 6) : dateStr.slice(11, 16);
}
function dayOf(dateStr: string): string { return dateStr.slice(0, 10); }
function fmt(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const INTERVALS = ['09:02', '09:03', '09:05', '09:10', '09:15', '09:30'] as const;
const FUGLE_INTRADAY_START = '2023-05-23'; // earliest date empirically verified working in fugle-depth-check

// ---------------------------------------------------------------------------

export async function GET() {
  const startedAt = Date.now();
  try {
    // ---- 1. Daily prices (official open/close) ----
    const priceRows = await sql`
      SELECT date::text AS date, open, close
      FROM daily_prices
      WHERE symbol = '0050'
      ORDER BY date ASC
    ` as unknown as DailyPriceRow[];
    if (priceRows.length < 2) {
      return NextResponse.json({ error: 'Not enough 0050 price history in daily_prices' }, { status: 400 });
    }

    // ---- 2. Signal classification for every day (existing definition, unmodified) ----
    const indexResults = await Promise.all(
      INDICES.map(async idx => {
        const rows = await fetchYahooDaily(idx.ticker);
        return { ...idx, dates: rows.map(r => r.date), byDate: new Map(rows.map(r => [r.date, r.close])) };
      })
    );
    const frontMonthRows = await fetchTxFuturesDaily('2023-01-01');
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of frontMonthRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

    const signalByDate = new Map<string, 'Bull' | 'Bear' | 'None'>();
    for (const today of priceRows) {
      const moves = indexResults.map(idx => indexMove(idx.dates as string[], idx.byDate as Map<string, number>, today.date));
      let signal: 'Bull' | 'Bear' | 'None' = 'None';
      if (!moves.some(m => m === null)) {
        const allUp = moves.every(m => m!.up);
        const allDown = moves.every(m => m!.down);
        const tx = txByDate.get(today.date);
        if (tx && tx.nightOpen && tx.nightClose) {
          if (allUp && tx.nightClose > tx.nightOpen) signal = 'Bull';
          else if (allDown && tx.nightClose < tx.nightOpen) signal = 'Bear';
        }
      }
      signalByDate.set(today.date, signal);
    }

    // ---- 3. Determine target date range & candidate days (need open + prevClose) ----
    const latestDate = priceRows[priceRows.length - 1].date;
    const fugleEnd = latestDate < fmt(addDays(new Date(), -1)) ? latestDate : fmt(addDays(new Date(), -1));

    type Candidate = { date: string; signal: 'Bull' | 'Bear' | 'None'; officialOpen: number };
    const candidates: Candidate[] = [];
    const datesExcludedNoOfficialPrice: string[] = [];
    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      if (today.date < FUGLE_INTRADAY_START || today.date > fugleEnd) continue;
      const prev = priceRows[i - 1];
      if (today.open == null || prev.close == null) {
        datesExcludedNoOfficialPrice.push(today.date);
        continue;
      }
      candidates.push({ date: today.date, signal: signalByDate.get(today.date) ?? 'None', officialOpen: today.open });
    }

    // ---- 4. Pull Fugle intraday data, chunked under its 1-year limit ----
    const byDayMinuteClose = new Map<string, Map<string, number>>();
    const fugleChunks: Array<{ from: string; to: string; ok: boolean; rows: number; error?: string }> = [];
    let cursor = new Date(FUGLE_INTRADAY_START + 'T00:00:00Z');
    const endDate = new Date(fugleEnd + 'T00:00:00Z');
    const CHUNK_DAYS = 330;
    while (cursor <= endDate) {
      const chunkTo = new Date(Math.min(addDays(cursor, CHUNK_DAYS).getTime(), endDate.getTime()));
      const fromStr = fmt(cursor);
      const toStr = fmt(chunkTo);
      const result = await fetchFugleRange(fromStr, toStr);
      if (result.ok) {
        for (const c of result.candles) {
          if (c.close == null || !c.date) continue;
          const day = dayOf(c.date);
          if (!byDayMinuteClose.has(day)) byDayMinuteClose.set(day, new Map());
          byDayMinuteClose.get(day)!.set(hhmm(c.date), c.close);
        }
        fugleChunks.push({ from: fromStr, to: toStr, ok: true, rows: result.candles.length });
      } else {
        fugleChunks.push({ from: fromStr, to: toStr, ok: false, rows: 0, error: result.error });
      }
      cursor = addDays(chunkTo, 1);
      await sleep(250);
    }

    // ---- 5. Compute per-day, per-interval % move from official open ----
    type CandidateResult = { date: string; signal: 'Bull' | 'Bear' | 'None'; pct: Record<string, number | null>; missing: string[] };
    const results: CandidateResult[] = [];
    const datesExcludedNoFugleDataAtAll: string[] = [];
    const datesWithPartialCoverage: Array<{ date: string; missing: string[] }> = [];

    for (const cand of candidates) {
      const dayMinutes = byDayMinuteClose.get(cand.date);
      if (!dayMinutes || dayMinutes.size === 0) {
        datesExcludedNoFugleDataAtAll.push(cand.date);
        continue;
      }
      const pct: Record<string, number | null> = {};
      const missing: string[] = [];
      for (const m of INTERVALS) {
        const c = dayMinutes.get(m);
        if (c == null) { pct[m] = null; missing.push(m); }
        else pct[m] = pctMove(cand.officialOpen, c);
      }
      if (missing.length > 0) datesWithPartialCoverage.push({ date: cand.date, missing });
      results.push({ date: cand.date, signal: cand.signal, pct, missing });
    }

    // ---- 6. Group and compute statistics ----
    const bull = results.filter(r => r.signal === 'Bull');
    const bear = results.filter(r => r.signal === 'Bear');
    const baseline = results; // "ALL DAYS baseline" per this task — includes Bull/Bear days too, deliberately unconditional (see note in response)

    interface IntervalStats {
      n: number; mean: number | null; median: number | null; stdev: number | null; variance: number | null;
      winRatePositive: number | null; winRateNegative: number | null; p25: number | null; p75: number | null;
      max: number | null; min: number | null;
    }
    function statsFor(group: CandidateResult[], interval: string): IntervalStats {
      const values = group.map(r => r.pct[interval]).filter((v): v is number => v != null);
      const sorted = [...values].sort((a, b) => a - b);
      const n = values.length;
      return {
        n,
        mean: mean(values),
        median: median(values),
        stdev: stdev(values),
        variance: sampleVariance(values),
        winRatePositive: n ? (values.filter(v => v > 0).length / n) * 100 : null,
        winRateNegative: n ? (values.filter(v => v < 0).length / n) * 100 : null,
        p25: percentile(sorted, 25),
        p75: percentile(sorted, 75),
        max: n ? sorted[n - 1] : null,
        min: n ? sorted[0] : null,
      };
    }

    const bullStats: Record<string, IntervalStats> = {};
    const bearStats: Record<string, IntervalStats> = {};
    const baselineStats: Record<string, IntervalStats> = {};
    for (const interval of INTERVALS) {
      bullStats[interval] = statsFor(bull, interval);
      bearStats[interval] = statsFor(bear, interval);
      baselineStats[interval] = statsFor(baseline, interval);
    }

    const excessReturn: Record<string, { bullMinusBaseline: number | null; bearMinusBaseline: number | null }> = {};
    const significance: Record<string, { bullVsBaseline: ReturnType<typeof welchTTest>; bearVsBaseline: ReturnType<typeof welchTTest> }> = {};
    for (const interval of INTERVALS) {
      const b = bullStats[interval], r = bearStats[interval], base = baselineStats[interval];
      excessReturn[interval] = {
        bullMinusBaseline: b.mean != null && base.mean != null ? b.mean - base.mean : null,
        bearMinusBaseline: r.mean != null && base.mean != null ? r.mean - base.mean : null,
      };
      significance[interval] = {
        bullVsBaseline: welchTTest(b.mean, b.variance, b.n, base.mean, base.variance, base.n),
        bearVsBaseline: welchTTest(r.mean, r.variance, r.n, base.mean, base.variance, base.n),
      };
    }

    const directionalHitRates: Record<string, { bullPositivePct: number | null; bearNegativePct: number | null }> = {};
    for (const interval of INTERVALS) {
      directionalHitRates[interval] = {
        bullPositivePct: bullStats[interval].winRatePositive,
        bearNegativePct: bearStats[interval].winRateNegative,
      };
    }

    return NextResponse.json({
      dataset: {
        bullN: bull.length,
        bearN: bear.length,
        baselineN: baseline.length,
        baselineDefinition: 'ALL matched trading days in range, INCLUDING Bull and Bear days (unconditional baseline) — per this task\'s literal spec. Note: a prior test in this project used a stricter baseline that excluded signal days; this is a deliberately different, broader definition — treat comparisons against that earlier result with that difference in mind.',
        dateRangeRequested: { from: FUGLE_INTRADAY_START, to: fugleEnd },
        totalCandidateDaysInRange: candidates.length,
        datesExcludedNoOfficialPrice,
        datesExcludedNoFugleDataAtAllCount: datesExcludedNoFugleDataAtAll.length,
        datesExcludedNoFugleDataAtAllSample: datesExcludedNoFugleDataAtAll.slice(0, 30),
        datesWithPartialFugleCoverageCount: datesWithPartialCoverage.length,
        datesWithPartialFugleCoverageSample: datesWithPartialCoverage.slice(0, 30),
        fugleChunks,
      },
      bullResults: bullStats,
      bearResults: bearStats,
      allDaysBaseline: baselineStats,
      excessReturn,
      directionalHitRates,
      significanceTests: significance,
      note: 'Statistics only — no strategy, no cost assumptions, no threshold optimization. Interpretation is intentionally left out of this JSON; see the chat response for that.',
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'ERROR', error: message, elapsedMs: Date.now() - startedAt }, { status: 500 });
  }
}

