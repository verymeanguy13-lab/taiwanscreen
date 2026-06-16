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
      // ── Fetch last 4 periods of available fundamentals ───────────────────
      // pe_ratio, pb_ratio, roe, debt_ratio are all NULL in DB (not yet seeded).
      // Use gross_margin, net_margin, eps, revenue which ARE populated.
      const fundRows = await queryUnsafe<{
        gross_margin: number | null;
        net_margin:   number | null;
        eps:          number | null;
        revenue:      number | null;
      }>(
        `SELECT gross_margin, net_margin, eps, revenue
         FROM fundamentals
         WHERE symbol = $1
         ORDER BY period DESC
         LIMIT 4`,
        [symbol],
      );

      // ── Compute YoY growth from period[0] vs period[1] ──────────────────
      const latestFund = fundRows[0] ?? {};
      const prevFund   = fundRows[1] ?? {};

      const revenueGrowth =
        latestFund.revenue && prevFund.revenue && Number(prevFund.revenue) > 0
          ? ((Number(latestFund.revenue) - Number(prevFund.revenue)) /
              Number(prevFund.revenue)) *
            100
          : null;

      const epsGrowth =
        latestFund.eps && prevFund.eps && Number(prevFund.eps) > 0
          ? ((Number(latestFund.eps) - Number(prevFund.eps)) /
              Number(prevFund.eps)) *
            100
          : null;

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

      const flow = flowRows[0] ?? {};
      const div  = divRows[0]  ?? {};

      return computeHealthScore({
        // Not yet in DB — pass null; scoring falls back to available data
        pe_ratio:   null,
        pb_ratio:   null,
        roe:        null,
        debt_ratio: null,

        // Available from fundamentals table
        gross_margin:       latestFund.gross_margin ? Number(latestFund.gross_margin) : null,
        net_margin:         latestFund.net_margin   ? Number(latestFund.net_margin)   : null,
        revenue_growth_yoy: revenueGrowth,
        eps_growth_yoy:     epsGrowth,

        // Institutional & dividend
        foreign_consecutive_days: flow.foreign_consecutive_days ? Number(flow.foreign_consecutive_days) : null,
        triple_buy:               flow.triple_buy ?? false,
        latest_yield_pct:         div.latest_yield_pct  ? Number(div.latest_yield_pct)  : null,
        consecutive_years:        div.consecutive_years ? Number(div.consecutive_years) : null,
        stability_score:          div.stability_score   ? Number(div.stability_score)   : null,
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