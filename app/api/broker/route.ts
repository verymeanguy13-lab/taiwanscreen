// =============================================================================
// app/api/broker/route.ts
// GET /api/broker?mode=top_buyers
// GET /api/broker?mode=concentration
// GET /api/broker?mode=stock_brokers&symbol=2330
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

      // ── top_buyers ────────────────────────────────────────────────────
      if (mode === 'top_buyers') {
        return queryUnsafe(
          `SELECT
             bb.broker_name,
             bb.broker_id,
             bb.city,
             SUM(bf.buy_volume) AS total_buy,
             SUM(bf.net_volume) AS total_net
           FROM broker_flows bf
           JOIN broker_branches bb USING (broker_id)
           WHERE bf.date = (SELECT MAX(date) FROM broker_flows)
           GROUP BY bb.broker_name, bb.broker_id, bb.city
           ORDER BY total_buy DESC
           LIMIT 20`,
          [],
        );
      }

      // ── top_sellers ───────────────────────────────────────────────────
      if (mode === 'top_sellers') {
        return queryUnsafe(
          `SELECT
             bb.broker_name,
             bb.broker_id,
             bb.city,
             SUM(bf.sell_volume) AS total_sell,
             SUM(bf.net_volume)  AS total_net
           FROM broker_flows bf
           JOIN broker_branches bb USING (broker_id)
           WHERE bf.date = (SELECT MAX(date) FROM broker_flows)
           GROUP BY bb.broker_name, bb.broker_id, bb.city
           ORDER BY total_net ASC
           LIMIT 20`,
          [],
        );
      }

      // ── concentration ─────────────────────────────────────────────────
      // Find stocks where the top-3 brokers by buy_volume account for
      // more than 50% of the stock's total buy volume today.
      if (mode === 'concentration') {
        return queryUnsafe(
          `WITH today_flows AS (
             SELECT
               bf.symbol,
               bf.broker_id,
               bb.broker_name,
               bf.buy_volume,
               bf.net_volume
             FROM broker_flows bf
             JOIN broker_branches bb USING (broker_id)
             WHERE bf.date = (SELECT MAX(date) FROM broker_flows)
               AND bf.buy_volume > 0
           ),
           stock_totals AS (
             SELECT symbol, SUM(buy_volume) AS total_buy_vol
             FROM today_flows
             GROUP BY symbol
           ),
           ranked AS (
             SELECT
               tf.symbol,
               tf.broker_name,
               tf.buy_volume,
               tf.net_volume,
               st.total_buy_vol,
               ROUND(tf.buy_volume::numeric / NULLIF(st.total_buy_vol, 0) * 100, 1) AS concentration_pct,
               ROW_NUMBER() OVER (PARTITION BY tf.symbol ORDER BY tf.buy_volume DESC) AS rn
             FROM today_flows tf
             JOIN stock_totals st ON tf.symbol = st.symbol
           ),
           top3 AS (
             SELECT
               symbol,
               SUM(buy_volume)         AS top3_buy,
               total_buy_vol,
               MAX(broker_name)        AS top_broker_name,
               MAX(concentration_pct)  AS top_concentration_pct
             FROM ranked
             WHERE rn <= 3
             GROUP BY symbol, total_buy_vol
           ),
           concentration_result AS (
             SELECT
               t.symbol,
               t.top_broker_name            AS broker_name,
               t.top_concentration_pct      AS concentration_pct,
               t.top3_buy                   AS buy_volume,
               t.total_buy_vol
             FROM top3 t
             WHERE ROUND(t.top3_buy::numeric / NULLIF(t.total_buy_vol, 0) * 100, 1) >= 50
           )
           SELECT
             cr.symbol,
             s.name_zh,
             cr.broker_name,
             cr.concentration_pct,
             cr.buy_volume,
             dp.close,
             dp.change_pct
           FROM concentration_result cr
           JOIN stocks s ON cr.symbol = s.symbol
           LEFT JOIN daily_prices dp
             ON cr.symbol = dp.symbol
             AND dp.date = (SELECT MAX(date) FROM daily_prices)
           ORDER BY cr.concentration_pct DESC
           LIMIT 50`,
          [],
        );
      }

      // ── stock_brokers ─────────────────────────────────────────────────
      if (mode === 'stock_brokers') {
        if (!symbol) throw new Error('symbol param required for stock_brokers mode');
        return queryUnsafe(
          `SELECT
             bf.broker_id,
             bb.broker_name,
             bb.city,
             SUM(bf.buy_volume)  AS total_buy,
             SUM(bf.sell_volume) AS total_sell,
             SUM(bf.net_volume)  AS total_net
           FROM broker_flows bf
           JOIN broker_branches bb USING (broker_id)
           WHERE bf.symbol = $1
             AND bf.date >= NOW() - INTERVAL '20 days'
           GROUP BY bf.broker_id, bb.broker_name, bb.city
           ORDER BY total_net DESC`,
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