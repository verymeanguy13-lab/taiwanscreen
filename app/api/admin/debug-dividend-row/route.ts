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

  const globalPricesFreshnessCheck = await queryUnsafe(
    `SELECT
       MAX(date)::text                              AS global_latest_date,
       COUNT(*) FILTER (WHERE date = (SELECT MAX(date) FROM daily_prices))::int AS rows_on_latest_date,
       COUNT(DISTINCT date)::int                     AS total_distinct_dates,
       (SELECT COUNT(*)::int FROM daily_prices WHERE date >= CURRENT_DATE - INTERVAL '10 days') AS rows_in_last_10_days
     FROM daily_prices`,
    [],
  );

  // ── NEW (Session 82): the definitive systemic-vs-ETF-specific check from
  // the Session 81 handoff — global MIN(date) across the WHOLE daily_prices
  // table, plus a direct spot-check on several long-listed ordinary stocks
  // (TSMC, Hon Hai, MediaTek, Formosa Plastics, Chunghwa Telecom) that have
  // obviously existed for decades, to see whether THEY are also capped at
  // ~March 2026 or have genuinely deep history.
  const globalPriceHistoryDepthCheck = await queryUnsafe(
    `SELECT
       MIN(date)::text              AS global_earliest_date,
       MAX(date)::text              AS global_latest_date,
       COUNT(DISTINCT symbol)::int  AS symbols_with_price_data
     FROM daily_prices`,
    [],
  );

  const ordinaryStockHistoryCheck = await queryUnsafe(
    `SELECT symbol,
            MIN(date)::text AS earliest_date,
            MAX(date)::text AS latest_date,
            COUNT(*)::int   AS total_rows
     FROM daily_prices
     WHERE symbol IN ('2330', '2317', '2454', '1301', '2412')
     GROUP BY symbol
     ORDER BY symbol`,
    [],
  );

  const semiconductorByMarketCheck = await queryUnsafe(
    `SELECT
       s.market,
       COUNT(*)::int             AS stock_count,
       MIN(dp.latest_date)::text AS earliest_latest_date,
       MAX(dp.latest_date)::text AS latest_latest_date
     FROM stocks s
     LEFT JOIN LATERAL (
       SELECT MAX(date) AS latest_date
       FROM daily_prices
       WHERE symbol = s.symbol
     ) dp ON true
     WHERE s.sector = '半導體業'
     GROUP BY s.market
     ORDER BY s.market`,
    [],
  );

  const tsmcPriceCheck = await queryUnsafe(
    `SELECT symbol, MAX(date)::text AS latest_date, COUNT(*)::int AS total_rows
     FROM daily_prices WHERE symbol = '2330' GROUP BY symbol`,
    [],
  );

  const rawDividends00919 = await queryUnsafe(
    `SELECT symbol, year, period, cash_dividend, ex_dividend_date
     FROM dividends WHERE symbol = '00919' ORDER BY ex_dividend_date DESC LIMIT 20`,
    [],
  );
  const periodEqualsYearCheck = await queryUnsafe(
    `SELECT
       COUNT(*)::int AS total_rows,
       COUNT(*) FILTER (WHERE period = year::text)::int AS period_equals_year_rows,
       COUNT(DISTINCT symbol)::int AS distinct_symbols
     FROM dividends`,
    [],
  );
  const rowsPerSymbolPerYear = await queryUnsafe(
    `SELECT symbol, year, COUNT(*)::int AS rows_this_year
     FROM dividends WHERE symbol = '00919' GROUP BY symbol, year ORDER BY year DESC`,
    [],
  );

  // ── NEW (Session 81): does latest_yield_pct actually clear the preset's
  // yield_min threshold for the 8 stocks now correctly classified as
  // monthly/quarterly? If null or too low, that's the real remaining gap —
  // not the period/frequency/date bugs fixed last session.
  const yieldGapCheck = await queryUnsafe(
    `SELECT symbol, dividend_frequency, stability_score, latest_yield_pct,
            consecutive_years
     FROM dividend_summary
     WHERE dividend_frequency IN ('monthly', 'quarterly')
     ORDER BY dividend_frequency, latest_yield_pct DESC NULLS LAST`,
    [],
  );

  // ── NEW (Session 81): why did today's cron/daily run report prices=0 and
  // institutional=0? Check whether today's date already had >100 daily_prices
  // rows (triggering ingestDailyPrices' skip-safety-check) vs genuinely zero,
  // and same for institutional_flows (which has no such skip check, so zero
  // there most likely means TWSE's T86 endpoint hadn't published yet).
  const todayIngestCheck = await queryUnsafe(
    `SELECT
       (SELECT COUNT(*)::int FROM daily_prices WHERE date = CURRENT_DATE) AS prices_today_count,
       (SELECT COUNT(*)::int FROM institutional_flows WHERE date = CURRENT_DATE) AS institutional_today_count,
       (SELECT MAX(date)::text FROM daily_prices) AS global_max_price_date,
       (SELECT MAX(date)::text FROM institutional_flows) AS global_max_institutional_date`,
    [],
  );

  // Which margin_data symbols are hitting the FK violation against stocks,
  // and are they a known pattern (leveraged/inverse/bond ETFs, new listings
  // not yet in fetchStockList's source) rather than a real ingestion bug?
  const marginOrphanSample = await queryUnsafe(
    `SELECT DISTINCT symbol FROM margin_data
     WHERE symbol NOT IN (SELECT symbol FROM stocks)
     ORDER BY symbol LIMIT 30`,
    [],
  );
  const marginOrphanCount = await queryUnsafe(
    `SELECT COUNT(DISTINCT symbol)::int AS orphan_symbol_count
     FROM margin_data WHERE symbol NOT IN (SELECT symbol FROM stocks)`,
    [],
  );

  // ── NEW (Session 81): find the exact offset of each yield-gap ETF within
  // ingest-dividends' own ordering (symbol, filtered to stocks with recent
  // daily_prices), so we can target them directly instead of batching
  // through the whole alphabet.
  const targetSymbols = ['0056', '00713', '00850', '00878', '00891', '00919', '00929'];
  const offsetCheck = await queryUnsafe(
    `WITH ordered AS (
       SELECT s.symbol, ROW_NUMBER() OVER (ORDER BY s.symbol) - 1 AS rn
       FROM stocks s
       JOIN daily_prices dp ON dp.symbol = s.symbol
       WHERE dp.date >= NOW() - INTERVAL '30 days'
       GROUP BY s.symbol
     )
     SELECT symbol, rn AS offset
     FROM ordered
     WHERE symbol = ANY($1)
     ORDER BY rn`,
    [targetSymbols],
  );

  // ── NEW (Session 81): reproduce the backtest's exact WHERE conditions
  // directly against stocks + dividend_summary, stripped of every LATERAL
  // join and startDate logic, to isolate whether the join itself is the
  // problem or something else entirely.
  const minimalMonthlyCheck = await queryUnsafe(
    `SELECT s.symbol, s.name_zh, ds.dividend_frequency, ds.latest_yield_pct
     FROM stocks s
     LEFT JOIN dividend_summary ds ON s.symbol = ds.symbol
     WHERE ds.dividend_frequency = 'monthly' AND ds.latest_yield_pct >= 3`,
    [],
  );
  const minimalQuarterlyCheck = await queryUnsafe(
    `SELECT s.symbol, s.name_zh, ds.dividend_frequency, ds.latest_yield_pct
     FROM stocks s
     LEFT JOIN dividend_summary ds ON s.symbol = ds.symbol
     WHERE ds.dividend_frequency = 'quarterly' AND ds.latest_yield_pct >= 4`,
    [],
  );
  // Same check but confirming these symbols exist in `stocks` at all with
  // an exact-match, case/whitespace-sensitive equality check
  const exactSymbolCheck = await queryUnsafe(
    `SELECT symbol, name_zh, LENGTH(symbol) AS symbol_len
     FROM stocks WHERE symbol IN ('00929', '0056', '00919')`,
    [],
  );

  // ── NEW (Session 81): the FULL backtest matchingRows query, byte-for-byte
  // identical to app/api/backtest/route.ts including every LATERAL join,
  // with a hardcoded startDate matching what a real '6M' period request
  // would compute today. If this comes back empty while minimalMonthlyCheck
  // above came back populated, the bug is specifically in one of these
  // LATERAL joins or in how the parameters bind — not in the data itself.
  const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const fullQueryReproMonthly = await queryUnsafe(
    `SELECT s.symbol, s.name_zh
     FROM stocks s
     LEFT JOIN LATERAL (
       SELECT close, change_pct, volume, date
       FROM daily_prices
       WHERE symbol = s.symbol AND date <= '${sixMonthsAgo}'
       ORDER BY date DESC
       LIMIT 1
     ) dp ON true
     LEFT JOIN LATERAL (
       SELECT
         (SELECT pe_ratio FROM fundamentals WHERE symbol = s.symbol AND pe_ratio IS NOT NULL ORDER BY period DESC LIMIT 1) AS pe_ratio
     ) f ON true
     LEFT JOIN LATERAL (
       SELECT foreign_net, trust_net, dealer_net,
              foreign_consecutive_days, trust_consecutive_days, triple_buy
       FROM institutional_flows
       WHERE symbol = s.symbol AND date <= '${sixMonthsAgo}'
       ORDER BY date DESC
       LIMIT 1
     ) i ON true
     LEFT JOIN dividend_summary ds ON s.symbol = ds.symbol
     WHERE ds.latest_yield_pct >= $1 AND ds.dividend_frequency = $2`,
    [3, 'monthly'],
  );

  // ── NEW (Session 81): do these ETFs actually have daily_prices going back
  // to the backtest's startDate (2026-01-14 for a 6M period)? Step 2 of the
  // backtest requires a price row ON OR BEFORE startDate to compute a return
  // — if a symbol matches the dividend filter but has no price history that
  // far back, it silently drops out at the return-calc stage instead of the
  // early matchingRows.length===0 branch, which explains the missing _debug
  // field in the real /api/backtest response.
  const priceHistoryCheck = await queryUnsafe(
    `SELECT
       s.symbol,
       MIN(dp.date)::text AS earliest_price_date,
       MAX(dp.date)::text AS latest_price_date,
       COUNT(*) FILTER (WHERE dp.date <= '2026-01-14')::int AS rows_on_or_before_startdate
     FROM stocks s
     LEFT JOIN daily_prices dp ON dp.symbol = s.symbol
     WHERE s.symbol IN ('0056', '00713', '00850', '00878', '00891', '00919', '00929')
     GROUP BY s.symbol
     ORDER BY s.symbol`,
    [],
  );

  return NextResponse.json({
    roeCheck, growthCheck, positionCheck, scopeCheck, rawRows6901,
    sectorCheck, dividendFreqCheck, stabilityScoreCheck,
    semiconductorJoinCheck, dailyPricesCoverageCheck, globalPricesFreshnessCheck,
    globalPriceHistoryDepthCheck, ordinaryStockHistoryCheck,
    semiconductorByMarketCheck, tsmcPriceCheck,
    rawDividends00919, periodEqualsYearCheck, rowsPerSymbolPerYear,
    yieldGapCheck,
    todayIngestCheck, marginOrphanSample, marginOrphanCount,
    offsetCheck,
    minimalMonthlyCheck, minimalQuarterlyCheck, exactSymbolCheck,
    fullQueryReproMonthly, sixMonthsAgo,
    priceHistoryCheck,
  });
}