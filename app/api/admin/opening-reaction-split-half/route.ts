// =============================================================================
// app/api/admin/opening-reaction-split-half/route.ts
//
// SPLIT-HALF VALIDATION ONLY. Re-runs the 09:02/09:03/09:05 opening-reaction
// comparison from opening-reaction-study, but split chronologically into two
// halves by trading-day count, each using ITS OWN all-days baseline (never
// the pooled one). Also reports a secondary "neither Bull nor Bear" control
// per half. Does NOT build a strategy, does NOT optimize entry times, does
// NOT apply transaction costs, does NOT touch TX, does NOT modify the signal
// definition. Read-only — no database writes.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Reused signal-classification + Fugle-fetch logic, unmodified from
// opening-reaction-study (same conventions as every prior route in this
// project's admin diagnostics).
// ---------------------------------------------------------------------------

interface DailyPriceRow { date: string; open: number | null; close: number | null; }
interface FinMindTXRow { date: string; trading_session: string; open: number; close: number; volume: number; }
interface IndexRow { date: string; close: number; }

const INDICES = [
  { key: 'dji', ticker: '^DJI', label: 'Dow Jones' },
  { key: 'spx', ticker: '^GSPC', label: 'S&P 500' },
  { key: 'ndq', ticker: '^IXIC', label: 'Nasdaq Composite' },
  { key: 'sox', ticker: '^SOX', label: 'Philadelphia Semiconductor (SOX)' },
] as const;

async function fetchYahooDaily(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5y&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
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
    rows.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close: c });
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
  const res = await fetch(url.toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
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

function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[(sorted.length - 1) / 2];
}
function sampleVariance(values: number[]) {
  if (values.length < 2) return null;
  const m = mean(values)!;
  return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
}
function stdev(values: number[]) { const v = sampleVariance(values); return v == null ? null : Math.sqrt(v); }
function percentile(sortedValues: number[], p: number): number | null {
  if (!sortedValues.length) return null;
  const idx = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(idx), upper = Math.ceil(idx);
  if (lower === upper) return sortedValues[lower];
  const weight = idx - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
function pctMove(from: number, to: number) { return ((to - from) / from) * 100; }

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normalCdf(z: number) { return 0.5 * (1 + erf(z / Math.sqrt(2))); }
function welchTTest(mean1: number | null, var1: number | null, n1: number, mean2: number | null, var2: number | null, n2: number) {
  if (mean1 == null || mean2 == null || var1 == null || var2 == null || n1 < 2 || n2 < 2) {
    return { tStat: null, pValue: null, note: 'insufficient N for a t-test' };
  }
  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) return { tStat: null, pValue: null, note: 'zero pooled variance' };
  const t = (mean1 - mean2) / se;
  return { tStat: t, pValue: 2 * (1 - normalCdf(Math.abs(t))), note: "Welch's t-test; normal-approximation p-value; small-sample caveat applies within each half" };
}

