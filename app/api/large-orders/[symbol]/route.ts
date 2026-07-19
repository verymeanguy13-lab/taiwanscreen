// =============================================================================
// app/api/large-orders/[symbol]/route.ts
// GET /api/large-orders/[symbol]?days=5
// Returns large block trades + consecutive buyer analysis for a symbol.
// Uses TWSE TWT38U (no CAPTCHA, no auth required).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { fetchLargeOrders, detectConsecutiveBuyers } from '@/lib/largeOrders';

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
    // Use Taiwan time, not server UTC time — a plain `new Date()` would
    // return the wrong calendar date during Taiwan's early morning hours
    // (Taiwan midnight = UTC 16:00 the previous day), same pattern used in
    // app/api/cron/daily/route.ts.
    const now = new Date();
    const taiwanMs = now.getTime() + 8 * 60 * 60 * 1000;
    const today = new Date(taiwanMs).toISOString().slice(0, 10);

    // Run both fetches in parallel
    const [largeOrders, consecutiveBuyers] = await Promise.all([
      fetchLargeOrders(symbol, today),
      detectConsecutiveBuyers(symbol, days),
    ]);

    return NextResponse.json(
      { largeOrders, consecutiveBuyers },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (err) {
    console.error(`[large-orders] Error for ${symbol}:`, err);
    return NextResponse.json(
      { largeOrders: [], consecutiveBuyers: [], error: 'Failed to fetch large orders' },
      { status: 200 }, // graceful degradation — UI handles empty state
    );
  }
}