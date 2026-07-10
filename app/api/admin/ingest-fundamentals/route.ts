// =============================================================================
// app/api/admin/ingest-fundamentals/route.ts
// POST /api/admin/ingest-fundamentals?offset=0
// Orders by symbol (stable) rather than trading volume, so the daily
// rotation cursor doesn't skip or double-process stocks as volumes shift.
// Fetches TaiwanStockBalanceSheet for debt_ratio + ROE.
// market_cap computed from close price x shares (CapitalStock / 10).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

const FINMIND_BASE = 'https://api.finmindtrade.com/api/v4/data';

const STMT_TYPE_MAP: Record<string, string> = {
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
    const stocks = await queryUnsafe<{ symbol: string; close: number | null }>(
      `SELECT s.symbol, dp.close
       FROM stocks s
       LEFT JOIN daily_prices dp
         ON dp.symbol = s.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices)
       ORDER BY s.symbol
       LIMIT 20 OFFSET $1`,
      [offset],
    );

    console.log(`[ingest-fundamentals] offset=${offset}, processing ${stocks.length} stocks`);

    const startDate = '2024-01-01';
    let count  = 0;
    let errors = 0;
    const failed: { symbol: string; error: string }[] = [];

    await Promise.all(stocks.map(async ({ symbol, close }) => {
      try {
        const [stmtData, bsData] = await Promise.all([
          fetchFinMind('TaiwanStockFinancialStatements', symbol, startDate),
          fetchFinMind('TaiwanStockBalanceSheet', symbol, startDate),
        ]);

        // Income statement
        const periodMap: Record<string, Record<string, number>> = {};
        for (const row of stmtData) {
          const period = dateToPeriod(row.date);
          if (!periodMap[period]) periodMap[period] = {};
          const field = STMT_TYPE_MAP[row.type];
          if (field) periodMap[period][field] = row.value;
        }

        // Balance sheet
        const bsMap: Record<string, {
          totalAssets?:  number;
          liabilities?:  number;
          equity?:       number;
          capitalStock?: number;
        }> = {};
        for (const row of bsData) {
          const period = dateToPeriod(row.date);
          if (!bsMap[period]) bsMap[period] = {};
          if (row.type === 'TotalAssets')  bsMap[period].totalAssets  = row.value;
          if (row.type === 'Liabilities')  bsMap[period].liabilities  = row.value;
          if (row.type === 'Equity')       bsMap[period].equity       = row.value;
          if (row.type === 'CapitalStock') bsMap[period].capitalStock = row.value;
        }

        // market_cap from latest CapitalStock (shares x NT$10 par) x close price
        const sortedPeriods = Object.keys(bsMap).sort().reverse();
        let sharesOutstanding: number | null = null;
        for (const p of sortedPeriods) {
          if (bsMap[p].capitalStock) {
            sharesOutstanding = bsMap[p].capitalStock! / 10;
            break;
          }
        }
        // market_cap in 億 NTD
        const market_cap = (close && sharesOutstanding)
          ? Math.round(close * sharesOutstanding / 1_000_000) / 100
          : null;

        // Merge all periods
        const allPeriods = new Set([...Object.keys(periodMap), ...Object.keys(bsMap)]);

        for (const period of allPeriods) {
          const fields = periodMap[period] ?? {};
          const bs     = bsMap[period]     ?? {};

          const revenue          = fields['revenue']          ?? null;
          const net_income       = fields['net_income']       ?? null;
          const eps              = fields['eps']              ?? null;
          const gross_profit     = fields['gross_profit']     ?? null;
          const operating_income = fields['operating_income'] ?? null;

          const gross_margin = (gross_profit != null && revenue != null && revenue > 0)
            ? Math.round((gross_profit / revenue) * 10000) / 100 : null;
          const net_margin = (net_income != null && revenue != null && revenue > 0)
            ? Math.round((net_income / revenue) * 10000) / 100 : null;
          const operating_margin = (operating_income != null && revenue != null && revenue > 0)
            ? Math.round((operating_income / revenue) * 10000) / 100 : null;
          const debt_ratio = (bs.totalAssets && bs.liabilities && bs.totalAssets > 0)
            ? Math.round((bs.liabilities / bs.totalAssets) * 10000) / 100 : null;
          const roe = (net_income && bs.equity && bs.equity > 0)
            ? Math.round((net_income / bs.equity) * 10000) / 100 : null;

          await queryUnsafe(
            `INSERT INTO fundamentals
               (symbol, period, eps, revenue, net_income, gross_margin, net_margin, operating_margin, debt_ratio, roe, market_cap)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             ON CONFLICT (symbol, period) DO UPDATE
               SET eps              = COALESCE(EXCLUDED.eps,              fundamentals.eps),
                   revenue          = COALESCE(EXCLUDED.revenue,          fundamentals.revenue),
                   net_income       = COALESCE(EXCLUDED.net_income,       fundamentals.net_income),
                   gross_margin     = EXCLUDED.gross_margin,
                   net_margin       = EXCLUDED.net_margin,
                   operating_margin = EXCLUDED.operating_margin,
                   debt_ratio       = COALESCE(EXCLUDED.debt_ratio,       fundamentals.debt_ratio),
                   roe              = COALESCE(EXCLUDED.roe,              fundamentals.roe),
                   market_cap       = COALESCE(EXCLUDED.market_cap,       fundamentals.market_cap)`,
            [symbol, period, eps, revenue, net_income, gross_margin, net_margin, operating_margin, debt_ratio, roe, market_cap],
          );
          count++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[ingest-fundamentals] Failed for ${symbol}:`, message);
        errors++;
        failed.push({ symbol, error: message });
      }
    }));

    return NextResponse.json({
      ok: true, offset,
      processed: stocks.length,
      next_offset: offset + 20,
      count, errors, failed,
    });

  } catch (err) {
    console.error('[ingest-fundamentals] Fatal:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}