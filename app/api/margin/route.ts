// =============================================================================
// app/api/margin/route.ts
// GET /api/margin?mode=market_total
// GET /api/margin?mode=top_margin_increase
// GET /api/margin?mode=short_squeeze
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get('mode') ?? 'market_total';

  const cacheKey = `margin:${mode}`;

  try {
    const data = await cached(cacheKey, 15 * 60, async () => {

      // ── market_total ──────────────────────────────────────────────────
      if (mode === 'market_total') {
        return queryUnsafe(
          `SELECT
             date,
             SUM(margin_balance) AS total_margin,
             SUM(short_balance)  AS total_short
           FROM margin_data
           WHERE date >= NOW() - INTERVAL '60 days'
           GROUP BY date
           ORDER BY date ASC`,
          [],
        );
      }

      // ── top_margin_increase ───────────────────────────────────────────
      if (mode === 'top_margin_increase') {
        return queryUnsafe(
          `SELECT
             m.symbol,
             s.name_zh,
             s.sector,
             m.margin_change,
             m.margin_balance,
             m.margin_ratio,
             dp.close,
             dp.change_pct
           FROM margin_data m
           JOIN stocks s ON m.symbol = s.symbol
           LEFT JOIN daily_prices dp
             ON m.symbol = dp.symbol
             AND dp.date = m.date
           WHERE m.date = (SELECT MAX(date) FROM margin_data)
             AND m.margin_change IS NOT NULL
           ORDER BY m.margin_change DESC
           LIMIT 20`,
          [],
        );
      }

      // ── top_margin_decrease ───────────────────────────────────────────
      if (mode === 'top_margin_decrease') {
        return queryUnsafe(
          `SELECT
             m.symbol,
             s.name_zh,
             s.sector,
             m.margin_change,
             m.margin_balance,
             m.margin_ratio,
             dp.close,
             dp.change_pct
           FROM margin_data m
           JOIN stocks s ON m.symbol = s.symbol
           LEFT JOIN daily_prices dp
             ON m.symbol = dp.symbol
             AND dp.date = m.date
           WHERE m.date = (SELECT MAX(date) FROM margin_data)
             AND m.margin_change IS NOT NULL
           ORDER BY m.margin_change ASC
           LIMIT 20`,
          [],
        );
      }

      // ── top_short ─────────────────────────────────────────────────────
      if (mode === 'top_short') {
        return queryUnsafe(
          `SELECT
             m.symbol,
             s.name_zh,
             s.sector,
             m.short_balance,
             m.short_change,
             m.margin_balance,
             -- short_ratio: short_balance / margin_balance * 100
             CASE
               WHEN m.margin_balance > 0
               THEN ROUND(m.short_balance::numeric / m.margin_balance * 100, 2)
               ELSE NULL
             END AS short_ratio,
             dp.close,
             dp.change_pct
           FROM margin_data m
           JOIN stocks s ON m.symbol = s.symbol
           LEFT JOIN daily_prices dp
             ON m.symbol = dp.symbol
             AND dp.date = m.date
           WHERE m.date = (SELECT MAX(date) FROM margin_data)
             AND m.short_balance > 0
           ORDER BY m.short_balance DESC
           LIMIT 20`,
          [],
        );
      }

      // ── short_squeeze ─────────────────────────────────────────────────
      // High short interest + foreign consecutive buying = squeeze candidate
      if (mode === 'short_squeeze') {
        return queryUnsafe(
          `SELECT
             m.symbol,
             s.name_zh,
             s.sector,
             m.short_balance,
             m.margin_balance,
             CASE
               WHEN m.margin_balance > 0
               THEN ROUND(m.short_balance::numeric / m.margin_balance * 100, 2)
               ELSE NULL
             END AS short_ratio,
             i.foreign_consecutive_days,
             i.foreign_net,
             dp.close,
             dp.change_pct,
             -- Squeeze score: higher short × more consecutive buying days = hotter
             (m.short_balance * i.foreign_consecutive_days) AS squeeze_score
           FROM margin_data m
           JOIN stocks s ON m.symbol = s.symbol
           JOIN institutional_flows i
             ON m.symbol = i.symbol
             AND i.date = m.date
           LEFT JOIN daily_prices dp
             ON m.symbol = dp.symbol
             AND dp.date = m.date
           WHERE m.date = (
             SELECT MAX(m2.date) FROM margin_data m2
             JOIN institutional_flows i2 ON m2.date = i2.date
           )
             AND m.short_balance > 0
             AND i.foreign_consecutive_days >= 3
           ORDER BY squeeze_score DESC
           LIMIT 30`,
          [],
        );
      }

      throw new Error(`Unknown mode: ${mode}`);
    });

    return NextResponse.json({ data });
  } catch (err) {
    const msg    = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('Unknown mode') ? 400 : 500;
    console.error(`[margin] Error (mode=${mode}):`, err);
    return NextResponse.json({ error: msg }, { status });
  }
}