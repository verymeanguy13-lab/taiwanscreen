// =============================================================================
// app/api/stock/[symbol]/route.ts
// GET /api/stock/2330
// Returns full StockDetailPayload for one stock.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import type { StockDetailPayload } from '@/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } },
) {
  const symbol = params.symbol?.toUpperCase().trim();
  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  const cacheKey = `stock:${symbol}`;

  try {
    const payload = await cached<StockDetailPayload | null>(
      cacheKey,
      15 * 60,
      async () => {
        // ── Run all queries in parallel ──────────────────────────────────
        const [
          infoRows,
          quoteRows,
          fundamentalsRows,
          priceHistoryRows,
          dividendHistoryRows,
          dividendSummaryRows,
          supplyAsParentRows,
          supplyAsChildRows,
        ] = await Promise.all([

          // 1. Basic stock info
          queryUnsafe(
            `SELECT * FROM stocks WHERE symbol = $1`,
            [symbol],
          ),

          // 2. Latest quote
          queryUnsafe(
            `SELECT * FROM daily_prices
             WHERE symbol = $1
               AND date = (
                 SELECT MAX(date) FROM daily_prices WHERE symbol = $1
               )`,
            [symbol],
          ),

          // 3. Latest fundamentals
          queryUnsafe(
            `SELECT * FROM fundamentals
             WHERE symbol = $1
               AND period = (
                 SELECT MAX(period) FROM fundamentals WHERE symbol = $1
               )`,
            [symbol],
          ),

          // 4. Price history — last 365 days, oldest first
          queryUnsafe(
            `SELECT date, open, high, low, close, volume
             FROM daily_prices
             WHERE symbol = $1
               AND date >= NOW() - INTERVAL '365 days'
             ORDER BY date ASC`,
            [symbol],
          ),

          // 5. Dividend history — last 10 years
          queryUnsafe(
            `SELECT * FROM dividends
             WHERE symbol = $1
             ORDER BY year DESC
             LIMIT 10`,
            [symbol],
          ),

          // 6. Dividend summary
          queryUnsafe(
            `SELECT * FROM dividend_summary WHERE symbol = $1`,
            [symbol],
          ),

          // 7. Supply chain — this stock as parent (what it supplies to)
          queryUnsafe(
            `SELECT sc.*, s.name_zh, s.sector
             FROM supply_chain sc
             JOIN stocks s ON sc.child_symbol = s.symbol
             WHERE sc.parent_symbol = $1`,
            [symbol],
          ),

          // 8. Supply chain — this stock as child (who supplies to it)
          queryUnsafe(
            `SELECT sc.*, s.name_zh, s.sector
             FROM supply_chain sc
             JOIN stocks s ON sc.parent_symbol = s.symbol
             WHERE sc.child_symbol = $1`,
            [symbol],
          ),
        ]);

        // ── 404 if stock not found ────────────────────────────────────────
        if (!infoRows[0]) return null;

        return {
          info:            infoRows[0],
          quote:           quoteRows[0] ?? null,
          fundamentals:    fundamentalsRows,
          priceHistory:    priceHistoryRows,
          dividendHistory: dividendHistoryRows,
          dividendSummary: dividendSummaryRows[0] ?? undefined,
          supplyChain: {
            as_parent: supplyAsParentRows,
            as_child:  supplyAsChildRows,
          },
        } as StockDetailPayload;
      },
    );

    if (!payload) {
      return NextResponse.json({ error: `Stock ${symbol} not found` }, { status: 404 });
    }

    return NextResponse.json({ data: payload });
  } catch (err) {
    console.error(`[stock/${symbol}] Unexpected error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}