// =============================================================================
// app/api/stock/[symbol]/score/route.ts
// GET /api/stock/[symbol]/score
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import { computeHealthScore } from '@/lib/scoring';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const cacheKey = `score:${symbol}`;

  try {
    const result = await cached(cacheKey, 60 * 60, async () => {
      // ── Fetch latest fundamentals ────────────────────────────────────────
      const fundRows = await queryUnsafe<{
        pe_ratio:           number | null;
        pb_ratio:           number | null;
        roe:                number | null;
        gross_margin:       number | null;
        revenue_growth_yoy: number | null;
        eps_growth_yoy:     number | null;
        debt_ratio:         number | null;
      }>(
        `SELECT pe_ratio, pb_ratio, roe, gross_margin,
                revenue_growth_yoy, eps_growth_yoy, debt_ratio
         FROM fundamentals
         WHERE symbol = $1
         ORDER BY period DESC
         LIMIT 1`,
        [symbol],
      );

      // ── Fetch latest institutional flows ─────────────────────────────────
      const flowRows = await queryUnsafe<{
        foreign_consecutive_days: number | null;
        triple_buy:               boolean;
      }>(
        `SELECT foreign_consecutive_days, triple_buy
         FROM institutional_flows
         WHERE symbol = $1
         ORDER BY date DESC
         LIMIT 1`,
        [symbol],
      );

      // ── Fetch dividend summary ────────────────────────────────────────────
      const divRows = await queryUnsafe<{
        latest_yield_pct:  number | null;
        consecutive_years: number | null;
        stability_score:   number | null;
      }>(
        `SELECT latest_yield_pct, consecutive_years, stability_score
         FROM dividend_summary
         WHERE symbol = $1`,
        [symbol],
      );

      const fund = fundRows[0] ?? {};
      const flow = flowRows[0] ?? {};
      const div  = divRows[0]  ?? {};

      return computeHealthScore({
        pe_ratio:                 fund.pe_ratio                 ?? null,
        pb_ratio:                 fund.pb_ratio                 ?? null,
        roe:                      fund.roe                      ?? null,
        gross_margin:             fund.gross_margin             ?? null,
        revenue_growth_yoy:       fund.revenue_growth_yoy       ?? null,
        eps_growth_yoy:           fund.eps_growth_yoy           ?? null,
        debt_ratio:               fund.debt_ratio               ?? null,
        foreign_consecutive_days: flow.foreign_consecutive_days ?? null,
        triple_buy:               flow.triple_buy               ?? false,
        latest_yield_pct:         div.latest_yield_pct          ?? null,
        consecutive_years:        div.consecutive_years         ?? null,
        stability_score:          div.stability_score           ?? null,
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[score] Unexpected error:', err);
    return NextResponse.json(
      { score: 0, grade: 'D', breakdown: { profitability: 0, growth: 0, safety: 0, chips: 0 }, strengths: [], warnings: [] },
      { status: 200 },
    );
  }
}