interface FugleCandle { date: string; close: number | null; }
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
    return { ok: true, candles: rows.map(r => ({ date: (r.date as string) ?? '', close: (r.close as number) ?? null })) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, candles: [], error: message };
  }
}
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }
function hhmm(dateStr: string): string { const t = dateStr.indexOf('T'); return t >= 0 ? dateStr.slice(t + 1, t + 6) : dateStr.slice(11, 16); }
function dayOf(dateStr: string): string { return dateStr.slice(0, 10); }
function fmt(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

const INTERVALS = ['09:02', '09:03', '09:05'] as const;
const FUGLE_INTRADAY_START = '2023-05-23';

// ---------------------------------------------------------------------------

interface IntervalStats {
  n: number; mean: number | null; median: number | null; stdev: number | null; variance: number | null;
  winRatePositive: number | null; winRateNegative: number | null; p25: number | null; p75: number | null;
  max: number | null; min: number | null; meanMinusMedian: number | null;
}
function statsFor(values: number[]): IntervalStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const m = mean(values);
  const md = median(values);
  return {
    n, mean: m, median: md, stdev: stdev(values), variance: sampleVariance(values),
    winRatePositive: n ? (values.filter(v => v > 0).length / n) * 100 : null,
    winRateNegative: n ? (values.filter(v => v < 0).length / n) * 100 : null,
    p25: percentile(sorted, 25), p75: percentile(sorted, 75),
    max: n ? sorted[n - 1] : null, min: n ? sorted[0] : null,
    meanMinusMedian: m != null && md != null ? m - md : null,
  };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const priceRows = await sql`
      SELECT date::text AS date, open, close FROM daily_prices WHERE symbol = '0050' ORDER BY date ASC
    ` as unknown as DailyPriceRow[];
    if (priceRows.length < 2) return NextResponse.json({ error: 'Not enough 0050 price history' }, { status: 400 });

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
        const allUp = moves.every(m => m!.up), allDown = moves.every(m => m!.down);
        const tx = txByDate.get(today.date);
        if (tx && tx.nightOpen && tx.nightClose) {
          if (allUp && tx.nightClose > tx.nightOpen) signal = 'Bull';
          else if (allDown && tx.nightClose < tx.nightOpen) signal = 'Bear';
        }
      }
      signalByDate.set(today.date, signal);
    }

    const latestDate = priceRows[priceRows.length - 1].date;
    const fugleEnd = latestDate < fmt(addDays(new Date(), -1)) ? latestDate : fmt(addDays(new Date(), -1));

    type Candidate = { date: string; signal: 'Bull' | 'Bear' | 'None'; officialOpen: number };
    const candidates: Candidate[] = [];
    const datesExcludedNoOfficialPrice: string[] = [];
    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      if (today.date < FUGLE_INTRADAY_START || today.date > fugleEnd) continue;
      const prev = priceRows[i - 1];
      if (today.open == null || prev.close == null) { datesExcludedNoOfficialPrice.push(today.date); continue; }
      candidates.push({ date: today.date, signal: signalByDate.get(today.date) ?? 'None', officialOpen: today.open });
    }

    const byDayMinuteClose = new Map<string, Map<string, number>>();
    const fugleChunks: Array<{ from: string; to: string; ok: boolean; rows: number; error?: string }> = [];
    let cursor = new Date(FUGLE_INTRADAY_START + 'T00:00:00Z');
    const endDate = new Date(fugleEnd + 'T00:00:00Z');
    const CHUNK_DAYS = 330;
    while (cursor <= endDate) {
      const chunkTo = new Date(Math.min(addDays(cursor, CHUNK_DAYS).getTime(), endDate.getTime()));
      const fromStr = fmt(cursor), toStr = fmt(chunkTo);
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

    type Result = { date: string; signal: 'Bull' | 'Bear' | 'None'; pct: Record<string, number | null> };
    const results: Result[] = [];
    const datesExcludedNoFugleDataAtAll: string[] = [];
    const datesWithPartialCoverage: Array<{ date: string; missing: string[] }> = [];
    for (const cand of candidates) {
      const dayMinutes = byDayMinuteClose.get(cand.date);
      if (!dayMinutes || dayMinutes.size === 0) { datesExcludedNoFugleDataAtAll.push(cand.date); continue; }
      const pct: Record<string, number | null> = {};
      const missing: string[] = [];
      for (const m of INTERVALS) {
        const c = dayMinutes.get(m);
        if (c == null) { pct[m] = null; missing.push(m); } else pct[m] = pctMove(cand.officialOpen, c);
      }
      if (missing.length) datesWithPartialCoverage.push({ date: cand.date, missing });
      results.push({ date: cand.date, signal: cand.signal, pct });
    }

    // ---- Chronological split by trading-day count ----
    const mid = Math.floor(results.length / 2);
    const half1 = results.slice(0, mid);
    const half2 = results.slice(mid);

    function groupStats(group: Result[]) {
      const bull = group.filter(r => r.signal === 'Bull');
      const bear = group.filter(r => r.signal === 'Bear');
      const neither = group.filter(r => r.signal === 'None');
      const allDays = group;
      const byGroup = { bull, bear, neither, allDays };
      const out: Record<string, Record<string, IntervalStats>> = { bull: {}, bear: {}, neither: {}, allDays: {} };
      for (const [gName, gArr] of Object.entries(byGroup)) {
        for (const interval of INTERVALS) {
          out[gName][interval] = statsFor(gArr.map(r => r.pct[interval]).filter((v): v is number => v != null));
        }
      }
      return { bull: out.bull, bear: out.bear, neither: out.neither, allDays: out.allDays, n: { bull: bull.length, bear: bear.length, neither: neither.length, allDays: allDays.length } };
    }

    const h1 = groupStats(half1);
    const h2 = groupStats(half2);

    function excessAndSig(h: ReturnType<typeof groupStats>) {
      const excess: Record<string, { bull: number | null; bear: number | null }> = {};
      const sig: Record<string, { bullVsAllDays: ReturnType<typeof welchTTest>; bearVsAllDays: ReturnType<typeof welchTTest> }> = {};
      for (const interval of INTERVALS) {
        const b = h.bull[interval], r = h.bear[interval], base = h.allDays[interval];
        excess[interval] = {
          bull: b.mean != null && base.mean != null ? b.mean - base.mean : null,
          bear: r.mean != null && base.mean != null ? r.mean - base.mean : null,
        };
        sig[interval] = {
          bullVsAllDays: welchTTest(b.mean, b.variance, b.n, base.mean, base.variance, base.n),
          bearVsAllDays: welchTTest(r.mean, r.variance, r.n, base.mean, base.variance, base.n),
        };
      }
      return { excess, sig };
    }
    const h1ExcessSig = excessAndSig(h1);
    const h2ExcessSig = excessAndSig(h2);

    const replicationCheck = INTERVALS.flatMap(interval => (['bull', 'bear'] as const).map(group => {
      const half1Excess = h1ExcessSig.excess[interval][group];
      const half2Excess = h2ExcessSig.excess[interval][group];
      const sameSign = half1Excess != null && half2Excess != null ? Math.sign(half1Excess) === Math.sign(half2Excess) : null;
      return {
        interval, group,
        half1Excess, half2Excess,
        sameSign,
        absoluteDifference: half1Excess != null && half2Excess != null ? Math.abs(half1Excess - half2Excess) : null,
        ratioHalf2OverHalf1: half1Excess ? (half2Excess != null ? half2Excess / half1Excess : null) : null,
      };
    }));

    return NextResponse.json({
      datasetAndSplit: {
        fullRange: { from: results[0]?.date ?? null, to: results[results.length - 1]?.date ?? null },
        half1Range: { from: half1[0]?.date ?? null, to: half1[half1.length - 1]?.date ?? null },
        half2Range: { from: half2[0]?.date ?? null, to: half2[half2.length - 1]?.date ?? null },
        totalTradingDaysMatched: results.length,
        half1N: half1.length,
        half2N: half2.length,
        bullN: { half1: h1.n.bull, half2: h2.n.bull },
        bearN: { half1: h1.n.bear, half2: h2.n.bear },
        neitherN: { half1: h1.n.neither, half2: h2.n.neither },
        datesExcludedNoOfficialPrice,
        datesExcludedNoFugleDataAtAllCount: datesExcludedNoFugleDataAtAll.length,
        datesWithPartialFugleCoverageCount: datesWithPartialCoverage.length,
        datesWithPartialFugleCoverageSample: datesWithPartialCoverage.slice(0, 30),
        fugleChunks,
      },
      half1Results: { bull: h1.bull, bear: h1.bear },
      half2Results: { bull: h2.bull, bear: h2.bear },
      allDaysBaseline: { half1: h1.allDays, half2: h2.allDays },
      neitherBullNorBearControl: { half1: h1.neither, half2: h2.neither },
      excessReturn: { half1: h1ExcessSig.excess, half2: h2ExcessSig.excess },
      significanceTests: { half1: h1ExcessSig.sig, half2: h2ExcessSig.sig },
      replicationCheck,
      note: 'Statistics only, split chronologically by trading-day count. Each half uses its OWN all-days baseline, never the pooled one. Interpretation intentionally left out of this JSON.',
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'ERROR', error: message, elapsedMs: Date.now() - startedAt }, { status: 500 });
  }
}

