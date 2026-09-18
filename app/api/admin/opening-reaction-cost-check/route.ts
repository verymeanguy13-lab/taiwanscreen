// =============================================================================
// app/api/admin/opening-reaction-cost-check/route.ts
//
// TRANSACTION-COST CHECK for 0050 only (not TX). Applies the project's
// established ~0.2% round-trip cost estimate, plus a sensitivity table
// (0.05/0.10/0.15/0.20/0.30%), to the ACTUAL trade P&L at 09:02 and 09:03 —
// not the excess-vs-baseline number reported earlier. The distinction
// matters: a signal day's tradable profit is the raw open->interval move
// (long on Bull, short on Bear), not that move minus what an average day
// would have done. Excess-vs-baseline answers "does the signal add
// information"; this answers "would trading it have made money net of
// costs" — a different, and stricter, question.
//
// Does NOT optimize thresholds, does NOT recommend a trade, does NOT touch
// TX. Read-only — no database writes.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const maxDuration = 300;

// ---------------------------------------------------------------------------
// Reused signal-classification + Fugle-fetch logic, unmodified from prior
// opening-reaction routes.
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
function pctMove(from: number, to: number) { return ((to - from) / from) * 100; }

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
const COST_LEVELS = [0.05, 0.10, 0.15, 0.20, 0.30]; // % round-trip, sensitivity table per this project's established convention
const ESTABLISHED_COST = 0.20; // this project's own long-standing 0050 round-trip cost estimate

// ---------------------------------------------------------------------------

interface TradeDay { date: string; pnl: number; } // pnl = actual trade return %, already sign-adjusted for direction (long Bull / short Bear)

function costReport(trades: TradeDay[]) {
  const pnls = trades.map(t => t.pnl);
  const grossMean = mean(pnls);
  const grossMedian = median(pnls);
  const grossWinRate = pnls.length ? (pnls.filter(p => p > 0).length / pnls.length) * 100 : null;
  const sensitivity = COST_LEVELS.map(cost => ({
    costPct: cost,
    netMean: grossMean != null ? grossMean - cost : null,
    netMedian: grossMedian != null ? grossMedian - cost : null,
    pctTradesProfitableNetOfCost: pnls.length ? (pnls.filter(p => p - cost > 0).length / pnls.length) * 100 : null,
  }));
  const establishedCostRow = sensitivity.find(s => s.costPct === ESTABLISHED_COST) ?? null;
  return {
    n: trades.length,
    grossMean,
    grossMedian,
    grossWinRate,
    sensitivity,
    atEstablishedCost: establishedCostRow,
  };
}

// ---------------------------------------------------------------------------

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
    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      if (today.date < FUGLE_INTRADAY_START || today.date > fugleEnd) continue;
      const prev = priceRows[i - 1];
      if (today.open == null || prev.close == null) continue;
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

    type Result = { date: string; signal: 'Bull' | 'Bear' | 'None'; rawPct: Record<string, number | null> };
    const results: Result[] = [];
    for (const cand of candidates) {
      const dayMinutes = byDayMinuteClose.get(cand.date);
      if (!dayMinutes || dayMinutes.size === 0) continue;
      const rawPct: Record<string, number | null> = {};
      for (const m of INTERVALS) {
        const c = dayMinutes.get(m);
        rawPct[m] = c == null ? null : pctMove(cand.officialOpen, c);
      }
      results.push({ date: cand.date, signal: cand.signal, rawPct });
    }

    const mid = Math.floor(results.length / 2);
    const half1 = results.slice(0, mid);
    const half2 = results.slice(mid);

    // Bull trade P&L = raw move (long). Bear trade P&L = -raw move (short).
    function tradesFor(scope: Result[], interval: string, group: 'Bull' | 'Bear'): TradeDay[] {
      return scope
        .filter(r => r.signal === group)
        .map(r => ({ date: r.date, raw: r.rawPct[interval] }))
        .filter((d): d is { date: string; raw: number } => d.raw != null)
        .map(d => ({ date: d.date, pnl: group === 'Bull' ? d.raw : -d.raw }));
    }

    function buildScope(scope: Result[]) {
      const out: Record<string, { bull: ReturnType<typeof costReport>; bear: ReturnType<typeof costReport> }> = {};
      for (const interval of INTERVALS) {
        out[interval] = {
          bull: costReport(tradesFor(scope, interval, 'Bull')),
          bear: costReport(tradesFor(scope, interval, 'Bear')),
        };
      }
      return out;
    }

    return NextResponse.json({
      scope: {
        pooledRange: { from: results[0]?.date ?? null, to: results[results.length - 1]?.date ?? null, n: results.length },
        half1Range: { from: half1[0]?.date ?? null, to: half1[half1.length - 1]?.date ?? null, n: half1.length },
        half2Range: { from: half2[0]?.date ?? null, to: half2[half2.length - 1]?.date ?? null, n: half2.length },
        fugleChunks,
      },
      method: 'pnl per trade = raw open->interval % move for Bull (long entry), or its negative for Bear (short entry). This is the actual tradable return, NOT the excess-vs-baseline number reported in the earlier study. Cost sensitivity table applies a flat round-trip % deduction (no slippage/spread modeled) at 0.05/0.10/0.15/0.20/0.30%. This project\'s established estimate for 0050 spot round-trip cost is 0.20% (highlighted separately as atEstablishedCost).',
      pooled: buildScope(results),
      half1: buildScope(half1),
      half2: buildScope(half2),
      note: 'Statistics only. No strategy recommendation, no threshold optimization. Interpretation intentionally left out of this JSON.',
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'ERROR', error: message, elapsedMs: Date.now() - startedAt }, { status: 500 });
  }
}

