// =============================================================================
// app/api/admin/us-tx-agreement-check/route.ts
//
// Tests whether TX's night-session condition earns its place in the 5-
// condition signal. Splits days by the 4 US indices' direction (unanimous
// up/down) and TX's night-session direction SEPARATELY, rather than
// requiring all 5 to agree, into four groups:
//   A: US 4/4 Bull + TX Bull   (= the existing full "Bull" signal)
//   B: US 4/4 Bull + TX Bear   (US bullish, TX disagrees)
//   C: US 4/4 Bear + TX Bear   (= the existing full "Bear" signal)
//   D: US 4/4 Bear + TX Bull   (US bearish, TX disagrees)
// Compares the 09:02/09:03 post-open reaction across all four, against the
// same all-days baseline used throughout this project's opening-reaction
// work. If TX adds real information, B and D should look meaningfully
// weaker/different from A and C. If TX is dead weight, all four groups
// sharing a US direction should look similar regardless of TX.
//
// Does NOT build a strategy, does NOT apply transaction costs, does NOT
// modify the existing 5-condition signal used elsewhere in this project —
// this is a separate, descriptive re-slicing of the same underlying data.
// Read-only — no database writes.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const maxDuration = 300;

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
  return { tStat: t, pValue: 2 * (1 - normalCdf(Math.abs(t))), note: "Welch's t-test; normal-approximation p-value" };
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

const INTERVALS = ['09:02', '09:03'] as const;
const FUGLE_INTRADAY_START = '2023-05-23';

type Group = 'A_usBull_txBull' | 'B_usBull_txBear' | 'C_usBear_txBear' | 'D_usBear_txBull' | 'other';

