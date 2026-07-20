// =============================================================================
// app/api/stock/[symbol]/shareholders/route.ts
// GET /api/stock/[symbol]/shareholders
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import { fetchMajorShareholders, fetchDirectorHoldings } from '@/lib/mops';

interface ShareholderRow {
  period:        string;
  rank:          number;
  holder_name:   string;
  holder_type:   string;
  shares_held:   number;
  holding_pct:   number;
  change_shares: number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const cacheKey = `shareholders:${symbol}`;

  try {
    const result = await cached(cacheKey, 6 * 60 * 60, async () => {
      // ── 1. Fetch last 2 periods from DB ──────────────────────────────────
      const rows = await queryUnsafe<ShareholderRow>(
        `SELECT period, rank, holder_name, holder_type,
                shares_held, holding_pct, change_shares
         FROM major_shareholders
         WHERE symbol = $1
         ORDER BY period DESC, rank ASC
         LIMIT 60`,
        [symbol],
      );

      // ── 2. If DB is empty, fall back to live MOPS fetch ──────────────────
      if (rows.length === 0) {
        // MOPS major-shareholder (10%+) disclosures lag behind the calendar
        // quarter — they aren't published until well after a quarter ends.
        // Asking for the CURRENT in-progress quarter (e.g. Q3 while July is
        // happening) guarantees an empty result every time. Instead, ask for
        // the most recently *completed* quarter, and if MOPS hasn't
        // published that one yet either (common in the first few weeks
        // after a quarter ends), fall back one quarter further.
        const now = new Date();
        const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
        let year    = now.getFullYear();
        let quarter = currentQuarter - 1;
        if (quarter < 1) { quarter = 4; year -= 1; }

        const directorsPromise = fetchDirectorHoldings(symbol);
        let major = await fetchMajorShareholders(symbol, year, quarter);

        if (major.length === 0) {
          let fallbackYear = year, fallbackQuarter = quarter - 1;
          if (fallbackQuarter < 1) { fallbackQuarter = 4; fallbackYear -= 1; }
          major = await fetchMajorShareholders(symbol, fallbackYear, fallbackQuarter);
          if (major.length > 0) { year = fallbackYear; quarter = fallbackQuarter; }
        }

        const directors = await directorsPromise;

        const period = `${year}Q${quarter}`;

        return {
          period,
          prev_period: null,
          directors: directors.map(d => ({
            name:   d.holder_name,
            type:   d.holder_type,
            shares: d.shares_held,
            pct:    d.holding_pct,
            change: d.change_shares,
          })),
          major: major
            .filter(m => m.holding_pct >= 10)
            .map(m => ({
              name:   m.holder_name,
              shares: m.shares_held,
              pct:    m.holding_pct,
            })),
        };
      }

      // ── 3. Group by period ───────────────────────────────────────────────
      const periods     = [...new Set(rows.map(r => r.period))].sort().reverse();
      const period      = periods[0] ?? null;
      const prev_period = periods[1] ?? null;
      const current     = rows.filter(r => r.period === period);

      return {
        period,
        prev_period,
        directors: current
          .filter(r => r.holder_type !== 'major_10pct')
          .map(r => ({
            name:   r.holder_name,
            type:   r.holder_type,
            shares: r.shares_held,
            pct:    r.holding_pct,
            change: r.change_shares,
          })),
        major: current
          .filter(r => r.holder_type === 'major_10pct' && r.holding_pct >= 10)
          .map(r => ({
            name:   r.holder_name,
            shares: r.shares_held,
            pct:    r.holding_pct,
          })),
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[shareholders] Unexpected error:', err);
    return NextResponse.json(
      { directors: [], major: [], period: null, prev_period: null },
      { status: 200 },
    );
  }
}