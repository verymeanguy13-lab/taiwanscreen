// =============================================================================
// app/api/chip-flow/[symbol]/route.ts
// GET /api/chip-flow/[symbol]
// Returns intraday big-player vs retail chip flow snapshots + summary.
//
// During market hours (09:00–13:30 Taiwan time), this reflects live intraday
// data. Outside market hours, Fugle's tick endpoint still returns the most
// recent completed session's ticks until the next session begins, so this
// naturally serves "last session" data — the `marketOpen` flag tells the
// frontend whether to label it live or as a closed-market snapshot.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getIntradayChipFlow, getChipFlowSummary, isMarketOpen } from '@/lib/chipFlow';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;

  try {
    const [snapshots, summary] = await Promise.all([
      getIntradayChipFlow(symbol),
      getChipFlowSummary(symbol),
    ]);

    return NextResponse.json(
      {
        symbol,
        marketOpen: isMarketOpen(),
        snapshots,
        summary,
      },
      {
        headers: {
          // Short cache — this is intraday data and should stay fresh
          // while the market is open; harmless when it's closed too.
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (err) {
    console.error(`[chip-flow] Error for ${symbol}:`, err);
    return NextResponse.json(
      {
        symbol,
        marketOpen: isMarketOpen(),
        snapshots: [],
        summary: { bigPlayerNetLots: 0, retailNetLots: 0, bigPlayerDominance: 0, signal: 'neutral' as const },
        error: 'Failed to fetch chip flow data',
      },
      { status: 200 }, // graceful degradation — UI handles empty state
    );
  }
}