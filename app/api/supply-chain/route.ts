// =============================================================================
// app/api/supply-chain/route.ts
// GET /api/supply-chain?ecosystem=tsmc
// Returns graph nodes, edges, and performance summary for one ecosystem.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

// Center node for each ecosystem
const ECOSYSTEM_CENTER: Record<string, string> = {
  tsmc:   '2330',
  apple:  'AAPL',
  nvidia: 'NVDA',
  ev:     'EV-SECTOR',
};

const VALID_ECOSYSTEMS = new Set(Object.keys(ECOSYSTEM_CENTER));

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const ecosystem = (searchParams.get('ecosystem') ?? 'tsmc').toLowerCase();

  if (!VALID_ECOSYSTEMS.has(ecosystem)) {
    return NextResponse.json(
      { error: `Unknown ecosystem. Valid values: ${[...VALID_ECOSYSTEMS].join(', ')}` },
      { status: 400 },
    );
  }

  const cacheKey = `supply-chain:${ecosystem}`;

  try {
    const data = await cached(cacheKey, 60 * 60, async () => {
      const center = ECOSYSTEM_CENTER[ecosystem];

      // ── 1. Nodes ────────────────────────────────────────────────────────
      // Get all distinct symbols involved in this ecosystem's supply chain,
      // with price, fundamentals, and dividend data joined in.
      const nodeRows = await queryUnsafe<{
        symbol:           string;
        name_zh:          string;
        name_en:          string | null;
        sector:           string | null;
        close:            number | null;
        change_pct:       number | null;
        market_cap:       number | null;
        latest_yield_pct: number | null;
      }>(
        `SELECT DISTINCT
           s.symbol,
           s.name_zh,
           s.name_en,
           s.sector,
           dp.close,
           dp.change_pct,
           f.market_cap,
           ds.latest_yield_pct
         FROM supply_chain sc
         JOIN stocks s
           ON s.symbol = sc.parent_symbol
           OR s.symbol = sc.child_symbol
         LEFT JOIN daily_prices dp
           ON s.symbol = dp.symbol
           AND dp.date = (SELECT MAX(date) FROM daily_prices)
         LEFT JOIN fundamentals f
           ON s.symbol = f.symbol
           AND f.period = (
             SELECT MAX(period) FROM fundamentals WHERE symbol = s.symbol
           )
         LEFT JOIN dividend_summary ds ON s.symbol = ds.symbol
         WHERE sc.ecosystem = $1`,
        [ecosystem],
      );

      // Mark the center node and normalise number types
      const nodes = nodeRows.map(r => ({
        symbol:           r.symbol,
        name_zh:          r.name_zh,
        name_en:          r.name_en ?? null,
        sector:           r.sector  ?? null,
        close:            r.close      !== null ? Number(r.close)            : null,
        change_pct:       r.change_pct !== null ? Number(r.change_pct)       : null,
        market_cap:       r.market_cap !== null ? Number(r.market_cap)       : null,
        latest_yield_pct: r.latest_yield_pct !== null ? Number(r.latest_yield_pct) : null,
        is_center:        r.symbol === center,
      }));

      // ── 2. Edges ─────────────────────────────────────────────────────────
      const edgeRows = await queryUnsafe<{
        parent_symbol: string;
        child_symbol:  string;
        relationship:  string | null;
        category:      string | null;
        tier:          number | null;
      }>(
        `SELECT parent_symbol, child_symbol, relationship, category, tier
         FROM supply_chain
         WHERE ecosystem = $1`,
        [ecosystem],
      );

      const edges = edgeRows.map(r => ({
        parent_symbol: r.parent_symbol,
        child_symbol:  r.child_symbol,
        relationship:  r.relationship ?? null,
        category:      r.category     ?? null,
        tier:          r.tier         !== null ? Number(r.tier) : null,
      }));

      // ── 3. Ecosystem performance ─────────────────────────────────────────
      // Count up/down, compute average change, sum institutional net flows
      // Only include non-center nodes with price data.
      const memberSymbols = nodes
        .filter(n => !n.is_center && n.change_pct !== null)
        .map(n => n.symbol);

      let performance = {
        up_count:      0,
        down_count:    0,
        flat_count:    0,
        avg_change:    0,
        total_foreign_net: 0 as number | null,
      };

      if (memberSymbols.length > 0) {
        const placeholders = memberSymbols.map((_, i) => `$${i + 2}`).join(', ');

        const perfRows = await queryUnsafe<{
          up_count:   string;
          down_count: string;
          flat_count: string;
          avg_change: string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE dp.change_pct > 0)  AS up_count,
             COUNT(*) FILTER (WHERE dp.change_pct < 0)  AS down_count,
             COUNT(*) FILTER (WHERE dp.change_pct = 0)  AS flat_count,
             ROUND(AVG(dp.change_pct)::numeric, 2)       AS avg_change
           FROM daily_prices dp
           WHERE dp.symbol IN (${placeholders})
             AND dp.date = (SELECT MAX(date) FROM daily_prices WHERE symbol = $1)`,
          [memberSymbols[0], ...memberSymbols],
        );

        const flowRows = await queryUnsafe<{ total_net: string }>(
          `SELECT SUM(i.foreign_net) AS total_net
           FROM institutional_flows i
           WHERE i.symbol IN (${placeholders})
             AND i.date = (SELECT MAX(date) FROM institutional_flows WHERE symbol = $1)`,
          [memberSymbols[0], ...memberSymbols],
        );

        const p = perfRows[0];
        performance = {
          up_count:          parseInt(p?.up_count   ?? '0', 10),
          down_count:        parseInt(p?.down_count ?? '0', 10),
          flat_count:        parseInt(p?.flat_count ?? '0', 10),
          avg_change:        parseFloat(p?.avg_change ?? '0'),
          total_foreign_net: flowRows[0]?.total_net != null
            ? Number(flowRows[0].total_net)
            : null,
        };
      }

      return { nodes, edges, performance, ecosystem };
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error(`[supply-chain] Error (ecosystem=${ecosystem}):`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}