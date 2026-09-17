// =============================================================================
// app/api/admin/fugle-depth-check/route.ts
//
// READ-ONLY DIAGNOSTIC. Determines the REAL (empirically verified) historical
// depth of Fugle's free-tier 1-minute 0050 candles, vs. Fugle's documented
// depth (~2023-05-23), plus how the API behaves with different from/to window
// sizes, and whether any rate limiting is encountered.
//
// Does NOT create, write to, or touch any database table. Does NOT build an
// importer. Does NOT run any strategy study. Sequential requests only, with a
// short delay between each, per the task's "do not hammer the API" rule.
// =============================================================================

import { NextResponse } from 'next/server';

interface FugleCandle {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
}

interface RawFugleResult {
  httpStatus: number;
  ok: boolean;
  errorBodySample?: string;
  topLevelKeys?: string[];
  candles: FugleCandle[];
}

async function fetchFugleRange(fromStr: string, toStr: string): Promise<RawFugleResult> {
  const key = process.env.FUGLE_API_KEY;
  if (!key) {
    return { httpStatus: 0, ok: false, errorBodySample: 'FUGLE_API_KEY not set', candles: [] };
  }
  const url = `https://api.fugle.tw/marketdata/v1.0/stock/historical/candles/0050?from=${fromStr}&to=${toStr}&timeframe=1`;
  try {
    const res = await fetch(url, { headers: { 'X-API-KEY': key }, next: { revalidate: 0 } });
    const rawText = await res.text();
    let json: any = null;
    try { json = JSON.parse(rawText); } catch { /* leave null */ }
    if (!res.ok || !json) {
      return { httpStatus: res.status, ok: false, errorBodySample: rawText.slice(0, 400), candles: [] };
    }
    const rows = Array.isArray(json.data) ? (json.data as Record<string, unknown>[]) : [];
    const candles: FugleCandle[] = rows.map(r => ({
      date: (r.date as string) ?? '',
      open: (r.open as number) ?? null,
      high: (r.high as number) ?? null,
      low: (r.low as number) ?? null,
      close: (r.close as number) ?? null,
      volume: (r.volume as number) ?? null,
    }));
    return { httpStatus: res.status, ok: true, topLevelKeys: Object.keys(json), candles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { httpStatus: 0, ok: false, errorBodySample: message, candles: [] };
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function hhmm(dateStr: string): string {
  const tIdx = dateStr.indexOf('T');
  return tIdx >= 0 ? dateStr.slice(tIdx + 1, tIdx + 6) : dateStr.slice(11, 16);
}
function dayOf(dateStr: string): string {
  return dateStr.slice(0, 10);
}
function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[(sorted.length - 1) / 2];
}

type Classification = 'A' | 'B' | 'C' | 'D' | 'E';

function classify(result: RawFugleResult): Classification {
  if (result.httpStatus === 401 || result.httpStatus === 403 || result.httpStatus === 429) return 'D';
  if (!result.ok) {
    const body = (result.errorBodySample ?? '').toLowerCase();
    if (body.includes('range') || body.includes('exceed') || body.includes('not available') || body.includes('out of')) return 'E';
    return 'C';
  }
  if (result.candles.length === 0) return 'B';
  return 'A';
}

const CLASSIFICATION_LEGEND = {
  A: 'API returned real candle data',
  B: 'API responded successfully but no data for this window (likely a non-trading window)',
  C: 'API returned an error (not auth/rate-limit related)',
  D: 'Request failed due to authentication or rate limiting (401/403/429)',
  E: 'Response indicates the window/date is outside the available historical range',
};

export async function GET() {
  // ---------------- Part 1: fixed date probes ----------------
  const dateTargets = [
    '2023-05-23', '2023-06-01', '2023-07-03', '2023-10-02',
    '2024-01-02', '2024-04-01', '2024-07-01', '2024-10-01',
    '2025-01-02', '2025-04-01', '2025-07-01', '2025-10-01',
    '2026-01-02', '2026-04-01', '2026-07-01',
  ];
  const recentAnchor = fmt(addDays(new Date(), -3)); // a likely-completed recent trading day
  const allDateTargets = [...dateTargets, recentAnchor];

  const dateResults: Array<{
    targetDate: string;
    requestedFrom: string;
    requestedTo: string;
    httpStatus: number;
    classification: Classification;
    classificationMeaning: string;
    errorBodySample: string | null;
    returnedRows: number;
    daysWithData: string[];
    earliestTimestamp: string | null;
    latestTimestamp: string | null;
    first3Timestamps: string[];
    last3Timestamps: string[];
    has0900: boolean;
    has0901: boolean;
    has0902: boolean;
    hasRegularSessionData: boolean;
    timezoneOk: boolean;
    topLevelKeys: string[] | null;
  }> = [];

  for (const target of allDateTargets) {
    // ±2-day window around each target date, rather than a single exact day,
    // so a non-trading-day target (weekend/holiday) doesn't get misread as
    // "no data available" when a nearby day would answer the real question —
    // done this way (one request per target) instead of extra probing calls,
    // to keep total request count small per the task's own instruction.
    const targetDate = new Date(target + 'T00:00:00Z');
    const fromStr = fmt(addDays(targetDate, -2));
    const toStr = fmt(addDays(targetDate, 2));
    const result = await fetchFugleRange(fromStr, toStr);
    const classification = classify(result);
    const sorted = [...result.candles].sort((a, b) => a.date.localeCompare(b.date));
    const days = [...new Set(sorted.map(c => dayOf(c.date)))].sort();

    dateResults.push({
      targetDate: target,
      requestedFrom: fromStr,
      requestedTo: toStr,
      httpStatus: result.httpStatus,
      classification,
      classificationMeaning: CLASSIFICATION_LEGEND[classification],
      errorBodySample: result.errorBodySample ?? null,
      returnedRows: result.candles.length,
      daysWithData: days,
      earliestTimestamp: sorted[0]?.date ?? null,
      latestTimestamp: sorted[sorted.length - 1]?.date ?? null,
      first3Timestamps: sorted.slice(0, 3).map(c => c.date),
      last3Timestamps: sorted.slice(-3).map(c => c.date),
      has0900: sorted.some(c => hhmm(c.date) === '09:00'),
      has0901: sorted.some(c => hhmm(c.date) === '09:01'),
      has0902: sorted.some(c => hhmm(c.date) === '09:02'),
      hasRegularSessionData: sorted.some(c => { const t = hhmm(c.date); return t >= '09:00' && t <= '13:30'; }),
      timezoneOk: sorted.length === 0 ? true : sorted.every(c => c.date.includes('+08:00')),
      topLevelKeys: result.topLevelKeys ?? null,
    });
    await sleep(300);
  }

  // ---------------- Part 2: window-size behavior ----------------
  const windowSpecs: Array<{ label: string; days: number }> = [
    { label: '1-day', days: 1 },
    { label: '7-day', days: 7 },
    { label: '30-day', days: 30 },
    { label: '90-day', days: 90 },
    { label: '180-day', days: 180 },
    { label: '365-day', days: 365 },
  ];
  const windowAnchorToDate = addDays(new Date(), -2); // avoid a still-forming "today"
  const windowAnchorTo = fmt(windowAnchorToDate);

  let candlesPerTradingDayEstimate: number | null = null;

  const windowResults: Array<{
    label: string;
    requestedFrom: string;
    requestedTo: string;
    requestedSpanDays: number;
    httpStatus: number;
    classification: Classification;
    classificationMeaning: string;
    errorBodySample: string | null;
    returnedRows: number;
    distinctDaysReturned: number;
    earliestDayReturned: string | null;
    latestDayReturned: string | null;
    actualSpanCoveredCalendarDays: number | null;
    appearsTruncated: boolean;
  }> = [];

  for (const spec of windowSpecs) {
    const fromStr = fmt(addDays(windowAnchorToDate, -spec.days));
    const result = await fetchFugleRange(fromStr, windowAnchorTo);
    const classification = classify(result);
    const sorted = [...result.candles].sort((a, b) => a.date.localeCompare(b.date));
    const days = [...new Set(sorted.map(c => dayOf(c.date)))].sort();
    const actualSpan = days.length
      ? (new Date(days[days.length - 1]).getTime() - new Date(days[0]).getTime()) / 86400000
      : null;
    const appearsTruncated = spec.days > 30 && actualSpan != null && actualSpan < spec.days * 0.5;

    if (spec.label === '7-day' && days.length > 0) {
      const perDayCounts = days.map(d => sorted.filter(c => dayOf(c.date) === d).length);
      candlesPerTradingDayEstimate = median(perDayCounts);
    }

    windowResults.push({
      label: spec.label,
      requestedFrom: fromStr,
      requestedTo: windowAnchorTo,
      requestedSpanDays: spec.days,
      httpStatus: result.httpStatus,
      classification,
      classificationMeaning: CLASSIFICATION_LEGEND[classification],
      errorBodySample: result.errorBodySample ?? null,
      returnedRows: result.candles.length,
      distinctDaysReturned: days.length,
      earliestDayReturned: days[0] ?? null,
      latestDayReturned: days[days.length - 1] ?? null,
      actualSpanCoveredCalendarDays: actualSpan,
      appearsTruncated,
    });
    await sleep(300);
  }

  // ---------------- Summary ----------------
  const rateLimitHits = [...dateResults, ...windowResults].filter(r => r.classification === 'D');
  const successfulDates = dateResults.filter(r => r.classification === 'A');
  const oldestSuccessful = successfulDates.length
    ? successfulDates.reduce((min, r) => (r.targetDate < min.targetDate ? r : min))
    : null;
  const test20230523 = dateResults.find(r => r.targetDate === '2023-05-23') ?? null;

  const withKeys = dateResults.filter(r => r.topLevelKeys);
  let structureConsistency = 'insufficient successful responses to compare';
  if (withKeys.length >= 2) {
    const first = JSON.stringify([...(withKeys[0].topLevelKeys as string[])].sort());
    const allSame = withKeys.every(r => JSON.stringify([...(r.topLevelKeys as string[])].sort()) === first);
    structureConsistency = allSame
      ? 'Yes — identical top-level response keys across all successful test dates.'
      : 'No — response shape differed between some dates; see topLevelKeys per date_tests entry.';
  }

  const summary = {
    oldestSuccessfullyRetrievedDate: oldestSuccessful ? oldestSuccessful.targetDate : null,
    boundaryCaveat: 'This is the oldest of the PRE-SPECIFIED test dates that returned real data — not a true boundary found by bisection search. The task intentionally limits calls to a fixed list of dates, so the real cutoff (if one exists) could sit anywhere between this date and the next-older untested date.',
    does20230523ActuallyWork: test20230523
      ? (test20230523.classification === 'A' ? 'YES — real data retrieved for a window around this date.' : `NO — classification ${test20230523.classification} (${test20230523.classificationMeaning}).`)
      : 'not tested',
    documentedDepth: "Fugle's own documentation states historical intraday availability from approximately 2023-05-23.",
    empiricallyVerifiedDepth: oldestSuccessful
      ? `Real data confirmed retrievable as far back as ${oldestSuccessful.targetDate} in this run.`
      : 'No historical data confirmed at any pre-2026 test point in this run — see date_tests for exact failures at each point.',
    doesFreeApiAppearToProvideYearsOfHistory: successfulDates.some(r => r.targetDate < '2025-01-01')
      ? 'Appears yes — see date_tests for exactly which older dates succeeded.'
      : 'Not confirmed in this run — no pre-2025 test date returned real data. See date_tests.',
    historyAppearsTruncatedByApiLimit: rateLimitHits.length > 0
      ? 'Possibly — rate-limit responses were encountered; see rate_limit_observations.'
      : 'No rate-limiting encountered. A depth limit, if one exists, would show up as classification B/C/E at a specific date in date_tests rather than as a rate-limit response.',
    windowSizesThatReturnedData: windowResults.filter(w => w.classification === 'A').map(w => w.label),
    windowSizesThatAppearTruncated: windowResults.filter(w => w.appearsTruncated).map(w => w.label),
    smallerWindowedRequestsAppearNecessary: windowResults.some(w => w.appearsTruncated),
    rateLimitingEncountered: rateLimitHits.length > 0,
    approxCandlesPerNormalTradingDay: candlesPerTradingDayEstimate,
    dataStructureConsistentAcrossDates: structureConsistency,
  };

  return NextResponse.json({
    summary,
    date_tests: dateResults,
    window_tests: windowResults,
    rate_limit_observations: rateLimitHits,
    interpretation: {
      plainEnglish: oldestSuccessful
        ? (oldestSuccessful.targetDate < '2024-01-01'
          ? 'Data appears to genuinely extend back multiple years, not just recent months — subject to the boundary caveat above (tested at fixed points, not a precise cutoff search).'
          : `Data was only confirmed back to ${oldestSuccessful.targetDate} in this run. Treat anything older than that as UNVERIFIED, not "probably fine" — several older test points may have failed; check date_tests for which ones and why (classification B/C/D/E).`)
        : 'No historical depth beyond very recent data was confirmed in this run — every pre-2026 test point failed. See date_tests for the specific classification (B/C/D/E) at each date.',
    },
    recommendation: {
      note: 'Per the task instructions, no next step is implemented here — only reported in the chat response alongside these results.',
    },
  });
}

