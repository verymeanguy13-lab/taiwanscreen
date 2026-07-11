// =============================================================================
// app/api/backtest/route.ts
// POST /api/backtest         — run backtest for filters + period
// GET  /api/backtest/presets — return hardcoded preset strategies
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import type { ScreenerFilter } from '@/types';

// Computed market cap expression (in 億 NTD) — same formula as the screener.
const MARKET_CAP_EXPR = `COALESCE(f.market_cap, (s.shares_outstanding * dp.close / 100000000.0))`;

// ── Preset strategies ─────────────────────────────────────────────────────────
export const PRESETS = [
  {
    id:          'dividend_stock',
    name_zh:     '存股族',
    description: '殖利率 ≥ 4%，連續配息 ≥ 5 年，本益比 ≤ 20',
    filters:     { yield_min: 4, consecutive_years_min: 5, pe_max: 20 } as ScreenerFilter,
  },
  {
    id:          'foreign_buy',
    name_zh:     '外資連買',
    description: '外資連買 ≥ 5 日',
    filters:     { foreign_consecutive_min: 5 } as ScreenerFilter,
  },
  {
    id:          'triple_buy',
    name_zh:     '三買訊號',
    description: '三大法人同日買進',
    filters:     { triple_buy: true } as ScreenerFilter,
  },
  {
    id:          'high_roe',
    name_zh:     '高ROE',
    description: 'ROE ≥ 20%',
    filters:     { roe_min: 20 } as ScreenerFilter,
  },
  {
    id:          'momentum',
    name_zh:     '飆股潛力',
    description: '漲幅 ≥ 5%，外資淨買超 ≥ 0',
    filters:     { change_pct_min: 5, foreign_net_min: 0 } as ScreenerFilter,
  },
  {
    id:          'low_pe',
    name_zh:     '低本益比',
    description: '本益比 1–10',
    filters:     { pe_min: 1, pe_max: 10 } as ScreenerFilter,
  },
  {
    id:          'buffett',
    name_zh:     '巴菲特選股',
    description: '本益比 ≤ 15，股價淨值比 ≤ 1.5，ROE ≥ 15%',
    filters:     { pe_max: 15, pb_max: 1.5, roe_min: 15 } as ScreenerFilter,
  },
  {
    id:          'high_growth',
    name_zh:     '高成長',
    description: 'EPS 成長 ≥ 20%，營收成長 ≥ 15%',
    filters:     { eps_growth_min: 20, revenue_growth_min: 15 } as ScreenerFilter,
  },
  // ── New presets — added to match the screener's quick-filter list ──────────
  {
    id:          'monthly_income',
    name_zh:     '月月領息',
    description: '月配息且殖利率 ≥ 3%',
    filters:     { dividend_freq: 'monthly', yield_min: 3 } as ScreenerFilter,
  },
  {
    id:          'foreign_trust_double',
    name_zh:     '外資投信雙買',
    description: '外資投信同步買超',
    filters:     { foreign_net_min: 100, trust_net_min: 50 } as ScreenerFilter,
  },
  {
    id:          'semiconductor',
    name_zh:     '半導體族群',
    description: '半導體產業所有股票',
    filters:     { sector: ['半導體業'] } as ScreenerFilter,
  },
  {
    id:          'high_gross_margin',
    name_zh:     '高毛利率',
    description: '毛利率 ≥ 40%，ROE ≥ 15%',
    filters:     { gross_margin_min: 40, roe_min: 15 } as ScreenerFilter,
  },
  {
    id:          'stable_dividend',
    name_zh:     '配息穩定',
    description: '配息穩定分數 ≥ 80，殖利率 ≥ 3%',
    filters:     { stability_score_min: 80, yield_min: 3 } as ScreenerFilter,
  },
  {
    id:          'small_cap_growth',
    name_zh:     '小型成長股',
    description: '市值 ≤ 50億，營收成長 ≥ 15%，ROE ≥ 12%',
    filters:     { market_cap_max: 50, revenue_growth_min: 15, roe_min: 12 } as ScreenerFilter,
  },
  {
    id:          'large_cap_quality',
    name_zh:     '大型優質股',
    description: '市值 ≥ 1000億，ROE ≥ 15%，負債比 ≤ 35%',
    filters:     { market_cap_min: 1000, roe_min: 15, debt_ratio_max: 35 } as ScreenerFilter,
  },
  {
    id:          'quarterly_dividend',
    name_zh:     '季配息',
    description: '季配息且殖利率 ≥ 4%',
    filters:     { dividend_freq: 'quarterly', yield_min: 4 } as ScreenerFilter,
  },
  {
    id:          'low_debt_high_yield',
    name_zh:     '低負債高息',
    description: '負債比 ≤ 30%，殖利率 ≥ 4%',
    filters:     { debt_ratio_max: 30, yield_min: 4 } as ScreenerFilter,
  },
  {
    id:          'big_foreign_buy',
    name_zh:     '外資大買超',
    description: '外資單日大量買超',
    filters:     { foreign_net_min: 1000, volume_min: 500 } as ScreenerFilter,
  },
];

