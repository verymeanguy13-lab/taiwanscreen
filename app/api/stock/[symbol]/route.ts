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
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol?.toUpperCase().trim();

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  const cacheKey = `stock:${symbol}`;

  try {
    const payload = await cached<StockDetailPayload | null>(
      cacheKey,
      15 * 60,
      async () => {
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

          // 3. Fundamentals — last 8 periods that actually have data.
          // Checks every meaningful column, not just a hand-picked subset —
          // otherwise a period-row whose only populated field isn't in this
          // list gets silently excluded (this previously happened to pb_ratio,
          // net_margin, roa, and the two growth_yoy columns).
          queryUnsafe(
            `SELECT * FROM fundamentals
             WHERE symbol = $1
               AND (
                 eps IS NOT NULL OR
                 revenue IS NOT NULL OR
                 net_income IS NOT NULL OR
                 gross_margin IS NOT NULL OR
                 net_margin IS NOT NULL OR
                 pe_ratio IS NOT NULL OR
                 pb_ratio IS NOT NULL OR
                 roe IS NOT NULL OR
                 roa IS NOT NULL OR
                 debt_ratio IS NOT NULL OR
                 market_cap IS NOT NULL OR
                 revenue_growth_yoy IS NOT NULL OR
                 eps_growth_yoy IS NOT NULL
               )
             ORDER BY period DESC
             LIMIT 8`,
            [symbol],
          ),

          // 4. Price history — last 365 days
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

          // 7. Supply chain — this stock as parent
          queryUnsafe(
            `SELECT sc.*, s.name_zh, s.sector
             FROM supply_chain sc
             JOIN stocks s ON sc.child_symbol = s.symbol
             WHERE sc.parent_symbol = $1`,
            [symbol],
          ),

          // 8. Supply chain — this stock as child
          queryUnsafe(
            `SELECT sc.*, s.name_zh, s.sector
             FROM supply_chain sc
             JOIN stocks s ON sc.parent_symbol = s.symbol
             WHERE sc.child_symbol = $1`,
            [symbol],
          ),
        ]);

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