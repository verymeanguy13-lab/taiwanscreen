// =============================================================================
// app/api/etf/route.ts
// GET  /api/etf               — all ETFs sorted by AUM
// GET  /api/etf?compare=0050,0056,00878 — comparison subset
// POST /api/etf               — seed popular ETFs (protected by CRON_SECRET)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

// ── Seed data ─────────────────────────────────────────────────────────────────
const ETF_SEED = [
  {
    symbol:        '0050',
    name_zh:       '元大台灣50',
    market:        'TWSE',
    sector:        '指數型ETF',
    etf_type:      'index',
    expense_ratio: 0.0043,
    dividend_freq: 'annual',
    full_name:     '元大台灣卓越50基金',
  },
  {
    symbol:        '0056',
    name_zh:       '元大高股息',
    market:        'TWSE',
    sector:        '高股息ETF',
    etf_type:      'dividend',
    expense_ratio: 0.0065,
    dividend_freq: 'quarterly',
    full_name:     '元大台灣高股息基金',
  },
  {
    symbol:        '00878',
    name_zh:       '國泰永續高股息',
    market:        'TWSE',
    sector:        '高股息ETF',
    etf_type:      'esg_dividend',
    expense_ratio: 0.0040,
    dividend_freq: 'quarterly',
    full_name:     '國泰台灣ESG永續高股息ETF基金',
  },
  {
    symbol:        '00929',
    name_zh:       '復華台灣科技優息',
    market:        'TWSE',
    sector:        '高股息ETF',
    etf_type:      'dividend',
    expense_ratio: 0.0045,
    dividend_freq: 'monthly',
    full_name:     '復華台灣科技優息ETF基金',
  },
  {
    symbol:        '00919',
    name_zh:       '群益台灣精選高息',
    market:        'TWSE',
    sector:        '高股息ETF',
    etf_type:      'dividend',
    expense_ratio: 0.0045,
    dividend_freq: 'monthly',
    full_name:     '群益台灣精選高息ETF基金',
  },
  {
    symbol:        '006208',
    name_zh:       '富邦台灣50',
    market:        'TWSE',
    sector:        '指數型ETF',
    etf_type:      'index',
    expense_ratio: 0.0023,
    dividend_freq: 'annual',
    full_name:     '富邦台灣採樣50基金',
  },
  {
    symbol:        '00713',
    name_zh:       '元大台灣高息低波',
    market:        'TWSE',
    sector:        '高股息ETF',
    etf_type:      'dividend',
    expense_ratio: 0.0045,
    dividend_freq: 'quarterly',
    full_name:     '元大台灣高息低波動ETF基金',
  },
];

// ── Base SELECT used for both list and compare ────────────────────────────────
const BASE_SELECT = `
  SELECT
    e.symbol,
    e.full_name,
    e.etf_type,
    e.expense_ratio,
    e.aum,
    e.dividend_freq,
    e.inception_date,
    e.description_zh,
    s.name_zh,
    dp.close,
    dp.change_pct,
    ds.latest_yield_pct,
    ds.consecutive_years,
    ds.dividend_frequency,
    ds.next_ex_date,
    ds.last_cash_dividend
  FROM etfs e
  JOIN stocks s ON e.symbol = s.symbol
  LEFT JOIN daily_prices dp
    ON e.symbol = dp.symbol
    AND dp.date = (SELECT MAX(date) FROM daily_prices)
  LEFT JOIN dividend_summary ds ON e.symbol = ds.symbol
`;

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const compareParam = searchParams.get('compare');

  const cacheKey = compareParam
    ? `etf:compare:${compareParam}`
    : 'etf:list';

  try {
    const data = await cached(cacheKey, 6 * 60 * 60, async () => {
      if (compareParam) {
        // Parse and sanitise symbol list
        const symbols = compareParam
          .split(',')
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
          .slice(0, 10); // cap at 10

        if (symbols.length === 0) {
          return { etfs: [], symbols: [] };
        }

        // Build $1,$2,... placeholders
        const placeholders = symbols.map((_, i) => `$${i + 1}`).join(', ');

        const etfs = await queryUnsafe(
          `${BASE_SELECT}
           WHERE e.symbol IN (${placeholders})
           ORDER BY e.aum DESC NULLS LAST`,
          symbols,
        );

        return { etfs, symbols };
      }

      // Default: all ETFs
      const etfs = await queryUnsafe(
        `${BASE_SELECT}
         ORDER BY e.aum DESC NULLS LAST`,
        [],
      );

      return { etfs };
    });

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[etf GET] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST (seed) ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Validate CRON_SECRET
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const inserted: string[] = [];
  const errors:   string[] = [];

  for (const etf of ETF_SEED) {
    try {
      // 1. Upsert into stocks
      await queryUnsafe(
        `INSERT INTO stocks (symbol, name_zh, sector, market)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (symbol) DO UPDATE
           SET name_zh = EXCLUDED.name_zh,
               sector  = EXCLUDED.sector`,
        [etf.symbol, etf.name_zh, etf.sector, etf.market],
      );

      // 2. Upsert into etfs
      await queryUnsafe(
        `INSERT INTO etfs
           (symbol, full_name, etf_type, expense_ratio, dividend_freq)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (symbol) DO UPDATE
           SET full_name     = EXCLUDED.full_name,
               etf_type      = EXCLUDED.etf_type,
               expense_ratio = EXCLUDED.expense_ratio,
               dividend_freq = EXCLUDED.dividend_freq`,
        [etf.symbol, etf.full_name, etf.etf_type, etf.expense_ratio, etf.dividend_freq],
      );

      inserted.push(etf.symbol);
    } catch (err) {
      const msg = `Failed to seed ${etf.symbol}: ${err}`;
      console.error('[etf POST seed]', msg);
      errors.push(msg);
    }
  }

  return NextResponse.json({
    success: errors.length === 0,
    inserted,
    errors,
  });
}