// =============================================================================
// app/api/heatmap/route.ts
// GET /api/heatmap?market=TWSE&size_by=market_cap
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

interface HeatMapStock {
  symbol:     string;
  name_zh:    string;
  sector:     string;
  close:      number | null;
  change_pct: number | null;
  volume:     number | null;
  market_cap: number | null;
}

interface SectorGroup {
  name:   string;
  stocks: HeatMapStock[];
}

interface MarketSummary {
  up_count:     number;
  down_count:   number;
  flat_count:   number;
  total_volume: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const market  = searchParams.get('market')  ?? 'all';
  const size_by = searchParams.get('size_by') ?? 'volume';

  try {
    // ── Build market filter ──────────────────────────────────────────────────
    const marketFilter = market === 'TWSE'
      ? `AND s.market = 'TWSE'`
      : market === 'TPEx'
        ? `AND s.market = 'TPEx'`
        : '';

    // ── 1. Stocks query ──────────────────────────────────────────────────────
    const stockRows = await queryUnsafe<HeatMapStock & { sector: string }>(
      `SELECT
         s.symbol,
         s.name_zh,
         COALESCE(s.sector, '其他') AS sector,
         dp.close,
         dp.change_pct,
         dp.volume,
         f.market_cap
       FROM stocks s
       JOIN daily_prices dp
         ON s.symbol = dp.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices)
       LEFT JOIN fundamentals f
         ON s.symbol = f.symbol
         AND f.period = (
           SELECT MAX(period) FROM fundamentals WHERE symbol = s.symbol
         )
       WHERE s.market IN ('TWSE', 'TPEx')
       ${marketFilter}
       AND dp.volume > 0
       ORDER BY dp.volume DESC`,
      [],
    );

    // ── 2. Market summary ────────────────────────────────────────────────────
    const summaryRows = await queryUnsafe<{
      up_count:     string;
      down_count:   string;
      flat_count:   string;
      total_volume: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE dp.change_pct > 0)  AS up_count,
         COUNT(*) FILTER (WHERE dp.change_pct < 0)  AS down_count,
         COUNT(*) FILTER (WHERE dp.change_pct = 0)  AS flat_count,
         SUM(dp.volume)                              AS total_volume
       FROM stocks s
       JOIN daily_prices dp
         ON s.symbol = dp.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices)
       WHERE s.market IN ('TWSE', 'TPEx')
       ${marketFilter}`,
      [],
    );

    const raw = summaryRows[0];
    const marketSummary: MarketSummary = {
      up_count:     parseInt(raw?.up_count     ?? '0', 10),
      down_count:   parseInt(raw?.down_count   ?? '0', 10),
      flat_count:   parseInt(raw?.flat_count   ?? '0', 10),
      total_volume: parseInt(raw?.total_volume ?? '0', 10),
    };

    // ── 3. Group by sector ───────────────────────────────────────────────────
    const sectorMap = new Map<string, HeatMapStock[]>();

    for (const row of stockRows) {
      const sector = row.sector || '其他';
      if (!sectorMap.has(sector)) sectorMap.set(sector, []);
      sectorMap.get(sector)!.push({
        symbol:     row.symbol,
        name_zh:    row.name_zh,
        sector:     row.sector,
        close:      row.close      !== null ? Number(row.close)      : null,
        change_pct: row.change_pct !== null ? Number(row.change_pct) : null,
        volume:     row.volume     !== null ? Number(row.volume)     : null,
        // For market_cap: fall back to volume-based sizing if null
        market_cap: row.market_cap !== null
          ? Number(row.market_cap)
          : (row.volume !== null ? Number(row.volume) * Number(row.close ?? 1) : null),
      });
    }

    // ── 4. Sort sectors by total volume descending ───────────────────────────
    const sectors: SectorGroup[] = [...sectorMap.entries()]
      .map(([name, stocks]) => ({
        name,
        stocks,
        _total: stocks.reduce((sum, s) => sum + (s.volume ?? 0), 0),
      }))
      .sort((a, b) => b._total - a._total)
      .map(({ name, stocks }) => ({ name, stocks }));

    return NextResponse.json(
      { marketSummary, sectors },
      { headers: { 'Cache-Control': 'no-store' } },
    );

  } catch (err) {
    console.error('[heatmap] error:', err);
    return NextResponse.json({
      marketSummary: { up_count: 0, down_count: 0, flat_count: 0, total_volume: 0 },
      sectors: [],
    });
  }
}