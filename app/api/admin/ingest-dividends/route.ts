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

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
  const limit  = 20;

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

  const results: { symbol: string; inserted: number; skipped: number; first_error?: string }[] = [];

  for (const { symbol } of stocks) {
    try {
      const dividends = await fetchDividendsForSymbol(symbol);
      if (dividends.length === 0) {
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