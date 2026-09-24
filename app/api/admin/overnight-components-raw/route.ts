// =============================================================================
// app/api/admin/overnight-components-raw/route.ts
//
// READ-ONLY DIAGNOSTIC. Returns per-day continuous values (not a classification):
//   dow_return, sp500_return, nasdaq_return, sox_return, tx_night_return
//   + the next-day 0050 opening gap + the existing BULL/BEAR/NONE label.
//
// Reuses the exact same fetch/index-move logic already deployed in
// signal-strength-check.ts (same Yahoo + FinMind sources, same "prior close
// vs close before that" lookup so nothing here is known before ~05:00).
// No new signal, no classification change -- only exposes per-day numbers
// that were already being computed internally but never returned raw.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface DailyPriceRow { date: string; open: number | null; close: number | null; }
interface FinMindTXRow { date: string; trading_session: string; open: number; close: number; volume: number; }
interface IndexRow { date: string; close: number; }

const INDICES = [
  { key: 'dow_return', ticker: '^DJI' },
  { key: 'sp500_return', ticker: '^GSPC' },
  { key: 'nasdaq_return', ticker: '^IXIC' },
  { key: 'sox_return', ticker: '^SOX' },
] as const;

async function fetchYahooDaily(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=10y&interval=1d`;
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

// Same lookup as signal-strength-check: the % move of the index's prior
// close vs the close before that -- i.e. the move already known as of
// today's ~05:00 signal time. Never uses today's own close.
function indexMove(dates: string[], byDate: Map<string, number>, today: string) {
  const priorDate = [...dates].reverse().find(d => d < today);
  if (!priorDate) return null;
  const priorIdx = dates.indexOf(priorDate);
  if (priorIdx <= 0) return null;
  const close = byDate.get(priorDate)!;
  const prevClose = byDate.get(dates[priorIdx - 1])!;
  if (prevClose === 0) return null;
  return ((close - prevClose) / prevClose) * 100;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'start_date and end_date (YYYY-MM-DD) are required' }, { status: 400 });
  }

  try {
    const priceRows = await sql`
      SELECT date::text AS date, open, close
      FROM daily_prices
      WHERE symbol = '0050' AND date >= ${startDate} AND date <= ${endDate}
      ORDER BY date ASC
    ` as unknown as DailyPriceRow[];

    if (priceRows.length < 2) {
      return NextResponse.json({ error: 'Not enough 0050 price history in range' }, { status: 400 });
    }

    const indexResults = await Promise.all(
      INDICES.map(async idx => {
        const rows = await fetchYahooDaily(idx.ticker);
        return { ...idx, dates: rows.map(r => r.date), byDate: new Map(rows.map(r => [r.date, r.close])) };
      })
    );

    const frontMonthRows = await fetchTxFuturesDaily(startDate);
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of frontMonthRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

    const out: Array<Record<string, unknown>> = [];
    const excluded: Array<{ date: string; reason: string }> = [];

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      const prevClose = priceRows[i - 1].close;
      if (today.open == null || prevClose == null) { excluded.push({ date: today.date, reason: 'missing 0050 open/prior close' }); continue; }

      const row: Record<string, unknown> = { date: today.date };
      let anyMissing = false;
      for (const idx of indexResults) {
        const pct = indexMove(idx.dates as string[], idx.byDate as Map<string, number>, today.date);
        if (pct === null) anyMissing = true;
        row[idx.key] = pct;
      }
      const tx = txByDate.get(today.date);
      if (!tx || tx.nightOpen == null || tx.nightClose == null) {
        anyMissing = true;
        row['tx_night_return'] = null;
      } else {
        row['tx_night_return'] = ((tx.nightClose - tx.nightOpen) / tx.nightOpen) * 100;
      }

      if (anyMissing) { excluded.push({ date: today.date, reason: 'missing one or more overnight components' }); continue; }

      row['gapPct'] = (today.open / prevClose - 1) * 100;

      const dow = row['dow_return'] as number, sp = row['sp500_return'] as number,
            nq = row['nasdaq_return'] as number, sx = row['sox_return'] as number,
            tx_ = row['tx_night_return'] as number;
      const allUp = dow > 0 && sp > 0 && nq > 0 && sx > 0 && tx_ > 0;
      const allDown = dow < 0 && sp < 0 && nq < 0 && sx < 0 && tx_ < 0;
      row['signal'] = allUp ? 'BULL' : (allDown ? 'BEAR' : 'NONE');

      out.push(row);
    }

    return NextResponse.json({
      note: 'READ-ONLY diagnostic. Per-day continuous overnight component returns + next-day 0050 opening gap + signal label. dow/sp500/nasdaq/sox_return = pct move of that index\'s prior close vs the close before it (known by ~05:00 Taipei). tx_night_return = TX night-session close vs open (known by ~05:00). gapPct = 0050 open_t / priorClose_t - 1. No split adjustment applied here -- handle the 2025-06-18 ~4:1 split externally, same as prior studies.',
      startDate, endDate,
      count: out.length,
      excludedCount: excluded.length,
      excluded,
      data: out,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}