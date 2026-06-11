// =============================================================================
// app/api/broker/route.ts
// GET /api/broker?mode=top_buyers
// GET /api/broker?mode=top_sellers
// GET /api/broker?mode=concentration
// GET /api/broker?mode=stock_brokers&symbol=2330
//
// TEMPORARY: uses institutional_flows while real broker branch scraping
// (bsr.twse.com.tw) is not yet implemented. Will be replaced with actual
// broker branch data in a future session.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode   = searchParams.get('mode')   ?? 'top_buyers';
  const symbol = searchParams.get('symbol') ?? '';

  const cacheKey = `broker:${mode}:${symbol}`;

  try {
    const data = await cached(cacheKey, 15 * 60, async () => {

      // ── top_buyers: stocks with highest foreign net buy today ─────────
      if (mode === 'top_buyers') {
        return queryUnsafe(
          `SELECT
             s.name_zh                          AS broker_name,
             i.symbol                           AS broker_id,
             s.sector                           AS city,
             i.foreign_net                      AS total_buy,
             (i.foreign_net + i.trust_net
              + i.dealer_net)                   AS total_net
           FROM institutional_flows i
           JOIN stocks s ON s.symbol = i.symbol
           WHERE i.date = (SELECT MAX(date) FROM institutional_flows)
             AND i.foreign_net > 0
           ORDER BY i.foreign_net DESC
           LIMIT 20`,
          [],
        );
      }

      // ── top_sellers: stocks with highest foreign net sell today ───────
      if (mode === 'top_sellers') {
        return queryUnsafe(
          `SELECT
             s.name_zh                          AS broker_name,
             i.symbol                           AS broker_id,
             s.sector                           AS city,
             ABS(i.foreign_net)                 AS total_sell,
             (i.foreign_net + i.trust_net
              + i.dealer_net)                   AS total_net
           FROM institutional_flows i
           JOIN stocks s ON s.symbol = i.symbol
           WHERE i.date = (SELECT MAX(date) FROM institutional_flows)
             AND i.foreign_net < 0
           ORDER BY i.foreign_net ASC
           LIMIT 20`,
          [],
        );
      }

      // ── concentration: stocks where foreign + trust both buying ───────
      // Treats combined foreign+trust net as "concentration" signal.
      // Stocks where both institutions buy simultaneously = high conviction.
      if (mode === 'concentration') {
        return queryUnsafe(
          `WITH latest AS (
             SELECT MAX(date) AS d FROM institutional_flows
           ),
           flows AS (
             SELECT
               i.symbol,
               s.name_zh,
               i.foreign_net,
               i.trust_net,
               i.dealer_net,
               i.total_net,
               i.foreign_net + i.trust_net AS combined_net,
               dp.close,
               dp.change_pct
             FROM institutional_flows i
             JOIN stocks s ON s.symbol = i.symbol
             LEFT JOIN daily_prices dp
               ON dp.symbol = i.symbol
               AND dp.date = (SELECT MAX(date) FROM daily_prices)
             CROSS JOIN latest
             WHERE i.date = latest.d
               AND i.foreign_net > 0
               AND i.trust_net > 0
           ),
           total_inst AS (
             SELECT SUM(ABS(total_net)) AS grand_total FROM flows
           )
           SELECT
             f.symbol,
             f.name_zh,
             '外資+投信同買' AS broker_name,
             CASE WHEN ti.grand_total > 0
               THEN ROUND(f.combined_net::numeric / NULLIF(ti.grand_total, 0) * 100, 1)
               ELSE 0
             END AS concentration_pct,
             f.combined_net AS buy_volume,
             f.close,
             f.change_pct
           FROM flows f
           CROSS JOIN total_inst ti
           WHERE f.combined_net > 0
           ORDER BY f.combined_net DESC
           LIMIT 50`,
          [],
        );
      }

      // ── stock_brokers: institutional flow history for one stock ───────
      if (mode === 'stock_brokers') {
        if (!symbol) throw new Error('symbol param required for stock_brokers mode');
        return queryUnsafe(
          `SELECT
             i.symbol                                    AS broker_id,
             s.name_zh                                   AS broker_name,
             s.sector                                    AS city,
             i.foreign_net                               AS total_buy,
             ABS(LEAST(i.foreign_net, 0))                AS total_sell,
             i.foreign_net + i.trust_net + i.dealer_net  AS total_net
           FROM institutional_flows i
           JOIN stocks s ON s.symbol = i.symbol
           WHERE i.symbol = $1
             AND i.date >= NOW() - INTERVAL '20 days'
           ORDER BY i.date DESC`,
          [symbol.toUpperCase()],
        );
      }

      throw new Error(`Unknown mode: ${mode}`);
    });

    return NextResponse.json({ data });
  } catch (err) {
    const msg    = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('Unknown mode') || msg.includes('required') ? 400 : 500;
    console.error(`[broker] Error (mode=${mode}):`, err);
    return NextResponse.json({ error: msg }, { status });
  }
}