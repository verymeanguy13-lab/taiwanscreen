// =============================================================================
// app/api/admin/fugle-open-validation-check/route.ts
//
// DIAGNOSTIC ONLY. Before building the opening-reaction backtest, this
// establishes whether the official daily_prices 0050 open can be cleanly
// paired with Fugle's first available 1-minute intraday candles (which start
// at 09:02, not 09:00 — confirmed in the prior diagnostic).
//
// Does NOT create a trading strategy, does NOT optimize anything, does NOT
// write to the database, does NOT modify lib/fugle.ts or any existing route.
// Selects the 15 most recent trading days that have BOTH an official
// daily_prices open AND at least some Fugle 1-minute data, then reports a
// data-quality + timestamp-alignment picture only.
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

// ---------------------------------------------------------------------------
// Reused from sox-signal-check / signal-strength-check (same conventions,
// duplicated per this project's existing pattern of self-contained routes —
// not extracted into lib/ so as not to touch working code).
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
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`;
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
function pctMove(from: number, to: number) { return ((to - from) / from) * 100; }

// ---------------------------------------------------------------------------
// Fugle candle fetch — same auth pattern as lib/fugle.ts (env var, header,
// base URL), not importing it, for the same reason as the prior diagnostic:
// need the raw shape, not the parsed live-quote type.
// ---------------------------------------------------------------------------

interface FugleCandle {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

async function fetchFugleMinuteCandles(fromStr: string, toStr: string): Promise<{ ok: boolean; candles: FugleCandle[]; error?: string }> {
  const key = process.env.FUGLE_API_KEY;
  if (!key) return { ok: false, candles: [], error: 'FUGLE_API_KEY not set' };
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/0050?from=${fromStr}&to=${toStr}&timeframe=1`;
  try {
    const res = await fetch(url, { headers: { 'X-API-KEY': key }, next: { revalidate: 0 } });
    const rawText = await res.text();
    if (!res.ok) return { ok: false, candles: [], error: `HTTP ${res.status}: ${rawText.slice(0, 300)}` };
    let json: any = null;
    try { json = JSON.parse(rawText); } catch { return { ok: false, candles: [], error: 'response was not valid JSON' }; }
    const rows = Array.isArray(json?.data) ? json.data as Record<string, unknown>[] : [];
    const candles: FugleCandle[] = rows.map(r => ({
      date: (r.date as string) ?? '',
      open: (r.open as number) ?? null,
      high: (r.high as number) ?? null,
      low: (r.low as number) ?? null,
      close: (r.close as number) ?? null,
      volume: (r.volume as number) ?? null,
    }));
    return { ok: true, candles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, candles: [], error: message };
  }
}

function hhmm(dateStr: string): string {
  const tIdx = dateStr.indexOf('T');
  return tIdx >= 0 ? dateStr.slice(tIdx + 1, tIdx + 6) : dateStr.slice(11, 16);
}
function dayOf(dateStr: string): string {
  return dateStr.slice(0, 10);
}

const TARGET_MINUTES = ['09:02', '09:03', '09:04', '09:05', '09:06', '09:10', '09:15', '09:30'] as const;
const TABLE_MINUTES = ['09:02', '09:03', '09:05', '09:10', '09:15', '09:30'] as const;

// ---------------------------------------------------------------------------

