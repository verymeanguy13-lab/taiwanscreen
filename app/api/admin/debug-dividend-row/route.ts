// app/api/admin/debug-dividend-row/route.ts
//
// TEMPORARY debug tool — combined checks used throughout tonight's session:
// dividend data, backtest filter counts, 6901's position in the stock list,
// and the scope of the negative-revenue margin bug. Delete once confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // True count of stocks with latest ROE >= 20 (no LIMIT)
  const roeCheck = await queryUnsafe(
    `SELECT COUNT(DISTINCT s.symbol) AS true_count
     FROM stocks s
     WHERE (
       SELECT roe FROM fundamentals
       WHERE symbol = s.symbol AND roe IS NOT NULL
       ORDER BY period DESC LIMIT 1
     ) >= 20`,
    [],
  );

  // True count of stocks with latest eps_growth_yoy >= 20 AND revenue_growth_yoy >= 15 (no LIMIT)
  const growthCheck = await queryUnsafe(
    `SELECT COUNT(DISTINCT s.symbol) AS true_count
     FROM stocks s
     WHERE (
       SELECT eps_growth_yoy FROM fundamentals
       WHERE symbol = s.symbol AND eps_growth_yoy IS NOT NULL
       ORDER BY period DESC LIMIT 1
     ) >= 20
     AND (
       SELECT revenue_growth_yoy FROM fundamentals
       WHERE symbol = s.symbol AND revenue_growth_yoy IS NOT NULL
       ORDER BY period DESC LIMIT 1
     ) >= 15`,
    [],
  );

  // 6901's position in the alphabetically-sorted stock list, to know which
  // offset/batch will actually reach it
  const positionCheck = await queryUnsafe(
    `SELECT COUNT(*)::int AS offset_for_6901 FROM stocks WHERE symbol < '2637'`,
    [],
  );

  // How widespread the negative-revenue margin bug actually was/is
  const scopeCheck = await queryUnsafe(
    `SELECT
       COUNT(DISTINCT symbol) FILTER (WHERE revenue < 0)        AS negative_revenue_stocks,
       COUNT(*)               FILTER (WHERE revenue < 0)        AS negative_revenue_rows,
       COUNT(*)               FILTER (WHERE gross_margin = 100) AS bogus_100pct_gross_margin_rows,
       COUNT(DISTINCT symbol) FILTER (WHERE gross_margin = 100) AS bogus_100pct_gross_margin_stocks
     FROM fundamentals`,
    [],
  );

  // Every raw row that exists for 6901, exactly as stored — to check whether
  // a separate current-quarter row (holding only pe_ratio/pb_ratio) exists
  // alongside the reported-quarter rows (holding eps/revenue/margins).
  const rawRows6901 = await queryUnsafe(
    `SELECT * FROM fundamentals WHERE symbol = '6901' ORDER BY period DESC`,
    [],
  );

  // Why do semiconductor / monthly_income / quarterly_dividend / stable_dividend
  // presets return 0 samples? Check the actual stored values behind each.
  const sectorCheck = await queryUnsafe(
    `SELECT sector, COUNT(*)::int AS n FROM stocks GROUP BY sector ORDER BY n DESC LIMIT 20`,
    [],
  );
  const dividendFreqCheck = await queryUnsafe(
    `SELECT dividend_frequency, COUNT(*)::int AS n FROM dividend_summary GROUP BY dividend_frequency ORDER BY n DESC`,
    [],
  );
  const stabilityScoreCheck = await queryUnsafe(
    `SELECT
       COUNT(*)::int                                  AS total_rows,
       COUNT(stability_score)::int                    AS non_null_rows,
       MAX(stability_score)::int                      AS max_score,
       COUNT(*) FILTER (WHERE stability_score >= 80)::int AS rows_ge_80
     FROM dividend_summary`,
    [],
  );

 // Does the backtest's mandatory institutional_flows join silently exclude
  // stocks that have no institutional data at all — even for presets whose
  // filters don't need institutional data (like a pure sector filter)?
  const semiconductorJoinCheck = await queryUnsafe(
    `SELECT
       COUNT(*)::int AS total_semiconductor_stocks,
       COUNT(*) FILTER (WHERE i.symbol IS NOT NULL)::int AS have_any_institutional_row
     FROM stocks s
     LEFT JOIN institutional_flows i ON s.symbol = i.symbol
     WHERE s.sector = '半導體業'`,
    [],
  );

  // Session 79: even after fixing the institutional_flows AND daily_prices
  // joins to LATERAL, 半導體族群 still returns 0 samples. Check whether
  // these 111 stocks have ANY daily_prices row at all (not just recent) --
  // if daily_prices ingestion hasn't reached them yet (same as the
  // institutional_flows gap above), no query fix can produce a return,
  // since Step 2 of the backtest fundamentally needs at least one price
  // row to compute return_pct.
  const dailyPricesCoverageCheck = await queryUnsafe(
    `SELECT
       COUNT(*)::int AS total_semiconductor_stocks,
       COUNT(*) FILTER (WHERE dp.symbol IS NOT NULL)::int AS have_any_daily_price_row,
       MIN(dp.latest_date)::text AS earliest_latest_date,
       MAX(dp.latest_date)::text AS latest_latest_date
     FROM stocks s
     LEFT JOIN LATERAL (
       SELECT symbol, MAX(date) AS latest_date
       FROM daily_prices
       WHERE symbol = s.symbol
       GROUP BY symbol
     ) dp ON true
     WHERE s.sector = '半導體業'`,
    [],
  );

 // Session 79: is the 2026-06-05 staleness specific to the semiconductor
  // sector, or is the ENTIRE daily_prices table frozen at that date (i.e.
  // fetchAllStockPrices/ingestDailyPrices has been silently failing site-wide
  // every day since then)? This is the single most important thing to know
  // before chasing this further.
  const globalPricesFreshnessCheck = await queryUnsafe(
    `SELECT
       MAX(date)::text                              AS global_latest_date,
       COUNT(*) FILTER (WHERE date = (SELECT MAX(date) FROM daily_prices))::int AS rows_on_latest_date,
       COUNT(DISTINCT date)::int                     AS total_distinct_dates,
       (SELECT COUNT(*)::int FROM daily_prices WHERE date >= CURRENT_DATE - INTERVAL '10 days') AS rows_in_last_10_days
     FROM daily_prices`,
    [],
  );

  return NextResponse.json({
    roeCheck, growthCheck, positionCheck, scopeCheck, rawRows6901,
    sectorCheck, dividendFreqCheck, stabilityScoreCheck,
    semiconductorJoinCheck, dailyPricesCoverageCheck, globalPricesFreshnessCheck,
  });


}