// ── Period → days ─────────────────────────────────────────────────────────────
const PERIOD_DAYS: Record<string, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

// ── Build WHERE clause from filters ──────────────────────────────────────────
function buildWhere(
  filters: ScreenerFilter,
  startDate: string,
): { conditions: string[]; params: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const add = (sql: string, val: unknown) => {
    conditions.push(sql.replace('?', `$${idx++}`));
    params.push(val);
  };

  // Use startDate for all date joins
  conditions.push(`dp.date = (SELECT MAX(date) FROM daily_prices WHERE date <= $${idx++})`);
  params.push(startDate);
  conditions.push(`i.date  = (SELECT MAX(date) FROM institutional_flows WHERE date <= $${idx++})`);
  params.push(startDate);

  if (filters.pe_min)              add('f.pe_ratio >= ?',            filters.pe_min);
  if (filters.pe_max)              add('f.pe_ratio <= ?',            filters.pe_max);
  if (filters.pb_min)              add('f.pb_ratio >= ?',            filters.pb_min);
  if (filters.pb_max)              add('f.pb_ratio <= ?',            filters.pb_max);
  if (filters.roe_min)             add('f.roe >= ?',                 filters.roe_min);
  if (filters.gross_margin_min)    add('f.gross_margin >= ?',        filters.gross_margin_min);
  if (filters.debt_ratio_max)      add('f.debt_ratio <= ?',          filters.debt_ratio_max);
  if (filters.eps_growth_min)      add('f.eps_growth_yoy >= ?',      filters.eps_growth_min);
  if (filters.revenue_growth_min)  add('f.revenue_growth_yoy >= ?',  filters.revenue_growth_min);
  if (filters.price_min)           add('dp.close >= ?',              filters.price_min);
  if (filters.price_max)           add('dp.close <= ?',              filters.price_max);
  if (filters.change_pct_min)      add('dp.change_pct >= ?',         filters.change_pct_min);
  if (filters.volume_min)          add('dp.volume >= ?',             filters.volume_min);
  if (filters.foreign_net_min)     add('i.foreign_net >= ?',         filters.foreign_net_min);
  if (filters.trust_net_min)       add('i.trust_net >= ?',           filters.trust_net_min);
  if (filters.foreign_consecutive_min) add('i.foreign_consecutive_days >= ?', filters.foreign_consecutive_min);
  if (filters.triple_buy === true) add('i.triple_buy = ?',           true);
  if (filters.yield_min)           add('ds.latest_yield_pct >= ?',   filters.yield_min);
  if (filters.yield_max)           add('ds.latest_yield_pct <= ?',   filters.yield_max);
  if (filters.consecutive_years_min) add('ds.consecutive_years >= ?', filters.consecutive_years_min);
  if (filters.stability_score_min) add('ds.stability_score >= ?',    filters.stability_score_min);
  if (filters.dividend_freq)       add('ds.dividend_frequency = ?',  filters.dividend_freq);
  if (filters.market_cap_min)      add(`${MARKET_CAP_EXPR} >= ?`,    filters.market_cap_min);
  if (filters.market_cap_max)      add(`${MARKET_CAP_EXPR} <= ?`,    filters.market_cap_max);
  if (filters.sector && filters.sector.length > 0) add('s.sector = ANY(?::text[])', filters.sector);
  if (filters.market && filters.market !== 'all') add('s.market = ?', filters.market);

  return { conditions, params, nextIdx: idx };
}

