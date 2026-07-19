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
      // ── Fetch a wider window of reported periods ──────────────────────────
      // Used for profitability/growth calcs. We need real year-over-year
      // pairs (same quarter, one year apart) — not just "the two most recent
      // rows", since the most recent 1-2 rows are often valuation-only
      // snapshots (pe_ratio/pb_ratio updated daily before a quarter's actual
      // eps/revenue have been reported). LIMIT 12 covers up to 3 years back,
      // enough to find a same-quarter match even with occasional gaps.
      const fundRows = await queryUnsafe<{
        period:       string;
        gross_margin: number | null;
        net_margin:   number | null;
        eps:          number | null;
        revenue:      number | null;
      }>(
        `SELECT period, gross_margin, net_margin, eps, revenue
         FROM fundamentals
         WHERE symbol = $1
         ORDER BY period DESC
         LIMIT 12`,
        [symbol],
      );

      // Find true YoY pair for a given field: the most recent row that has
      // that field populated, matched against the row exactly 1 year (same
      // quarter) prior that also has it populated. Returns null if no clean
      // same-quarter match exists in the fetched window.
      function findYoYPair(field: 'revenue' | 'eps'): { latest: number; prior: number } | null {
        const parsePeriod = (p: string) => {
          const m = p.match(/^(\d{4})Q(\d)$/);
          return m ? { year: Number(m[1]), quarter: Number(m[2]) } : null;
        };
        for (const row of fundRows) {
          const val = row[field];
          if (val == null) continue;
          const parsed = parsePeriod(row.period);
          if (!parsed) continue;
          const priorPeriod = `${parsed.year - 1}Q${parsed.quarter}`;
          const priorRow = fundRows.find(r => r.period === priorPeriod && r[field] != null);
          if (priorRow) return { latest: Number(val), prior: Number(priorRow[field]) };
        }
        return null;
      }

      const revPair = findYoYPair('revenue');
      const revenueGrowth =
        revPair && revPair.prior > 0
          ? ((revPair.latest - revPair.prior) / revPair.prior) * 100
          : null;

      const epsPair = findYoYPair('eps');
      const epsGrowth =
        epsPair && epsPair.prior > 0
          ? ((epsPair.latest - epsPair.prior) / epsPair.prior) * 100
          : null;

      // Latest non-null gross/net margin (same "scan for newest populated
      // value" pattern as pe_ratio/pb_ratio/roe/debt_ratio below) — the
      // single most recent row may be a valuation-only snapshot without
      // these fields.
      let grossMargin: number | null = null;
      let netMargin:   number | null = null;
      for (const row of fundRows) {
        if (grossMargin === null && row.gross_margin != null) grossMargin = Number(row.gross_margin);
        if (netMargin   === null && row.net_margin   != null) netMargin   = Number(row.net_margin);
      }

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

      // ── Fallback ROE when the FinMind-sourced roe column is null ─────────
      // FinMind's financial-statements dataset structurally does not cover
      // financial holding companies / banks / insurers (confirmed: ~30
      // financial-sector symbols all fail identically) — no amount of
      // retrying will ever populate `roe` for them via the normal pipeline.
      // Approximate ROE instead from data we already reliably have:
      //   book value per share = price / pb_ratio
      //   ROE ≈ trailing-12-month EPS / book value per share × 100
      // This needs a TTM eps sum, not a single quarter's — same reasoning
      // as the true-YoY fix above (a single quarter is ~1/4 of the annual
      // return and would understate ROE by ~4x if used directly).
      if (roe === null && pbRatio != null && pbRatio > 0) {
        const epsRows = fundRows.filter(r => r.eps != null).slice(0, 4);
        if (epsRows.length === 4) {
          const ttmEps = epsRows.reduce((sum, r) => sum + Number(r.eps), 0);
          const priceRow = await queryUnsafe<{ close: number | null }>(
            `SELECT close FROM daily_prices WHERE symbol = $1 ORDER BY date DESC LIMIT 1`,
            [symbol],
          );
          const close = priceRow[0]?.close != null ? Number(priceRow[0].close) : null;
          if (close != null && close > 0) {
            const bookValuePerShare = close / pbRatio;
            roe = Math.round((ttmEps / bookValuePerShare) * 10000) / 100;
          }
        }
      }

      // ── Fetch latest institutional flows ─────────────────────────────────
      const flowRows = await queryUnsafe<{
        foreign_consecutive_days: number | null;
        triple_buy:               boolean;
        foreign_net:              number | null;
      }>(
        `SELECT foreign_consecutive_days, triple_buy, foreign_net
         FROM institutional_flows
         WHERE symbol = $1
         ORDER BY date DESC
         LIMIT 1`,
        [symbol],
      );

      // ── Size-relative-to-normal ratio for today's flow ────────────────────
      // Streak length alone treats a token 1-day uptick the same as a
      // once-a-quarter mega buy, as long as both are "day 1". This compares
      // today's |foreign_net| against the stock's own trailing 20-day
      // average |foreign_net|, so an outsized single day still stands out
      // even when it's not (yet) part of a long streak.
      const recentFlowRows = await queryUnsafe<{ foreign_net: number | null }>(
        `SELECT foreign_net FROM institutional_flows
         WHERE symbol = $1
         ORDER BY date DESC
         LIMIT 20`,
        [symbol],
      );
      let flowSizeRatio: number | null = null;
      if (flowRows[0]?.foreign_net != null && recentFlowRows.length >= 5) {
        const avgAbs =
          recentFlowRows.reduce((sum, r) => sum + Math.abs(Number(r.foreign_net ?? 0)), 0) /
          recentFlowRows.length;
        if (avgAbs > 0) {
          flowSizeRatio = Number(flowRows[0].foreign_net) / avgAbs;
        }
      }

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

      // ── Fetch sector (needed for sector-aware safety scoring) ────────────
      const sectorRows = await queryUnsafe<{ sector: string | null }>(
        `SELECT sector FROM stocks WHERE symbol = $1`,
        [symbol],
      );
      const sector = sectorRows[0]?.sector ?? null;

      return computeHealthScore({
        pe_ratio:   peRatio,
        pb_ratio:   pbRatio,
        roe:        roe,
        debt_ratio: debtRatio,
        sector:     sector,

        gross_margin:       grossMargin,
        net_margin:         netMargin,
        revenue_growth_yoy: revenueGrowth,
        eps_growth_yoy:     epsGrowth,

        foreign_consecutive_days: flow.foreign_consecutive_days ? Number(flow.foreign_consecutive_days) : null,
        triple_buy:               flow.triple_buy ?? false,
        flow_size_ratio:          flowSizeRatio,
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