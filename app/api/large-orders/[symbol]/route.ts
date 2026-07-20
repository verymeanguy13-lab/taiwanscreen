// =============================================================================
// app/api/large-orders/[symbol]/route.ts
// GET /api/large-orders/[symbol]?days=5
// Returns this stock's daily institutional net-flow history + its market-wide
// foreign-buying rank for its most recent trading day on record.
//
// REBUILT — previously called live TWSE TWT38U (market-wide table, wrong data
// shape for per-broker tracking). Now DB-backed via institutional_flows, so
// no "today in Taiwan time" computation is needed here — we always read the
// latest date actually present in the DB for that symbol, which sidesteps
// the earlier UTC/Taiwan timezone bug entirely.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { fetchStockFlows, fetchMarketRank } from '@/lib/largeOrders';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const url = new URL(req.url);

  const days = Math.min(
    parseInt(url.searchParams.get('days') ?? '5', 10) || 5,
    30,
  );

  try {
    const [flows, rank] = await Promise.all([
      fetchStockFlows(symbol, days),
      fetchMarketRank(symbol),
    ]);

    return NextResponse.json(
      { flows, rank },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (err) {
    console.error(`[large-orders] Error for ${symbol}:`, err);
    return NextResponse.json(
      { flows: [], rank: null, error: 'Failed to fetch institutional flow data' },
      { status: 200 }, // graceful degradation — UI handles empty state
    );
  }
}