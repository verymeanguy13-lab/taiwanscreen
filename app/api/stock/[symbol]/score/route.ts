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
      // ── Fetch last 4 periods where gross_margin is populated ─────────────
      // Used for profitability/growth calcs that need matched quarter-pairs.
      const fundRows = await queryUnsafe<{
        gross_margin: number | null;
        net_margin:   number | null;
        eps:          number | null;
        revenue:      number | null;
      }>(
        `SELECT gross_margin, net_margin, eps, revenue
         FROM fundamentals
         WHERE symbol = $1
         AND gross_margin IS NOT NULL
         ORDER BY period DESC
         LIMIT 4`,
        [symbol],
      );

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

      // ── Latest non-null pe_ratio / pb_ratio / roe / debt_ratio ──────────
      // These previously were hardcoded to null here with a comment saying
      // they weren't in the DB yet — that's now stale. They live in whichever
      // recent period-row happens to carry them (a TWSE-sourced row only has
      // pe_ratio/pb_ratio; a FinMind-sourced reported quarter only has
      // roe/debt_ratio), so a single "latest row" isn't enough — scan the
      // last 8 periods and take the newest non-null value found per field.
      const recentRows = await queryUnsafe<{
        period:     string;
        pe_ratio:   number | null;
        pb_ratio:   number | null;
        roe:        number | null;
        debt_ratio: number | null;
      }>(
        `SELECT period, pe_ratio, pb_ratio, roe, debt_ratio
         FROM fundamentals
         WHERE symbol = $1
         ORDER BY period DESC
         LIMIT 8`,
        [symbol],
      );

      let peRatio:   number | null = null;
      let pbRatio:   number | null = null;
      let roe:       number | null = null;
      let debtRatio: number | null = null;
      for (const row of recentRows) {
        if (peRatio   === null && row.pe_ratio   != null) peRatio   = Number(row.pe_ratio);
        if (pbRatio   === null && row.pb_ratio   != null) pbRatio   = Number(row.pb_ratio);
        if (roe       === null && row.roe        != null) roe       = Number(row.roe);
        if (debtRatio === null && row.debt_ratio != null) debtRatio = Number(row.debt_ratio);
      }

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
        pe_ratio:   peRatio,
        pb_ratio:   pbRatio,
        roe:        roe,
        debt_ratio: debtRatio,

        gross_margin:       latestFund.gross_margin ? Number(latestFund.gross_margin) : null,
        net_margin:         latestFund.net_margin   ? Number(latestFund.net_margin)   : null,
        revenue_growth_yoy: revenueGrowth,
        eps_growth_yoy:     epsGrowth,

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