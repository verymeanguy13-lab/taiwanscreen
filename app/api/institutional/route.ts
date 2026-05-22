// =============================================================================
// app/api/institutional/route.ts
// GET /api/institutional?mode=market_summary
// GET /api/institutional?mode=top_foreign_buy&limit=30
// GET /api/institutional?mode=triple_buy
// GET /api/institutional?mode=consecutive_buy&days=5
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode  = searchParams.get('mode')  ?? 'market_summary';
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10)));
  const days  = Math.max(1, parseInt(searchParams.get('days') ?? '5', 10));

  const cacheKey = `institutional:${mode}:${limit}:${days}`;

  try {
    const data = await cached(cacheKey, 15 * 60, async () => {

      // ── market_summary ──────────────────────────────────────────────────
      if (mode === 'market_summary') {
        return queryUnsafe(
          `SELECT
             date,
             SUM(foreign_net) AS total_foreign,
             SUM(trust_net)   AS total_trust,
             SUM(dealer_net)  AS total_dealer
           FROM institutional_flows
           WHERE date >= NOW() - INTERVAL '30 days'
           GROUP BY date
           ORDER BY date ASC`,
          [],
        );
      }

      // ── top_foreign_buy ─────────────────────────────────────────────────
      if (mode === 'top_foreign_buy') {
        return queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector,
             i.foreign_net, i.foreign_buy, i.foreign_sell,
             i.foreign_consecutive_days,
             dp.close, dp.change_pct
           FROM institutional_flows i
           JOIN stocks s ON i.symbol = s.symbol
           JOIN daily_prices dp
             ON i.symbol = dp.symbol AND dp.date = i.date
           WHERE i.date = (SELECT MAX(date) FROM institutional_flows)
           ORDER BY i.foreign_net DESC
           LIMIT $1`,
          [limit],
        );
      }

      // ── top_foreign_sell ────────────────────────────────────────────────
      if (mode === 'top_foreign_sell') {
        return queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector,
             i.foreign_net, i.foreign_buy, i.foreign_sell,
             i.foreign_consecutive_days,
             dp.close, dp.change_pct
           FROM institutional_flows i
           JOIN stocks s ON i.symbol = s.symbol
           JOIN daily_prices dp
             ON i.symbol = dp.symbol AND dp.date = i.date
           WHERE i.date = (SELECT MAX(date) FROM institutional_flows)
           ORDER BY i.foreign_net ASC
           LIMIT $1`,
          [limit],
        );
      }

      // ── top_trust_buy ───────────────────────────────────────────────────
      if (mode === 'top_trust_buy') {
        return queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector,
             i.trust_net, i.trust_buy, i.trust_sell,
             i.trust_consecutive_days,
             dp.close, dp.change_pct
           FROM institutional_flows i
           JOIN stocks s ON i.symbol = s.symbol
           JOIN daily_prices dp
             ON i.symbol = dp.symbol AND dp.date = i.date
           WHERE i.date = (SELECT MAX(date) FROM institutional_flows)
           ORDER BY i.trust_net DESC
           LIMIT $1`,
          [limit],
        );
      }

      // ── triple_buy ──────────────────────────────────────────────────────
      if (mode === 'triple_buy') {
        return queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector,
             i.foreign_net, i.trust_net, i.dealer_net, i.total_net,
             i.foreign_consecutive_days, i.trust_consecutive_days,
             dp.close, dp.change_pct,
             -- Count consecutive days triple_buy has been true
             (
               SELECT COUNT(*) FROM (
                 SELECT date, triple_buy,
                   ROW_NUMBER() OVER (ORDER BY date DESC) AS rn,
                   ROW_NUMBER() OVER (PARTITION BY triple_buy ORDER BY date DESC) AS grp_rn
                 FROM institutional_flows sub
                 WHERE sub.symbol = i.symbol
                   AND sub.date <= i.date
               ) streak
               WHERE triple_buy = TRUE
                 AND rn = grp_rn
             ) AS triple_buy_streak
           FROM institutional_flows i
           JOIN stocks s ON i.symbol = s.symbol
           JOIN daily_prices dp
             ON i.symbol = dp.symbol AND dp.date = i.date
           WHERE i.triple_buy = TRUE
             AND i.date = (SELECT MAX(date) FROM institutional_flows)
           ORDER BY i.total_net DESC
           LIMIT $1`,
          [limit],
        );
      }

      // ── consecutive_buy ─────────────────────────────────────────────────
      if (mode === 'consecutive_buy') {
        // Join to daily_prices at (today - streak_days) to compute period return
        return queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector,
             i.foreign_net, i.foreign_consecutive_days,
             i.total_net,
             dp_today.close AS close_today,
             dp_today.change_pct,
             dp_start.close AS close_streak_start,
             -- Period return since streak started
             CASE
               WHEN dp_start.close IS NOT NULL AND dp_start.close > 0
               THEN ROUND(
                 ((dp_today.close - dp_start.close) / dp_start.close * 100)::numeric,
                 2
               )
               ELSE NULL
             END AS period_return_pct
           FROM institutional_flows i
           JOIN stocks s ON i.symbol = s.symbol
           -- Today's price
           JOIN daily_prices dp_today
             ON i.symbol = dp_today.symbol AND dp_today.date = i.date
           -- Price at streak start (closest available date)
           LEFT JOIN daily_prices dp_start
             ON i.symbol = dp_start.symbol
             AND dp_start.date = (
               SELECT MAX(date)
               FROM daily_prices dp_lookback
               WHERE dp_lookback.symbol = i.symbol
                 AND dp_lookback.date <= (
                   i.date - (i.foreign_consecutive_days || ' days')::interval
                 )
             )
           WHERE i.date = (SELECT MAX(date) FROM institutional_flows)
             AND i.foreign_consecutive_days >= $1
           ORDER BY i.foreign_consecutive_days DESC
           LIMIT $2`,
          [days, limit],
        );
      }

      // ── Unknown mode ────────────────────────────────────────────────────
      throw new Error(`Unknown mode: ${mode}`);
    });

    return NextResponse.json({ data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('Unknown mode') ? 400 : 500;
    console.error(`[institutional] Error (mode=${mode}):`, err);
    return NextResponse.json({ error: msg }, { status });
  }
}