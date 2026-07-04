// =============================================================================
// app/api/admin/debug-revenue/route.ts
// TEMPORARY debug endpoint — fetches the raw MOPS response for monthly revenue
// and returns it as plain text so it can be inspected directly in a browser.
// Safe to delete once the revenue ingestion issue is diagnosed and fixed.
//
// Usage: visit in browser (GET request):
//   https://taiwanscreen.vercel.app/api/admin/debug-revenue?year=2026&month=3&secret=mysecret123
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

  const year  = parseInt(searchParams.get('year')  ?? '2026', 10);
  const month = parseInt(searchParams.get('month') ?? '3', 10);
  const rocYear = toROCYear(year);

  const body = new URLSearchParams({
    year:  String(rocYear),
    month: String(month),
    type:  'sii',
  }).toString();

  try {
    const res = await fetch(`${BASE_URL}/mops/web/ajax_t05st10`, {
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
      `STATUS: ${res.status}\nURL TRIED: ${BASE_URL}/mops/web/ajax_t05st10\nBODY SENT: ${body}\n\n--- RAW RESPONSE (first 5000 chars) ---\n\n${text.slice(0, 5000)}`,
      { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  } catch (err) {
    return new NextResponse(`FETCH ERROR: ${err}`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}