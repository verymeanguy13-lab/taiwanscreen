// =============================================================================
// app/api/admin/sox-signal-check/route.ts
//
// v5 adds: on days that already triggered a bull/bear signal AND gapped the
// expected direction, does the price EXTEND through the day (close further
// in the same direction than the open) or FADE back (close moves back
// toward/past the prior close)? Uses data already in daily_prices — no new
// data source needed.
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

    let bullSignalDays = 0, bullGapHitDays = 0, bullExtendDays = 0, bullFadeDays = 0;
    let bearSignalDays = 0, bearGapHitDays = 0, bearExtendDays = 0, bearFadeDays = 0;
    let totalDaysAll = 0, gapUpDaysAll = 0, gapDownDaysAll = 0, closeUpDaysAll = 0, closeDownDaysAll = 0;

    const bullDetails: Array<{ date: string; gapUp: boolean; closeVsOpen: 'extend' | 'fade' | 'flat' | 'n/a' }> = [];
    const bearDetails: Array<{ date: string; gapDown: boolean; closeVsOpen: 'extend' | 'fade' | 'flat' | 'n/a' }> = [];
    const skipped: Array<{ date: string; reason: string }> = [];

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      const prevClose = priceRows[i - 1].close;
      const todayOpen = today.open;
      const todayClose = today.close;
      if (todayOpen == null || prevClose == null || todayClose == null) { skipped.push({ date: today.date, reason: 'missing open/close/prevClose' }); continue; }

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
      if (todayClose > todayOpen) closeUpDaysAll++;
      if (todayClose < todayOpen) closeDownDaysAll++;

      if (allUp && nightUp) {
        bullSignalDays++;
        // "extend" = close continued higher than the open (rode the gap further up)
        // "fade" = close came back down below the open (gave the gap back)
        // Only counted on days the gap actually hit — that's what "among gap-hit days" means.
        let closeVsOpen: 'extend' | 'fade' | 'flat' | 'n/a' = 'n/a';
        if (gapUp) {
          bullGapHitDays++;
          closeVsOpen = todayClose > todayOpen ? 'extend' : todayClose < todayOpen ? 'fade' : 'flat';
          if (closeVsOpen === 'extend') bullExtendDays++;
          if (closeVsOpen === 'fade') bullFadeDays++;
        }
        bullDetails.push({ date: today.date, gapUp, closeVsOpen });
      }
      if (allDown && nightDown) {
        bearSignalDays++;
        // "extend" = close continued lower than the open (rode the gap further down)
        // "fade" = close came back up above the open (gave the gap back)
        // Only counted on days the gap actually hit.
        let closeVsOpen: 'extend' | 'fade' | 'flat' | 'n/a' = 'n/a';
        if (gapDown) {
          bearGapHitDays++;
          closeVsOpen = todayClose < todayOpen ? 'extend' : todayClose > todayOpen ? 'fade' : 'flat';
          if (closeVsOpen === 'extend') bearExtendDays++;
          if (closeVsOpen === 'fade') bearFadeDays++;
        }
        bearDetails.push({ date: today.date, gapDown, closeVsOpen });
      }
    }

    const bullGapHitRate = bullSignalDays > 0 ? (bullGapHitDays / bullSignalDays) * 100 : null;
    const bearGapHitRate = bearSignalDays > 0 ? (bearGapHitDays / bearSignalDays) * 100 : null;
    const gapUpBaseRate = totalDaysAll > 0 ? (gapUpDaysAll / totalDaysAll) * 100 : null;
    const gapDownBaseRate = totalDaysAll > 0 ? (gapDownDaysAll / totalDaysAll) * 100 : null;

    // Among the days where the gap actually hit, how often did it extend vs fade?
    const bullExtendRate = bullGapHitDays > 0 ? (bullExtendDays / bullGapHitDays) * 100 : null;
    const bullFadeRate = bullGapHitDays > 0 ? (bullFadeDays / bullGapHitDays) * 100 : null;
    const bearExtendRate = bearGapHitDays > 0 ? (bearExtendDays / bearGapHitDays) * 100 : null;
    const bearFadeRate = bearGapHitDays > 0 ? (bearFadeDays / bearGapHitDays) * 100 : null;

    const closeUpBaseRate = totalDaysAll > 0 ? (closeUpDaysAll / totalDaysAll) * 100 : null;
    const closeDownBaseRate = totalDaysAll > 0 ? (closeDownDaysAll / totalDaysAll) * 100 : null;

    // ---- NET-OF-COST ANALYSIS ----
    // IMPORTANT: entering via a market-open order means you CANNOT capture the
    // overnight gap itself — your entry price already reflects it. The only
    // capturable P&L for a same-day entry/exit trade is the OPEN-TO-CLOSE move,
    // net of round-trip transaction costs. This computes that, not gap size.
    const roundTripCostPct = Number(searchParams.get('costPct') ?? '0.2'); // tax + commission estimate, override with ?costPct=

    function pctMove(from: number, to: number) { return ((to - from) / from) * 100; }
    function stats(values: number[]) {
      if (values.length === 0) return { mean: null, median: null, min: null, max: null, pctProfitableNetOfCost: null };
      const sorted = [...values].sort((a, b) => a - b);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[(sorted.length - 1) / 2];
      const pctProfitableNetOfCost = (values.filter(v => v > roundTripCostPct).length / values.length) * 100;
      return { mean, median, min: sorted[0], max: sorted[sorted.length - 1], pctProfitableNetOfCost };
    }

    // Open-to-close move, SIGNED so it's positive when it moved in the direction
    // you'd have traded (up for bull signal, down for bear signal — reported as
    // a positive "gain" for a short/sell position).
    const bullOpenToCloseMoves: number[] = [];
    const bearOpenToCloseMoves: number[] = [];
    const baselineAbsMoves: number[] = [];

    for (let i = 1; i < priceRows.length; i++) {
      const today = priceRows[i];
      const prevClose = priceRows[i - 1].close;
      const todayOpen = today.open;
      const todayClose = today.close;
      if (todayOpen == null || prevClose == null || todayClose == null) continue;
      baselineAbsMoves.push(Math.abs(pctMove(todayOpen, todayClose)));
    }
    for (const d of bullDetails) {
      const row = priceRows.find(p => p.date === d.date);
      const prevRow = priceRows[priceRows.findIndex(p => p.date === d.date) - 1];
      if (!row || !prevRow || row.open == null || row.close == null || !d.gapUp) continue;
      bullOpenToCloseMoves.push(pctMove(row.open, row.close)); // positive = gained holding long from open to close
    }
    for (const d of bearDetails) {
      const row = priceRows.find(p => p.date === d.date);
      if (!row || row.open == null || row.close == null || !d.gapDown) continue;
      bearOpenToCloseMoves.push(-pctMove(row.open, row.close)); // negate: positive = gained holding short from open to close
    }

    const bullMoveStats = stats(bullOpenToCloseMoves);
    const bearMoveStats = stats(bearOpenToCloseMoves);

    // CONTRARIAN: sell/short on bull-signal days, buy/long on bear-signal days —
    // just the negation of each day's move, recomputed properly (not just
    // flipping the mean, since pctProfitableNetOfCost doesn't mirror linearly).
    const bullContrarianMoves = bullOpenToCloseMoves.map(v => -v);
    const bearContrarianMoves = bearOpenToCloseMoves.map(v => -v);
    const bullContrarianStats = stats(bullContrarianMoves);
    const bearContrarianStats = stats(bearContrarianMoves);

    const baselineAvgAbsMove = baselineAbsMoves.length > 0
      ? baselineAbsMoves.reduce((a, b) => a + b, 0) / baselineAbsMoves.length
      : null;

    const response: Record<string, unknown> = {
      note: 'gapHitRate = did 0050 open in the expected direction. IMPORTANT: entering at the open cannot capture that gap — your entry price already reflects it. netOfCost figures below use the OPEN-TO-CLOSE move (what a same-day entry/exit trade could actually capture), minus an estimated round-trip cost.',
      roundTripCostPctUsed: roundTripCostPct,
      bull: {
        signalDays: bullSignalDays,
        gapHitDays: bullGapHitDays,
        gapHitRate: bullGapHitRate,
        gapBaseRate: gapUpBaseRate,
        extendDays: bullExtendDays,
        fadeDays: bullFadeDays,
        extendRate: bullExtendRate,
        fadeRate: bullFadeRate,
        extendBaseRate: closeUpBaseRate,
        openToCloseMovePct_asLong: bullMoveStats,
        openToCloseMovePct_asShort_CONTRARIAN: bullContrarianStats,
        recent: bullDetails.slice(-20),
      },
      bear: {
        signalDays: bearSignalDays,
        gapHitDays: bearGapHitDays,
        gapHitRate: bearGapHitRate,
        gapBaseRate: gapDownBaseRate,
        extendDays: bearExtendDays,
        fadeDays: bearFadeDays,
        extendRate: bearExtendRate,
        fadeRate: bearFadeRate,
        extendBaseRate: closeDownBaseRate,
        openToCloseMovePct_asShort: bearMoveStats,
        openToCloseMovePct_asLong_CONTRARIAN: bearContrarianStats,
        recent: bearDetails.slice(-20),
      },
      baselineAvgAbsOpenToCloseMovePct: baselineAvgAbsMove,
      totalDaysEvaluated: totalDaysAll,
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
