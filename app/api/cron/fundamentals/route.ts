// app/api/cron/fundamentals/route.ts
// Quarterly cron job — fetches balance sheet + book value from MOPS.
// Populates debt_ratio and pb_ratio in the fundamentals table.
//
// Vercel cron schedule (add to vercel.json):
//   { "path": "/api/cron/fundamentals", "schedule": "0 10 15 1,4,7,10 *" }
// Runs 10:00 UTC = 18:00 Taiwan on the 15th of Jan, Apr, Jul, Oct.
//
// Can also be called manually for a specific year/season:
//   GET /api/cron/fundamentals?year=2025&season=1
// Or with no params to use the latest completed season automatically.

import { NextRequest, NextResponse } from 'next/server';
import { ingestFundamentalsBalanceSheet } from '@/lib/ingest';
import { getLatestCompletedSeason } from '@/lib/mops';

export const maxDuration = 300; // 5 minutes — MOPS can be slow

export async function GET(request: NextRequest) {
  // ── Auth: allow Vercel cron trigger OR manual call with secret ────────────
  const secret = request.headers.get('x-cron-secret');
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';

  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Allow manual override of year/season via query params
  const { searchParams } = new URL(request.url);
  let year: number;
  let season: number;

  if (searchParams.has('year') && searchParams.has('season')) {
    year = parseInt(searchParams.get('year')!);
    season = parseInt(searchParams.get('season')!);
    if (isNaN(year) || isNaN(season) || season < 1 || season > 4) {
      return NextResponse.json({ error: 'Invalid year or season (1-4)' }, { status: 400 });
    }
  } else {
    const latest = getLatestCompletedSeason();
    year = latest.year;
    season = latest.season;
  }

  console.log(`[cron/fundamentals] starting for ${year}Q${season}`);

  try {
    const result = await ingestFundamentalsBalanceSheet(year, season);
    return NextResponse.json({
      success: true,
      period: `${year}Q${season}`,
      count: result.count,
      errors: result.errors,
    });
  } catch (e) {
    console.error('[cron/fundamentals] fatal error:', e);
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}