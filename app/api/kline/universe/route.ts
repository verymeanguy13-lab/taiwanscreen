// =============================================================================
// app/api/kline/universe/route.ts
// GET /api/kline/universe
// Returns top 200 stocks by average volume that have enough price history
// for technical indicators (20+ distinct trading days).
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET() {
  try {
    const result = await cached('kline:universe', 3600, async () => {
      const rows = await sql`
        SELECT dp.symbol,
               s.name_zh,
               COALESCE(s.sector, '') AS sector
        FROM daily_prices dp
        JOIN stocks s ON s.symbol = dp.symbol
        GROUP BY dp.symbol, s.name_zh, s.sector
        HAVING COUNT(DISTINCT dp.date) >= 20
           AND AVG(dp.close) > 10
        ORDER BY AVG(dp.volume) DESC
        LIMIT 200
      `;

      return {
        symbols:   rows,
        fetchedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' },
    });

  } catch (err) {
    console.error('[kline/universe] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}