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

  // FIX (Session 82): previously annualDividend used a blanket ×4 for any
  // stock with dividend history (assuming quarterly), which understated
  // genuine monthly payers by ~3x (confirmed: 00929's yield was showing
  // 3.44% when its real yield is closer to ~10%) and would similarly
  // overstate true semi-annual/annual payers. Now detects real per-stock
  // frequency the same way cron/weekly does — counting distinct ex-dividend
  // dates in the trailing 365 days ending at the stock's own most recent
  // ex-date, which correctly captures one full payout cycle regardless of
  // where we are in the calendar — and picks the matching multiplier
  // (×12 monthly, ×4 quarterly, ×2 semi-annual, ×1 annual) instead of a
  // flat assumption.
  const exDateRows = await queryUnsafe<{ ex_dividend_date: string }>(
    `SELECT ex_dividend_date::text AS ex_dividend_date
     FROM dividends
     WHERE symbol = $1
       AND cash_dividend > 0
       AND ex_dividend_date IS NOT NULL
     ORDER BY ex_dividend_date DESC`,
    [symbol],
  );
  const exDatesSorted = exDateRows.map(r => r.ex_dividend_date);
  const mostRecentExDate = exDatesSorted[0] ?? null;

  let payoutsPerYear = 1;
  if (mostRecentExDate) {
    const cutoff = new Date(mostRecentExDate);
    cutoff.setUTCDate(cutoff.getUTCDate() - 365);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    payoutsPerYear = new Set(exDatesSorted.filter(d => d > cutoffStr)).size || 1;
  }
  const annualizeMultiplier =
    payoutsPerYear >= 12 ? 12
    : payoutsPerYear >= 4  ? 4
    : payoutsPerYear >= 2  ? 2
    : 1;

  // Get current stock price to compute yield
  const priceRows = await queryUnsafe<{ close: number }>(
    `SELECT close FROM daily_prices
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT 1`,
    [symbol],
  );
  const price = priceRows[0]?.close ?? null;

  // Annualize the latest payout using the real per-stock frequency detected
  // above, instead of a blanket ×4 assumption.
  const annualDividend = latest?.cash_dividend
    ? latest.cash_dividend * annualizeMultiplier
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

        // `period` must distinguish separate payout events within the same
        // year (so cron/weekly can tell a monthly payer from an annual one
        // by counting distinct periods). Previously this was set to `d.year`
        // -- the same value for every payout in a year -- which collapsed
        // all distinct events together and made every stock look like an
        // annual payer. Derive it from the ex-dividend date's month instead.
        const exDateObj = new Date(exDate);
        const periodValue = Number.isNaN(exDateObj.getTime())
          ? (d.year ?? 'annual')
          : String(exDateObj.getUTCMonth() + 1).padStart(2, '0');

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
              periodValue,
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