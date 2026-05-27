// Thin CORS proxy -- forwards one TWSE tick request to the browser.
// Batching and signal detection runs client-side (Session 54).
// Do NOT add aggregation logic here.

// =============================================================================
// app/api/proxy/twse/route.ts
// GET /api/proxy/twse?symbol=2330
//
// Each call must complete in under 2 seconds.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol') ?? '';

  // ── 1. Validate: 4-digit numeric only ─────────────────────────────────────
  if (!/^\d{4}$/.test(symbol)) {
    return NextResponse.json(
      { error: 'Invalid symbol — must be a 4-digit number' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // ── 2. Forward to TWSE ───────────────────────────────────────────────────
  try {
    const url =
      `https://mis.twse.com.tw/stock/api/getStockInfo.jsp` +
      `?ex_ch=tse_${symbol}.tw&json=1&delay=0`;

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Abort after 2 seconds
      signal: AbortSignal.timeout(2000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'TWSE unavailable' },
        { status: 502, headers: CORS_HEADERS },
      );
    }

    const data = await res.json();

    // ── 3. Return raw TWSE JSON with CORS headers ─────────────────────────
    return NextResponse.json(data, { headers: CORS_HEADERS });

  } catch (err) {
    console.error('[proxy/twse] Fetch failed:', err);
    return NextResponse.json(
      { error: 'TWSE unavailable' },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}

// Allow preflight requests
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
