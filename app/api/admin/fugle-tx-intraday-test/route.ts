// =============================================================================
// app/api/admin/fugle-tx-intraday-test/route.ts
//
// DIAGNOSTIC ONLY. Fugle has a second, undocumented historical-candles
// endpoint under /futopt/ (separate from /stock/, which is what every prior
// route in this project has used for 0050). This tests whether it actually
// works for TX futures (product "TXF", front-month contract via the
// contractMonth=1! default), and inspects the raw shape — particularly how
// the "session" parameter (REGULAR day session vs AFTERHOURS night session)
// behaves, since a known SDK issue reports the sibling *intraday* endpoint
// ignoring afterHours and always returning day-session data. This checks
// whether that same issue applies to the *historical* endpoint.
//
// Does NOT store anything, does NOT build the TX opening-reaction study yet.
// =============================================================================

import { NextResponse } from 'next/server';

const BASE = 'https://api.fugle.tw/marketdata/v1.0/futopt';

async function fugleFetchRaw(path: string) {
  const key = process.env.FUGLE_API_KEY;
  if (!key) return { status: 0, ok: false, rawText: 'FUGLE_API_KEY not set', json: null as any };
  const res = await fetch(`${BASE}/${path}`, { headers: { 'X-API-KEY': key }, next: { revalidate: 0 } });
  const rawText = await res.text();
  let json: any = null;
  try { json = JSON.parse(rawText); } catch { /* leave null */ }
  return { status: res.status, ok: res.ok, rawText, json };
}

function fmt(d: Date) { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function hhmm(dateStr: string): string { const t = dateStr.indexOf('T'); return t >= 0 ? dateStr.slice(t + 1, t + 6) : dateStr.slice(11, 16); }
function dayOf(dateStr: string): string { return dateStr.slice(0, 10); }

export async function GET() {
  const to = new Date();
  const from = addDays(to, -12); // ~8-9 trading days, small and conservative
  const fromStr = fmt(from), toStr = fmt(to);

  const tests: Array<{ label: string; path: string; result: Awaited<ReturnType<typeof fugleFetchRaw>> }> = [];

  for (const session of ['REGULAR', 'AFTERHOURS']) {
    const path = `historical/candles/TXF?from=${fromStr}&to=${toStr}&timeframe=1&session=${session}`;
    const result = await fugleFetchRaw(path);
    tests.push({ label: `session=${session}`, path, result });
    await new Promise(r => setTimeout(r, 300));
  }
  // also test with no session param at all, to see the default behavior
  {
    const path = `historical/candles/TXF?from=${fromStr}&to=${toStr}&timeframe=1`;
    const result = await fugleFetchRaw(path);
    tests.push({ label: 'session=(omitted, default)', path, result });
  }

  const summaries = tests.map(t => {
    const rows = Array.isArray(t.result.json?.data) ? (t.result.json.data as Record<string, unknown>[]) : [];
    const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const days = [...new Set(sorted.map(r => dayOf(String(r.date))))].sort();
    const mostRecentDay = days[days.length - 1];
    const mostRecentDayRows = sorted.filter(r => dayOf(String(r.date)) === mostRecentDay);
    return {
      label: t.label,
      requestedPath: t.path,
      httpStatus: t.result.status,
      ok: t.result.ok,
      rawResponseSample: t.result.ok ? null : t.result.rawText.slice(0, 500),
      rawTopLevelKeys: t.result.json ? Object.keys(t.result.json) : null,
      returnedRows: rows.length,
      daysCovered: days,
      earliestTimestamp: sorted[0]?.date ?? null,
      latestTimestamp: sorted[sorted.length - 1]?.date ?? null,
      sampleFirst10: sorted.slice(0, 10),
      mostRecentDayFirst10: mostRecentDayRows.slice(0, 10),
      mostRecentDayEarliestTime: mostRecentDayRows[0] ? hhmm(String(mostRecentDayRows[0].date)) : null,
      mostRecentDayLatestTime: mostRecentDayRows.length ? hhmm(String(mostRecentDayRows[mostRecentDayRows.length - 1].date)) : null,
      hasVolumeField: rows.length ? Object.prototype.hasOwnProperty.call(rows[0], 'volume') : null,
    };
  });

  return NextResponse.json({
    status: 'OK',
    note: 'This endpoint (/futopt/historical/candles) is undocumented in Fugle\'s public docs, per their own SDK changelog. Nothing here should be assumed working until confirmed by the actual results below.',
    requestedFrom: fromStr,
    requestedTo: toStr,
    tests: summaries,
  });
}

