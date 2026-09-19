// =============================================================================
// app/api/admin/tx-post-open-signal-days/route.ts
//
// READ-ONLY research endpoint. Does NOT touch daily_prices, does NOT write
// to any table, does NOT change the Bull/Bear signal definition used
// elsewhere in the project. It reuses the exact same signal logic as
// sox-signal-check (Dow/S&P/Nasdaq/SOX all up or all down vs prior close,
// AND TX night session close vs open), but:
//   1. Uses FinMind's TX night-session dates as the master trading-day
//      calendar (not 0050's daily_prices), since this study is about TX
//      itself, not 0050.
//   2. Returns the FULL list of BULL/BEAR/NONE trading dates (not just the
//      last 20), for external cross-referencing against the TX 1-minute
//      dataset used in the post-open reaction study.
//
// Query params: start_date=YYYY-MM-DD, end_date=YYYY-MM-DD (both required)
// =============================================================================

import { NextResponse } from 'next/server';

interface IndexRow {
  date: string;
  close: number;
}

interface FinMindTXRow {
  date: string;
  trading_session: string;
  open: number;
  close: number;
  volume: number;
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
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'start_date and end_date (YYYY-MM-DD) are required' }, { status: 400 });
  }

  try {
    const indexResults = await Promise.all(
      INDICES.map(async idx => {
        const rows = await fetchYahooDaily(idx.ticker);
        return { ...idx, dates: rows.map(r => r.date), byDate: new Map(rows.map(r => [r.date, r.close])) };
      })
    );

    // Fetch TX night-session data from a bit before start_date so index
    // "prior close" lookups near the boundary still resolve.
    const fetchFrom = new Date(startDate);
    fetchFrom.setDate(fetchFrom.getDate() - 14);
    const frontMonthRows = await fetchTxFuturesDaily(fetchFrom.toISOString().slice(0, 10));

    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of frontMonthRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

    // Master calendar: TX night-session trading dates within [start_date, end_date]
    const tradingDates = [...txByDate.keys()]
      .filter(d => d >= startDate && d <= endDate)
      .sort();

    const bullDates: string[] = [];
    const bearDates: string[] = [];
    const noneDates: string[] = [];
    const excluded: Array<{ date: string; reason: string }> = [];

    for (const date of tradingDates) {
      const dirs = indexResults.map(idx => indexDirection(idx.dates as string[], idx.byDate as Map<string, number>, date));
      if (dirs.some(d => d === null)) { excluded.push({ date, reason: 'missing index data' }); continue; }
      const allUp = dirs.every(d => d!.up);
      const allDown = dirs.every(d => d!.down);

      const tx = txByDate.get(date);
      if (!tx || tx.nightOpen == null || tx.nightClose == null) { excluded.push({ date, reason: 'no TX night session data' }); continue; }
      const nightUp = tx.nightClose > tx.nightOpen;
      const nightDown = tx.nightClose < tx.nightOpen;

      if (allUp && nightUp) bullDates.push(date);
      else if (allDown && nightDown) bearDates.push(date);
      else noneDates.push(date);
    }

    return NextResponse.json({
      note: 'Read-only. Signal definition identical to sox-signal-check: BULL = Dow+S&P500+Nasdaq+SOX all up vs prior close AND TX night close > night open; BEAR = all down AND night close < night open; else NONE.',
      startDate, endDate,
      totalTradingDates: tradingDates.length,
      bullCount: bullDates.length,
      bearCount: bearDates.length,
      noneCount: noneDates.length,
      excludedCount: excluded.length,
      excluded,
      bullDates,
      bearDates,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
