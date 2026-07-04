// =============================================================================
// app/api/admin/debug-revenue/route.ts
// TEMPORARY debug endpoint — currently repurposed to test the MOPS
// book-value/EPS endpoint (ajax_t05st22) for the same security-wall issue
// found with the revenue endpoint. Safe to delete once diagnosed.
//
// Usage: visit in browser (GET request):
//   https://taiwanscreen.vercel.app/api/admin/debug-revenue?year=2026&season=1&secret=mysecret123
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

const BASE_URL = 'https://mops.twse.com.tw';

function toROCYear(westernYear: number): number {
  return westernYear - 1911;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const secret = searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const year   = parseInt(searchParams.get('year')   ?? '2026', 10);
  const season = parseInt(searchParams.get('season') ?? '1', 10);
  const rocYear = toROCYear(year);

  const body = new URLSearchParams({
    encodeURIComponent: '1',
    step:     '1',
    firstin:  '1',
    off:      '1',
    keyword4: '',
    code1:    '',
    TYPEK:    'sii',
    isnew:    'false',
    year:     String(rocYear),
    season:   String(season),
  }).toString();

  try {
    const res = await fetch(`${BASE_URL}/mops/web/ajax_t05st22`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json, text/html, */*',
        'Referer': BASE_URL,
      },
      body,
    });

    const text = await res.text();

    return new NextResponse(
      `STATUS: ${res.status}\nURL TRIED: ${BASE_URL}/mops/web/ajax_t05st22\nBODY SENT: ${body}\n\n--- RAW RESPONSE (first 5000 chars) ---\n\n${text.slice(0, 5000)}`,
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  } catch (err) {
    return new NextResponse(`FETCH ERROR: ${err}`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}