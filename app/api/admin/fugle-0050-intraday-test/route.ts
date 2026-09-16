// =============================================================================
// app/api/admin/fugle-0050-intraday-test/route.ts
//
// DIAGNOSTIC ONLY. Proof-of-concept for whether Fugle's documented
// GET /historical/candles/{symbol} endpoint actually returns 0050 1-minute
// intraday candles on the current (free-tier) FUGLE_API_KEY, and what shape
// that data is in.
//
// This does NOT modify lib/fugle.ts or its existing exported functions —
// those stay exactly as they are, still used for live quotes elsewhere.
// This route reuses the same auth pattern (same env var, same header, same
// base URL) as lib/fugle.ts's private fugleFetch(), but needs the raw HTTP
// status and raw response body even on failure (fugleFetch swallows both),
// so it talks to Fugle directly rather than importing that function.
//
// Does NOT store anything in the database. Does NOT return every candle —
// only a diagnostic summary, per spec. Never logs or returns the API key.
// =============================================================================

import { NextResponse } from 'next/server';

const BASE = 'https://api.fugle.tw/marketdata/v1.0/stock';

async function fugleFetchRaw(path: string) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { 'X-API-KEY': process.env.FUGLE_API_KEY ?? '' },
    next: { revalidate: 0 },
  });
  const rawText = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(rawText); } catch { /* leave null, rawText kept for diagnostics */ }
  return { status: res.status, ok: res.ok, json, rawText };
}

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Pull the raw date/timestamp string off a candle row without assuming
// which field name Fugle actually uses — inspect, don't guess.
function rowDateStr(row: Record<string, unknown>): string {
  return (row.date as string) ?? (row.timestamp as string) ?? (row.time as string) ?? '';
}

// "2026-09-01T09:03:00.000+08:00" -> "09:03". Same substring technique
// already used in lib/fugle.ts's getFugleTicks for the same reason: Fugle's
// timestamps come back as local-time ISO strings with the offset embedded.
function hhmm(row: Record<string, unknown>): string {
  const s = rowDateStr(row);
  const tIdx = s.indexOf('T');
  return tIdx >= 0 ? s.slice(tIdx + 1, tIdx + 6) : s.slice(11, 16);
}

export async function GET() {
  if (!process.env.FUGLE_API_KEY) {
    return NextResponse.json({ status: 'ERROR', error: 'FUGLE_API_KEY is not set in this environment' }, { status: 500 });
  }

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 16); // ~16 calendar days back to safely cover ~10 trading days
  const fromStr = formatDate(from);
  const toStr = formatDate(to);

  const path = `historical/candles/0050?from=${fromStr}&to=${toStr}&timeframe=1`;

  let fetchResult: Awaited<ReturnType<typeof fugleFetchRaw>>;
  try {
    fetchResult = await fugleFetchRaw(path);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: 'ERROR', error: message, requestedFrom: fromStr, requestedTo: toStr }, { status: 500 });
  }

  if (!fetchResult.ok || fetchResult.json === null) {
    return NextResponse.json({
      status: 'ERROR',
      httpStatus: fetchResult.status,
      requestedFrom: fromStr,
      requestedTo: toStr,
      requestedPath: path,
      rawResponseSample: fetchResult.rawText.slice(0, 1500),
    });
  }

  const body = fetchResult.json as Record<string, unknown>;

  // Don't assume the wrapper shape either — try `data` array, fall back to
  // the body itself being the array.
  let rows: Record<string, unknown>[] = [];
  if (Array.isArray(body.data)) {
    rows = body.data as Record<string, unknown>[];
  } else if (Array.isArray(body)) {
    rows = body as unknown as Record<string, unknown>[];
  }

  const sorted = [...rows].sort((a, b) => rowDateStr(a).localeCompare(rowDateStr(b)));

  const byDay = new Map<string, Record<string, unknown>[]>();
  for (const r of sorted) {
    const day = rowDateStr(r).slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(r);
  }
  const days = [...byDay.keys()].sort();
  const mostRecentDay = days[days.length - 1];
  const mostRecentDayRows = mostRecentDay ? byDay.get(mostRecentDay)! : [];

  const hasTime = (target: string) => mostRecentDayRows.some(r => hhmm(r) === target);
  const around0900 = mostRecentDayRows.filter(r => {
    const t = hhmm(r);
    return t >= '08:58' && t <= '09:07';
  });

  return NextResponse.json({
    status: 'OK',
    symbol: '0050',
    timeframe: '1',
    requestedFrom: fromStr,
    requestedTo: toStr,
    requestedPath: path,
    returnedRows: rows.length,
    daysCoveredInResponse: days,
    earliestTimestamp: sorted[0] ? rowDateStr(sorted[0]) : null,
    latestTimestamp: sorted[sorted.length - 1] ? rowDateStr(sorted[sorted.length - 1]) : null,
    rawTopLevelKeys: Object.keys(body),
    sampleFirst10: sorted.slice(0, 10),
    mostRecentDayUsedForSample: mostRecentDay ?? null,
    sampleRowsAround0900: around0900,
    has0900: hasTime('09:00'),
    has0901: hasTime('09:01'),
    has0903: hasTime('09:03'),
    has0905: hasTime('09:05'),
    has0910: hasTime('09:10'),
    has0915: hasTime('09:15'),
    has0930: hasTime('09:30'),
  });
}

