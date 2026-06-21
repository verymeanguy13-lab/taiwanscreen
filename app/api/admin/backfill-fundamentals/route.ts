// app/api/admin/backfill-fundamentals/route.ts
// One-shot backfill: fetches the last 4 quarters of balance sheet data from MOPS.
// Run this ONCE manually to populate all the NULL debt_ratio and pb_ratio rows.
//
// Usage:
//   curl -X POST https://taiwanscreen.vercel.app/api/admin/backfill-fundamentals \
//     -H "x-cron-secret: mysecret123"
//
// Or open in browser (GET also works for convenience):
//   https://taiwanscreen.vercel.app/api/admin/backfill-fundamentals?secret=mysecret123
//
// Takes ~3-5 minutes. Check Vercel function logs for progress.

import { NextRequest, NextResponse } from 'next/server';
import { ingestFundamentalsBalanceSheet } from '@/lib/ingest';
import { getLatestCompletedSeason } from '@/lib/mops';

export const maxDuration = 300; // 5 minutes

// Returns the last N seasons in reverse-chronological order
function getLastNSeasons(n: number): { year: number; season: number }[] {
  const latest = getLatestCompletedSeason();
  const seasons: { year: number; season: number }[] = [];
  let { year, season } = latest;

  for (let i = 0; i < n; i++) {
    seasons.push({ year, season });
    season--;
    if (season < 1) {
      season = 4;
      year--;
    }
  }

  return seasons;
}

async function run(request: NextRequest): Promise<NextResponse> {
  // Auth — accept either header or query param for convenience
  const headerSecret = request.headers.get('x-cron-secret');
  const querySecret = new URL(request.url).searchParams.get('secret');
  if (headerSecret !== process.env.CRON_SECRET && querySecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const seasons = getLastNSeasons(4); // backfill last 4 quarters
  console.log('[backfill] seasons to process:', seasons.map(s => `${s.year}Q${s.season}`).join(', '));

  const allResults: { period: string; count: number; errors: string[] }[] = [];

  for (const { year, season } of seasons) {
    const period = `${year}Q${season}`;
    console.log(`[backfill] processing ${period}...`);
    try {
      const result = await ingestFundamentalsBalanceSheet(year, season);
      allResults.push({ period, count: result.count, errors: result.errors });
    } catch (e) {
      allResults.push({ period, count: 0, errors: [String(e)] });
    }
    // Be polite to MOPS — wait 3 seconds between requests
    await new Promise(r => setTimeout(r, 3000));
  }

  const totalCount = allResults.reduce((sum, r) => sum + r.count, 0);
  const totalErrors = allResults.flatMap(r => r.errors.map(e => `${r.period}: ${e}`));

  return NextResponse.json({
    success: true,
    message: `Backfilled ${totalCount} fundamentals rows across ${seasons.length} quarters`,
    results: allResults,
    totalErrors,
  });
}

export const GET = run;
export const POST = run;