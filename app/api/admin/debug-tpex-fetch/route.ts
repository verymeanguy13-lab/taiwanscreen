// app/api/admin/debug-tpex-fetch/route.ts
//
// TEMPORARY diagnostic — read-only, makes NO database writes. Calls the
// TPEx aftertrading endpoint directly from this deployment's own network,
// for both today and a known-good historical date, to check whether the
// connection is being blocked/failing (matches the previously-known "TPEx
// bulk prices blocked from Vercel datacenter IPs" issue) or something else
// (bad response shape, timeout, HTTP error, etc). Delete once confirmed.

import { NextRequest, NextResponse } from 'next/server';

async function tryTpexFetch(dateStr: string) {
  const tpexDate = `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?d=${encodeURIComponent(tpexDate)}&se=AL&s=0,asc&o=json`;

  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const elapsedMs = Date.now() - started;

    if (!res.ok) {
      return { dateStr, url, ok: false, httpStatus: res.status, elapsedMs, note: 'non-2xx response' };
    }

    const text = await res.text();
    let parsed: unknown = null;
    let parseError: string | null = null;
    try { parsed = JSON.parse(text); } catch (e) { parseError = String(e); }

    const aaDataLength = (parsed && typeof parsed === 'object' && Array.isArray((parsed as { aaData?: unknown[] }).aaData))
      ? (parsed as { aaData: unknown[] }).aaData.length
      : null;

    return {
      dateStr, url, ok: true, httpStatus: res.status, elapsedMs,
      rawTextLength: text.length,
      rawTextPreview: text.slice(0, 300),
      parseError,
      aaDataLength,
    };
  } catch (err) {
    const elapsedMs = Date.now() - started;
    return {
      dateStr, url, ok: false, elapsedMs,
      note: 'fetch threw (timeout, DNS, connection refused, or blocked)',
      error: String(err),
    };
  }
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Today's Taiwan date, plus 2026-06-05 (last known-good date per the
  // semiconductor sector's stuck daily_prices) and 2026-06-04 (the
  // business day before that, as a sanity check).
  const now = new Date();
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y   = tw.getUTCFullYear();
  const m   = String(tw.getUTCMonth() + 1).padStart(2, '0');
  const d   = String(tw.getUTCDate()).padStart(2, '0');
  const todayStr = `${y}${m}${d}`;

  const [todayResult, lastGoodResult, dayBeforeResult] = await Promise.all([
    tryTpexFetch(todayStr),
    tryTpexFetch('20260605'),
    tryTpexFetch('20260604'),
  ]);

  return NextResponse.json({
    today: todayResult,
    lastKnownGoodDate: lastGoodResult,
    dayBeforeThat: dayBeforeResult,
  });
}