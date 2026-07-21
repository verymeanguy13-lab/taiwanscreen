// =============================================================================
// app/api/multi-timeframe/[symbol]/route.ts
// GET /api/multi-timeframe/[symbol]
// Returns daily/weekly/monthly TimeframeData[] for the multi-timeframe panel.
// Not in the original session spec's numbered steps, but required for
// MultiTimeframeChart.tsx to fetch data client-side — same pattern every
// other panel in this app already follows (useSWR against its own route).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getMultiTimeframeData } from '@/lib/multiTimeframe';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;

  try {
    const data = await getMultiTimeframeData(symbol);
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
    );
  } catch (err) {
    console.error(`[multi-timeframe] Error for ${symbol}:`, err);
    return NextResponse.json({ data: [], error: 'Failed to fetch multi-timeframe data' }, { status: 200 });
  }
}