export async function GET() {
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

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 35); // buffer well past 15 trading days incl. holidays
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const fugleResult = await fetchFugleMinuteCandles(fromStr, toStr);
    if (!fugleResult.ok) {
      return NextResponse.json({ status: 'ERROR', stage: 'fugle-fetch', error: fugleResult.error }, { status: 500 });
    }

    // Group Fugle candles by day, checking for duplicate timestamps as we go.
    const byDay = new Map<string, FugleCandle[]>();
    const duplicateTimestamps: Array<{ date: string; time: string; count: number }> = [];
    const timezoneIssues: string[] = [];
    for (const c of fugleResult.candles) {
      if (!c.date.includes('+08:00')) timezoneIssues.push(c.date);
      const day = dayOf(c.date);
      if (!day) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(c);
    }
    for (const [day, candles] of byDay) {
      const counts = new Map<string, number>();
      for (const c of candles) {
        const t = hhmm(c.date);
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      for (const [t, n] of counts) {
        if (n > 1) duplicateTimestamps.push({ date: day, time: t, count: n });
      }
    }

    // Build a per-day, per-minute lookup (last candle wins if duplicates exist).
    const byDayMinute = new Map<string, Map<string, FugleCandle>>();
    for (const [day, candles] of byDay) {
      const m = new Map<string, FugleCandle>();
      for (const c of [...candles].sort((a, b) => a.date.localeCompare(b.date))) {
        m.set(hhmm(c.date), c);
      }
      byDayMinute.set(day, m);
    }

    // Abnormal OHLC + zero/negative price check, across all fetched candles.
    const abnormalOhlc: Array<{ date: string; time: string; issue: string }> = [];
    for (const [day, candles] of byDay) {
      for (const c of candles) {
        const t = hhmm(c.date);
        if (c.open == null || c.high == null || c.low == null || c.close == null) {
          abnormalOhlc.push({ date: day, time: t, issue: 'null OHLC field' });
          continue;
        }
        if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
          abnormalOhlc.push({ date: day, time: t, issue: 'zero or negative price' });
        }
        if (c.high < c.low) {
          abnormalOhlc.push({ date: day, time: t, issue: 'high < low' });
        }
        if (c.close > c.high || c.close < c.low) {
          abnormalOhlc.push({ date: day, time: t, issue: 'close outside high/low range' });
        }
        if (c.open > c.high || c.open < c.low) {
          abnormalOhlc.push({ date: day, time: t, issue: 'open outside high/low range' });
        }
      }
    }

    // Suspicious gaps between consecutive minute candles within a day
    // (during 09:02-13:30) — flag any gap over 2 minutes.
    const suspiciousGaps: Array<{ date: string; fromTime: string; toTime: string; gapMinutes: number }> = [];
    for (const [day, candles] of byDay) {
      const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 1; i < sorted.length; i++) {
        const prevT = new Date(sorted[i - 1].date).getTime();
        const curT = new Date(sorted[i].date).getTime();
        const gapMin = (curT - prevT) / 60000;
        if (gapMin > 2) {
          suspiciousGaps.push({ date: day, fromTime: hhmm(sorted[i - 1].date), toTime: hhmm(sorted[i].date), gapMinutes: gapMin });
        }
      }
    }

    // ---- Select the 15 most recent trading days with both data sources ----
    type Row = {
      date: string;
      signal: 'Bull' | 'Bear' | 'None';
      previousClose: number;
      officialOpen: number;
      gapPct: number;
      closes: Record<string, number | null>;
      pctFromOpen: Record<string, number | null>;
      missingMinutes: string[];
    };

    const selected: Row[] = [];
    const indexResults = await Promise.all(
      INDICES.map(async idx => {
        const rows = await fetchYahooDaily(idx.ticker);
        return { ...idx, dates: rows.map(r => r.date), byDate: new Map(rows.map(r => [r.date, r.close])) };
      })
    );
    const earliestNeeded = priceRows[Math.max(0, priceRows.length - 40)].date;
    const frontMonthRows = await fetchTxFuturesDaily(earliestNeeded);
    const txByDate = new Map<string, { nightOpen?: number; nightClose?: number }>();
    for (const row of frontMonthRows) {
      if (row.trading_session !== 'after_market') continue;
      txByDate.set(row.date, { nightOpen: row.open, nightClose: row.close });
    }

    for (let i = priceRows.length - 1; i >= 1 && selected.length < 15; i--) {
      const today = priceRows[i];
      const prev = priceRows[i - 1];
      if (today.open == null || prev.close == null) continue; // official open/prevClose missing
      const dayMinutes = byDayMinute.get(today.date);
      if (!dayMinutes || dayMinutes.size === 0) continue; // no Fugle data at all for this date

      const closes: Record<string, number | null> = {};
      const pctFromOpen: Record<string, number | null> = {};
      const missingMinutes: string[] = [];
      for (const m of TARGET_MINUTES) {
        const candle = dayMinutes.get(m);
        const c = candle?.close ?? null;
        closes[m] = c;
        pctFromOpen[m] = c != null ? pctMove(today.open, c) : null;
        if (c == null) missingMinutes.push(m);
      }

      // Signal for this date, using the existing project definition.
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

      selected.unshift({
        date: today.date,
        signal,
        previousClose: prev.close,
        officialOpen: today.open,
        gapPct: pctMove(prev.close, today.open),
        closes,
        pctFromOpen,
        missingMinutes,
      });
    }

    // ---- Aggregates (Part 6 + 7) ----
    function aggFor(minute: string) {
      const signed = selected.map(r => r.pctFromOpen[minute]).filter((v): v is number => v != null);
      const abs = signed.map(v => Math.abs(v));
      return {
        n: signed.length,
        meanSigned: mean(signed),
        medianSigned: median(signed),
        meanAbs: mean(abs),
        medianAbs: median(abs),
      };
    }
    const aggregates: Record<string, ReturnType<typeof aggFor>> = {};
    for (const m of TABLE_MINUTES) aggregates[m] = aggFor(m);

    // ---- Build the printed table (Part 5) ----
    const table = selected.map(r => ({
      date: r.date,
      previousClose: r.previousClose,
      officialOpen: r.officialOpen,
      close_0902: r.closes['09:02'],
      close_0903: r.closes['09:03'],
      close_0905: r.closes['09:05'],
      close_0910: r.closes['09:10'],
      close_0915: r.closes['09:15'],
      close_0930: r.closes['09:30'],
      openToGapPct: Number(r.gapPct.toFixed(4)),
      openTo0902Pct: r.pctFromOpen['09:02'] != null ? Number(r.pctFromOpen['09:02']!.toFixed(4)) : null,
      openTo0903Pct: r.pctFromOpen['09:03'] != null ? Number(r.pctFromOpen['09:03']!.toFixed(4)) : null,
      openTo0905Pct: r.pctFromOpen['09:05'] != null ? Number(r.pctFromOpen['09:05']!.toFixed(4)) : null,
      openTo0910Pct: r.pctFromOpen['09:10'] != null ? Number(r.pctFromOpen['09:10']!.toFixed(4)) : null,
      openTo0915Pct: r.pctFromOpen['09:15'] != null ? Number(r.pctFromOpen['09:15']!.toFixed(4)) : null,
      openTo0930Pct: r.pctFromOpen['09:30'] != null ? Number(r.pctFromOpen['09:30']!.toFixed(4)) : null,
      signal: r.signal,
      missingMinutes: r.missingMinutes,
    }));

    const missingCandleReport = selected
      .filter(r => r.missingMinutes.length > 0)
      .map(r => ({ date: r.date, missing: r.missingMinutes }));

    const response = {
      status: 'OK',
      filesModified: ['app/api/admin/fugle-open-validation-check/route.ts (new file only)'],
      endpoint: '/api/admin/fugle-open-validation-check',
      fugleRequestRange: { from: fromStr, to: toStr, timeframe: '1' },
      selectedDayCount: selected.length,
      table,
      aggregateStatistics: aggregates,
      timestampSemanticsConclusion: {
        conclusion: 'Likely: each candle\'s timestamp marks the START of its 1-minute interval (open = first trade in that minute, close = last trade in that minute).',
        confidence: 'Inferred, not certain — Fugle\'s own /futopt/intraday/candles example (same date/OHLCV response shape as this stock endpoint) shows a 30-minute candle stamped 08:30 immediately followed by one stamped 09:00, i.e. the 08:30 candle covers the 08:30-09:00 interval, which only makes sense if the timestamp marks the interval START. No explicit statement of this was found in Fugle\'s stock-candle documentation text itself, so this is a same-API-family inference, not a confirmed spec.',
        implication: 'A candle stamped 09:02 most likely covers 09:02:00-09:03:00, not a snapshot AT 09:02:00 exactly.',
      },
      dataQualityFindings: {
        missingCandlesByDate: missingCandleReport,
        duplicateTimestamps,
        abnormalOhlcRows: abnormalOhlc,
        suspiciousGapsOver2Min: suspiciousGaps,
        timezoneStringIssues: timezoneIssues,
        officialOpenOrPrevCloseMissing: 'none among the 15 selected dates — dates lacking either were skipped during selection, per Part 2',
      },
      whatThisMeansForTheNextTest: {
        A_canUseOfficialOpenAsStartingPrice: 'Yes — every selected date had a non-null daily_prices open and previous close.',
        B_canReliablyMeasurePostOpenMovement: 'Yes, starting from 09:02, not 09:00 — see missingCandlesByDate for any date-specific gaps found even after 09:02.',
        C_windowsAvailable: TABLE_MINUTES,
        D_unresolvedIssues: (duplicateTimestamps.length + abnormalOhlc.length + suspiciousGaps.length + timezoneIssues.length) > 0
          ? 'Yes — see dataQualityFindings above for specifics found in this sample.'
          : 'None found in this sample of 15 days.',
      },
      note: 'This does NOT answer whether the five-indicator signal predicts anything. Signal column is shown descriptively only, per Part 8.',
    };

    return NextResponse.json(response);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'ERROR', error: message }, { status: 500 });
  }
}