interface IntervalStats {
  n: number; mean: number | null; median: number | null; stdev: number | null; variance: number | null;
  winRate: number | null; p25: number | null; p75: number | null; max: number | null; min: number | null;
}
function statsFor(values: number[], winDirection: 'positive' | 'negative'): IntervalStats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  return {
    n, mean: mean(values), median: median(values), stdev: stdev(values), variance: sampleVariance(values),
    winRate: n ? (values.filter(v => winDirection === 'positive' ? v > 0 : v < 0).length / n) * 100 : null,
    p25: percentile(sorted, 25), p75: percentile(sorted, 75),
    max: n ? sorted[n - 1] : null, min: n ? sorted[0] : null,
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

    const groupByDate = new Map<string, Group>();
    for (const today of priceRows) {
      const moves = indexResults.map(idx => indexMove(idx.dates as string[], idx.byDate as Map<string, number>, today.date));
      if (moves.some(m => m === null)) { groupByDate.set(today.date, 'other'); continue; }
      const us4Up = moves.every(m => m!.up);
      const us4Down = moves.every(m => m!.down);
      const tx = txByDate.get(today.date);
      const txUp = tx && tx.nightOpen && tx.nightClose ? tx.nightClose > tx.nightOpen : null;
      const txDown = tx && tx.nightOpen && tx.nightClose ? tx.nightClose < tx.nightOpen : null;

      let group: Group = 'other';
      if (us4Up && txUp) group = 'A_usBull_txBull';
      else if (us4Up && txDown) group = 'B_usBull_txBear';
      else if (us4Down && txDown) group = 'C_usBear_txBear';
      else if (us4Down && txUp) group = 'D_usBear_txBull';
      groupByDate.set(today.date, group);
    }

    const latestDate = priceRows[priceRows.length - 1].date;
    const fugleEnd = latestDate < fmt(addDays(new Date(), -1)) ? latestDate : fmt(addDays(new Date(), -1));

    type Candidate = { date: string; group: Group; officialOpen: number };
    const candidates: Candidate[] = [];
    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      if (today.date < FUGLE_INTRADAY_START || today.date > fugleEnd) continue;
      const prev = priceRows[i - 1];
      if (today.open == null || prev.close == null) continue;
      candidates.push({ date: today.date, group: groupByDate.get(today.date) ?? 'other', officialOpen: today.open });
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

    type Result = { date: string; group: Group; pct: Record<string, number | null> };
    const results: Result[] = [];
    for (const cand of candidates) {
      const dayMinutes = byDayMinuteClose.get(cand.date);
      if (!dayMinutes || dayMinutes.size === 0) continue;
      const pct: Record<string, number | null> = {};
      for (const m of INTERVALS) {
        const c = dayMinutes.get(m);
        pct[m] = c == null ? null : pctMove(cand.officialOpen, c);
      }
      results.push({ date: cand.date, group: cand.group, pct });
    }

    const groups: Group[] = ['A_usBull_txBull', 'B_usBull_txBear', 'C_usBear_txBear', 'D_usBear_txBull'];
    const winDirFor: Record<Group, 'positive' | 'negative'> = {
      A_usBull_txBull: 'positive', B_usBull_txBear: 'positive',
      C_usBear_txBear: 'negative', D_usBear_txBull: 'negative',
      other: 'positive',
    };

    const statsByGroup: Record<string, Record<string, IntervalStats>> = {};
    for (const g of groups) {
      statsByGroup[g] = {};
      for (const interval of INTERVALS) {
        const values = results.filter(r => r.group === g).map(r => r.pct[interval]).filter((v): v is number => v != null);
        statsByGroup[g][interval] = statsFor(values, winDirFor[g]);
      }
    }
    const baselineStats: Record<string, IntervalStats> = {};
    for (const interval of INTERVALS) {
      const values = results.map(r => r.pct[interval]).filter((v): v is number => v != null);
      baselineStats[interval] = statsFor(values, 'positive'); // direction irrelevant for baseline; winRate field not used for it
    }

    const excessAndSig: Record<string, Record<string, { excess: number | null; sig: ReturnType<typeof welchTTest> }>> = {};
    for (const g of groups) {
      excessAndSig[g] = {};
      for (const interval of INTERVALS) {
        const gs = statsByGroup[g][interval], base = baselineStats[interval];
        excessAndSig[g][interval] = {
          excess: gs.mean != null && base.mean != null ? gs.mean - base.mean : null,
          sig: welchTTest(gs.mean, gs.variance, gs.n, base.mean, base.variance, base.n),
        };
      }
    }

    // Direct A-vs-B and C-vs-D comparisons: does TX agreement change the mean, holding US direction fixed?
    const agreementEffect: Record<string, { interval: string; agreeMean: number | null; disagreeMean: number | null; difference: number | null; sig: ReturnType<typeof welchTTest> }> = {};
    for (const interval of INTERVALS) {
      const a = statsByGroup['A_usBull_txBull'][interval], b = statsByGroup['B_usBull_txBear'][interval];
      agreementEffect[`bull_${interval}`] = {
        interval, agreeMean: a.mean, disagreeMean: b.mean,
        difference: a.mean != null && b.mean != null ? a.mean - b.mean : null,
        sig: welchTTest(a.mean, a.variance, a.n, b.mean, b.variance, b.n),
      };
      const c = statsByGroup['C_usBear_txBear'][interval], d = statsByGroup['D_usBear_txBull'][interval];
      agreementEffect[`bear_${interval}`] = {
        interval, agreeMean: c.mean, disagreeMean: d.mean,
        difference: c.mean != null && d.mean != null ? c.mean - d.mean : null,
        sig: welchTTest(c.mean, c.variance, c.n, d.mean, d.variance, d.n),
      };
    }

    return NextResponse.json({
      scope: {
        range: { from: results[0]?.date ?? null, to: results[results.length - 1]?.date ?? null, n: results.length },
        groupCounts: Object.fromEntries(groups.map(g => [g, results.filter(r => r.group === g).length])),
        otherCount: results.filter(r => r.group === 'other').length,
        fugleChunks,
      },
      groupDefinitions: {
        A_usBull_txBull: 'US 4/4 up AND TX night up (= the existing full Bull signal)',
        B_usBull_txBear: 'US 4/4 up AND TX night down (US bullish, TX disagrees)',
        C_usBear_txBear: 'US 4/4 down AND TX night down (= the existing full Bear signal)',
        D_usBear_txBull: 'US 4/4 down AND TX night up (US bearish, TX disagrees)',
      },
      groupResults: statsByGroup,
      allDaysBaseline: baselineStats,
      excessVsBaseline: excessAndSig,
      agreementEffect,
      note: 'winRate is defined relative to the US 4/4 direction for every group (positive for Bull groups A/B, negative for Bear groups C/D), so all four groups are judged against the same US-implied direction regardless of what TX said. Statistics only — no strategy, no costs. Interpretation intentionally left out of this JSON.',
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'ERROR', error: message, elapsedMs: Date.now() - startedAt }, { status: 500 });
  }
}

