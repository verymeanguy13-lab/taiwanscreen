// =============================================================================
// app/api/admin/ingest-dividends/route.ts
// POST /api/admin/ingest-dividends?offset=N
// Fixed field names to match actual FinMind TaiwanStockDividend response
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

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Params ──────────────────────────────────────────────────────────────────
  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
  const limit  = 20;

  // ── Fetch top stocks by volume ───────────────────────────────────────────────
  const stocks = await queryUnsafe<{ symbol: string }>(
    `SELECT s.symbol
     FROM stocks s
     JOIN daily_prices dp ON dp.symbol = s.symbol
     WHERE dp.date >= NOW() - INTERVAL '30 days'
     GROUP BY s.symbol
     ORDER BY AVG(dp.volume) DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  if (stocks.length === 0) {
    return NextResponse.json({ message: 'No stocks found at this offset', offset });
  }

  // ── Ingest dividends for each stock ─────────────────────────────────────────
  const results: { symbol: string; inserted: number; error?: string }[] = [];

  for (const { symbol } of stocks) {
    try {
      const dividends = await fetchDividendsForSymbol(symbol);
      if (dividends.length === 0) {
        results.push({ symbol, inserted: 0 });
        continue;
      }

      let inserted = 0;
      for (const d of dividends) {
        const cashDiv   = (d.CashEarningsDistribution  ?? 0) + (d.CashStatutorySurplus  ?? 0);
        const stockDiv  = (d.StockEarningsDistribution ?? 0) + (d.StockStatutorySurplus ?? 0);

        // Skip rows with no dividend at all
        if (cashDiv === 0 && stockDiv === 0) continue;

        // Use ex-dividend date if available, otherwise fall back to announcement date
        const exDate = d.CashExDividendTradingDate || d.StockExDividendTradingDate || d.date;
        if (!exDate) continue;

        try {
          await queryUnsafe(
            `INSERT INTO dividends (
               symbol, ex_date, period,
               cash_dividend, stock_dividend, cash_tax,
               total_dividend
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (symbol, ex_date) DO UPDATE SET
               period         = EXCLUDED.period,
               cash_dividend  = EXCLUDED.cash_dividend,
               stock_dividend = EXCLUDED.stock_dividend,
               total_dividend = EXCLUDED.total_dividend`,
            [
              symbol,
              exDate,
              d.year ?? 'annual',
              cashDiv,
              stockDiv,
              0,
              cashDiv + stockDiv,
            ],
          );
          inserted++;
        } catch {
          // skip row-level errors
        }
      }

      results.push({ symbol, inserted });
    } catch (err) {
      results.push({ symbol, inserted: 0, error: String(err) });
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
  const errors = results.filter(r => r.error);

  return NextResponse.json({
    offset,
    stocks_processed: stocks.length,
    total_inserted:   totalInserted,
    next_offset:      offset + limit,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
}