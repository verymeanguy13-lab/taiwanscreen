// =============================================================================
// app/api/admin/ingest-fundamentals/route.ts
// POST /api/admin/ingest-fundamentals?offset=0
// Orders by trading volume DESC so biggest stocks are processed first.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';

const TYPE_MAP: Record<string, string> = {
  'Revenue':          'revenue',
  'GrossProfit':      'gross_profit',
  'OperatingIncome':  'operating_income',
  'IncomeAfterTaxes': 'net_income',
  'EPS':              'eps',
};

async function fetchFinMind(dataset: string, stockId: string, startDate: string) {
  const token = process.env.FINMIND_TOKEN ?? '';
  const url = `${FINMIND_BASE}?dataset=${dataset}&data_id=${stockId}&start_date=${startDate}&token=${token}`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return json.status === 200 ? json.data : [];
  } catch {
    return [];
  }
}

function dateToPeriod(date: string): string {
  const d = new Date(date);
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}Q${q}`;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  try {
    // Order by latest trading volume DESC — biggest stocks first
    const stocks = await queryUnsafe<{ symbol: string }>(
      `SELECT s.symbol
       FROM stocks s
       LEFT JOIN daily_prices dp
         ON dp.symbol = s.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices)
       ORDER BY dp.volume DESC NULLS LAST
       LIMIT 20 OFFSET $1`,
      [offset],
    );

    console.log(`[ingest-fundamentals] offset=${offset}, processing ${stocks.length} stocks by volume`);

    const startDate = '2024-01-01';
    let count  = 0;
    let errors = 0;

    await Promise.all(stocks.map(async ({ symbol }) => {
      try {
        const stmtData = await fetchFinMind('TaiwanStockFinancialStatements', symbol, startDate);
        if (stmtData.length === 0) return;

        const periodMap: Record<string, Record<string, number>> = {};
        for (const row of stmtData) {
          const period = dateToPeriod(row.date);
          if (!periodMap[period]) periodMap[period] = {};
          const field = TYPE_MAP[row.type];
          if (field) periodMap[period][field] = row.value;
        }

        for (const [period, fields] of Object.entries(periodMap)) {
          const revenue      = fields['revenue']      ?? null;
          const net_income   = fields['net_income']   ?? null;
          const eps          = fields['eps']          ?? null;
          const gross_profit = fields['gross_profit'] ?? null;

          const gross_margin = (revenue && gross_profit && revenue !== 0)
            ? Math.round((gross_profit / revenue) * 10000) / 100 : null;
          const net_margin = (revenue && net_income && revenue !== 0)
            ? Math.round((net_income / revenue) * 10000) / 100 : null;

          await queryUnsafe(
            `INSERT INTO fundamentals
               (symbol, period, eps, revenue, net_income, gross_margin, net_margin)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (symbol, period) DO UPDATE
               SET eps          = COALESCE(EXCLUDED.eps,          fundamentals.eps),
                   revenue      = COALESCE(EXCLUDED.revenue,      fundamentals.revenue),
                   net_income   = COALESCE(EXCLUDED.net_income,   fundamentals.net_income),
                   gross_margin = COALESCE(EXCLUDED.gross_margin, fundamentals.gross_margin),
                   net_margin   = COALESCE(EXCLUDED.net_margin,   fundamentals.net_margin)`,
            [symbol, period, eps, revenue, net_income, gross_margin, net_margin],
          );
          count++;
        }
      } catch (err) {
        console.error(`[ingest-fundamentals] Failed for ${symbol}:`, err);
        errors++;
      }
    }));

    return NextResponse.json({
      ok: true, offset,
      processed: stocks.length,
      next_offset: offset + 20,
      count, errors,
    });

  } catch (err) {
    console.error('[ingest-fundamentals] Fatal:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}