// ── POST /api/backtest ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filters, period } = body as { filters: ScreenerFilter; period: string };

    if (!filters || !period || !PERIOD_DAYS[period]) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const days = PERIOD_DAYS[period];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    // ── Step 1: Find matching stocks AS OF start date ─────────────────────
    const { conditions, params } = buildWhere(filters, startDate);
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // NOTE: previously had a bare `LIMIT 200` here with no ORDER BY, which
    // silently discarded real matches in arbitrary/undefined order once
    // more than 200 stocks qualified (confirmed: 高ROE had 1,739 true
    // matches, 高成長 had 242 — both were being cut down to 200 arbitrarily).
    // Removed — the downstream query already processes the whole symbol
    // list in one bulk call, so there's no performance reason to cap here.
    const matchingRows = await queryUnsafe<{ symbol: string; name_zh: string }>(
      `SELECT s.symbol, s.name_zh
       FROM stocks s
       LEFT JOIN daily_prices dp ON s.symbol = dp.symbol
       LEFT JOIN LATERAL (
         SELECT
           (SELECT pe_ratio           FROM fundamentals WHERE symbol = s.symbol AND pe_ratio           IS NOT NULL ORDER BY period DESC LIMIT 1) AS pe_ratio,
           (SELECT pb_ratio           FROM fundamentals WHERE symbol = s.symbol AND pb_ratio           IS NOT NULL ORDER BY period DESC LIMIT 1) AS pb_ratio,
           (SELECT roe                FROM fundamentals WHERE symbol = s.symbol AND roe                IS NOT NULL ORDER BY period DESC LIMIT 1) AS roe,
           (SELECT gross_margin       FROM fundamentals WHERE symbol = s.symbol AND gross_margin       IS NOT NULL ORDER BY period DESC LIMIT 1) AS gross_margin,
           (SELECT debt_ratio         FROM fundamentals WHERE symbol = s.symbol AND debt_ratio         IS NOT NULL ORDER BY period DESC LIMIT 1) AS debt_ratio,
           (SELECT eps_growth_yoy     FROM fundamentals WHERE symbol = s.symbol AND eps_growth_yoy     IS NOT NULL ORDER BY period DESC LIMIT 1) AS eps_growth_yoy,
           (SELECT revenue_growth_yoy FROM fundamentals WHERE symbol = s.symbol AND revenue_growth_yoy IS NOT NULL ORDER BY period DESC LIMIT 1) AS revenue_growth_yoy,
           (SELECT market_cap         FROM fundamentals WHERE symbol = s.symbol AND market_cap         IS NOT NULL ORDER BY period DESC LIMIT 1) AS market_cap
       ) f ON true
       LEFT JOIN institutional_flows i ON s.symbol = i.symbol
       LEFT JOIN dividend_summary ds ON s.symbol = ds.symbol
       ${whereClause}`,
      params,
    );

    if (matchingRows.length === 0) {
      return NextResponse.json({
        data: {
          period, startDate,
          sample_count: 0, win_rate: 0, avg_return: 0,
          results: [], top5: [], bottom5: [],
        },
      });
    }

    const symbols = matchingRows.map(r => r.symbol);
    const nameMap = new Map(matchingRows.map(r => [r.symbol, r.name_zh]));

    // ── Step 2: Compute return for each matching stock ────────────────────
    // Find closest available start price and today's price.
    // NOTE: this is a fresh queryUnsafe() call, so its placeholders start
    // over at $1 — they do NOT continue from the previous query's indices.
    const returnRows = await queryUnsafe<{
      symbol:       string;
      start_close:  string | null;
      end_close:    string | null;
      return_pct:   string | null;
    }>(
      `SELECT
         dp_start.symbol,
         dp_start.close  AS start_close,
         dp_end.close    AS end_close,
         CASE
           WHEN dp_start.close > 0
           THEN ROUND(
             ((dp_end.close - dp_start.close)::numeric / dp_start.close * 100),
             2
           )
           ELSE NULL
         END AS return_pct
       FROM daily_prices dp_start
       JOIN daily_prices dp_end
         ON dp_start.symbol = dp_end.symbol
         AND dp_end.date = (SELECT MAX(date) FROM daily_prices)
       WHERE dp_start.symbol = ANY($1)
         AND dp_start.date = (
           SELECT MAX(date)
           FROM daily_prices
           WHERE symbol = dp_start.symbol
             AND date <= $2
         )`,
      [symbols, startDate],
    );

    // ── Step 3: Compute stats ─────────────────────────────────────────────
    const results = returnRows
      .filter(r => r.return_pct != null)
      .map(r => ({
        symbol:      r.symbol,
        name_zh:     nameMap.get(r.symbol) ?? r.symbol,
        start_close: parseFloat(r.start_close ?? '0'),
        end_close:   parseFloat(r.end_close   ?? '0'),
        return_pct:  parseFloat(r.return_pct  ?? '0'),
      }))
      .sort((a, b) => b.return_pct - a.return_pct);

    const sample_count = results.length;
    const winners      = results.filter(r => r.return_pct > 0).length;
    const win_rate     = sample_count > 0 ? Math.round((winners / sample_count) * 100) : 0;
    const avg_return   = sample_count > 0
      ? Math.round((results.reduce((s, r) => s + r.return_pct, 0) / sample_count) * 100) / 100
      : 0;

    const top5    = results.slice(0, 5);
    const bottom5 = [...results].reverse().slice(0, 5);

    return NextResponse.json({
      data: { period, startDate, sample_count, win_rate, avg_return, results, top5, bottom5 },
    });
  } catch (err) {
    console.error('[backtest POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── GET /api/backtest — expose presets ────────────────────────────────────────
export async function GET() {
  return NextResponse.json({ data: PRESETS });
}