// =============================================================================
// app/api/admin/ingest-dividends/route.ts
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';
const FINMIND_TOKEN = process.env.FINMIND_TOKEN ?? '';
const START_DATE = '2015-01-01';

interface FinMindDividend {
  date:                        string;
  stock_id:                    string;
  year:                        string;
  CashEarningsDistribution:    number;
  StockEarningsDistribution:   number;
  CashStatutorySurplus:        number;
  StockStatutorySurplus:       number;
  CashExDividendTradingDate:   string;
  StockExDividendTradingDate:  string;
  CashDividendPaymentDate:     string;
}

async function fetchDividendsForSymbol(symbol: string): Promise<FinMindDividend[]> {
  const url = `${FINMIND_BASE}?dataset=TaiwanStockDividend&data_id=${symbol}&start_date=${START_DATE}&token=${FINMIND_TOKEN}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`FinMind HTTP ${res.status} for ${symbol}`);
  const json = await res.json();
  if (!json.data || json.data.length === 0) return [];
  return json.data as FinMindDividend[];
}

// -----------------------------------------------------------------------------
// Recalculate dividend_summary for a single symbol from the dividends table.
// consecutive_years = number of distinct calendar years with at least one
//                     cash dividend, counting back from the most recent year
//                     without any gaps.
// -----------------------------------------------------------------------------
async function refreshDividendSummary(symbol: string): Promise<void> {
  // Get all distinct years that had a cash dividend, newest first
  const yearRows = await queryUnsafe<{ yr: number }>(
    `SELECT DISTINCT EXTRACT(YEAR FROM ex_dividend_date)::int AS yr
     FROM dividends
     WHERE symbol = $1
       AND cash_dividend > 0
       AND ex_dividend_date IS NOT NULL
     ORDER BY yr DESC`,
    [symbol],
  );

  // Count consecutive years with no gap
  let consecutiveYears = 0;
  for (let i = 0; i < yearRows.length; i++) {
    const expected = yearRows[0].yr - i;
    if (yearRows[i].yr === expected) {
      consecutiveYears++;
    } else {
      break; // gap found — stop counting
    }
  }

  // Get the most recent cash dividend amount and ex-date
  const latestRows = await queryUnsafe<{
    cash_dividend:   number;
    ex_dividend_date: string;
  }>(
    `SELECT cash_dividend, ex_dividend_date
     FROM dividends
     WHERE symbol = $1
       AND cash_dividend > 0
       AND ex_dividend_date IS NOT NULL
     ORDER BY ex_dividend_date DESC
     LIMIT 1`,
    [symbol],
  );

  const latest = latestRows[0];

  // Get current stock price to compute yield
  const priceRows = await queryUnsafe<{ close: number }>(
    `SELECT close FROM daily_prices
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT 1`,
    [symbol],
  );
  const price = priceRows[0]?.close ?? null;

  // Annualise the latest quarterly dividend (×4) to estimate yield
  // If annual dividend already, use as-is (heuristic: if > 3 dividends/year, it's quarterly)
  const annualDividend = latest?.cash_dividend
    ? latest.cash_dividend * (consecutiveYears > 0 && yearRows.length > 0 ? 4 : 1)
    : null;

  const yieldPct =
    annualDividend && price && price > 0
      ? Math.round((annualDividend / price) * 10000) / 100
      : null;

  const nextExDate = latest?.ex_dividend_date ?? null;
  const lastCashDividend = latest?.cash_dividend ?? null;

  // Upsert into dividend_summary
  await queryUnsafe(
    `INSERT INTO dividend_summary
       (symbol, consecutive_years, latest_yield_pct, next_ex_date, last_cash_dividend)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (symbol) DO UPDATE SET
       consecutive_years  = EXCLUDED.consecutive_years,
       latest_yield_pct   = EXCLUDED.latest_yield_pct,
       next_ex_date       = EXCLUDED.next_ex_date,
       last_cash_dividend = EXCLUDED.last_cash_dividend`,
    [symbol, consecutiveYears, yieldPct, nextExDate, lastCashDividend],
  );
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
  const limit  = 20;

  // Sorted by symbol (stable) rather than trading volume (which fluctuates
  // day to day) — this keeps each day's batch predictable so the rotation
  // cursor in cron/daily doesn't skip or double-process stocks.
  const stocks = await queryUnsafe<{ symbol: string }>(
    `SELECT s.symbol
     FROM stocks s
     JOIN daily_prices dp ON dp.symbol = s.symbol
     WHERE dp.date >= NOW() - INTERVAL '30 days'
     GROUP BY s.symbol
     ORDER BY s.symbol
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  if (stocks.length === 0) {
    return NextResponse.json({ message: 'No stocks found at this offset', offset });
  }

  const results: { symbol: string; inserted: number; skipped: number; first_error?: string }[] = [];

  for (const { symbol } of stocks) {
    try {
      const dividends = await fetchDividendsForSymbol(symbol);
      if (dividends.length === 0) {
        // Still refresh summary in case dividends table already has data
        await refreshDividendSummary(symbol);
        results.push({ symbol, inserted: 0, skipped: 0 });
        continue;
      }

      let inserted = 0;
      let skipped  = 0;
      let firstError: string | undefined;

      for (const d of dividends) {
        const cashDiv  = (d.CashEarningsDistribution  ?? 0) + (d.CashStatutorySurplus  ?? 0);
        const stockDiv = (d.StockEarningsDistribution ?? 0) + (d.StockStatutorySurplus ?? 0);

        if (cashDiv === 0 && stockDiv === 0) { skipped++; continue; }

        const exDate = d.CashExDividendTradingDate || d.StockExDividendTradingDate || d.date;
        if (!exDate) { skipped++; continue; }

        const payDate = d.CashDividendPaymentDate || null;

        try {
          await queryUnsafe(
            `INSERT INTO dividends (
               symbol, ex_dividend_date, period, year,
               cash_dividend, stock_dividend, payment_date
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (symbol, ex_dividend_date) DO UPDATE SET
               period         = EXCLUDED.period,
               year           = EXCLUDED.year,
               cash_dividend  = EXCLUDED.cash_dividend,
               stock_dividend = EXCLUDED.stock_dividend,
               payment_date   = EXCLUDED.payment_date`,
            [
              symbol,
              exDate,
              d.year ?? 'annual',
              d.year ?? '',
              cashDiv,
              stockDiv,
              payDate,
            ],
          );
          inserted++;
        } catch (rowErr) {
          skipped++;
          if (!firstError) firstError = String(rowErr);
        }
      }

      // ── Recalculate dividend_summary from actual dividends table ──────────
      await refreshDividendSummary(symbol);

      results.push({ symbol, inserted, skipped, first_error: firstError });
    } catch (err) {
      results.push({ symbol, inserted: 0, skipped: 0, first_error: String(err) });
    }
  }

  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);

  return NextResponse.json({
    offset,
    stocks_processed: stocks.length,
    total_inserted:   totalInserted,
    next_offset:      offset + limit,
    results,
  });
}