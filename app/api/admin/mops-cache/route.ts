// app/api/admin/mops-cache/route.ts
//
// Called by GitHub Actions — fetches ONE dataset from MOPS and stores
// raw results in the mops_raw_cache table. Designed to complete in < 60s.
//
// Body: { "type": "balance_sheet" | "book_value" }
// Query: ?year=2025&season=1  (optional — auto-detects if omitted)

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { fetchBalanceSheet, fetchBookValue, getLatestCompletedSeason } from '@/lib/mops';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const type = body.type as 'balance_sheet' | 'book_value';

  if (type !== 'balance_sheet' && type !== 'book_value') {
    return NextResponse.json({ error: 'type must be balance_sheet or book_value' }, { status: 400 });
  }

  let year: number, season: number;
  if (searchParams.has('year') && searchParams.has('season')) {
    year   = parseInt(searchParams.get('year')!);
    season = parseInt(searchParams.get('season')!);
  } else {
    ({ year, season } = getLatestCompletedSeason());
  }

  const period = `${year}Q${season}`;

  // Ensure cache table exists
  await queryUnsafe(`
    CREATE TABLE IF NOT EXISTS mops_raw_cache (
      type      VARCHAR(20)  NOT NULL,
      period    VARCHAR(10)  NOT NULL,
      data      JSONB        NOT NULL,
      cached_at TIMESTAMPTZ  DEFAULT NOW(),
      PRIMARY KEY (type, period)
    )
  `);

  console.log(`[mops-cache] Fetching ${type} for ${period}…`);

  let data: unknown[];
  if (type === 'balance_sheet') {
    data = await fetchBalanceSheet(year, season);
  } else {
    data = await fetchBookValue(year, season);
  }

  if (data.length === 0) {
    return NextResponse.json(
      { success: false, error: `MOPS returned 0 rows for ${type} ${period}` },
      { status: 502 }
    );
  }

  await queryUnsafe(
    `INSERT INTO mops_raw_cache (type, period, data)
     VALUES ($1, $2, $3)
     ON CONFLICT (type, period) DO UPDATE SET data = $3, cached_at = NOW()`,
    [type, period, JSON.stringify(data)]
  );

  console.log(`[mops-cache] Cached ${data.length} rows for ${type} ${period}`);
  return NextResponse.json({ success: true, type, period, count: data.length });
}