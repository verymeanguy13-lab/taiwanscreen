// =============================================================================
// app/api/heatmap/route.ts
// GET /api/heatmap?market=TWSE&size_by=market_cap
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

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

interface HeatmapResponse {
  marketSummary: MarketSummary;
  sectors:       SectorGroup[];
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const market  = searchParams.get('market')  ?? 'all';
  const size_by = searchParams.get('size_by') ?? 'market_cap';

  const cacheKey = `heatmap:${market}:${size_by}`;

  try {
    const result = await cached<HeatmapResponse>(cacheKey, 15 * 60, async () => {
      // ── Build optional market filter ───────────────────────────────────
      const whereMarket   = market !== 'all' ? `AND s.market = '${market === 'TWSE' ? 'TWSE' : 'TPEx'}'` : '';
      const havingMarket  = market !== 'all' ? `AND s.market = '${market === 'TWSE' ? 'TWSE' : 'TPEx'}'` : '';

      // ── 1. Stocks query ────────────────────────────────────────────────
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
         WHERE s.market != 'FOREIGN'
         ${whereMarket}
         ORDER BY f.market_cap DESC NULLS LAST`,
        [],
      );

      // ── 2. Market summary query ────────────────────────────────────────
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
         WHERE s.market != 'FOREIGN'
         ${havingMarket}`,
        [],
      );

      const raw = summaryRows[0];
      const marketSummary: MarketSummary = {
        up_count:     parseInt(raw?.up_count     ?? '0', 10),
        down_count:   parseInt(raw?.down_count   ?? '0', 10),
        flat_count:   parseInt(raw?.flat_count   ?? '0', 10),
        total_volume: parseInt(raw?.total_volume ?? '0', 10),
      };

      // ── 3. Group by sector ─────────────────────────────────────────────
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
          market_cap: row.market_cap !== null ? Number(row.market_cap) : null,
        });
      }

      // Sort sectors by total market cap descending
      const sectors: SectorGroup[] = [...sectorMap.entries()]
        .map(([name, stocks]) => ({
          name,
          stocks,
          _totalCap: stocks.reduce((sum, s) => sum + (s.market_cap ?? 0), 0),
        }))
        .sort((a, b) => b._totalCap - a._totalCap)
        .map(({ name, stocks }) => ({ name, stocks }));

      return { marketSummary, sectors };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[heatmap] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}