// =============================================================================
// app/api/screener/route.ts
// GET /api/screener?pe_max=20&roe_min=15&sort_by=roe&sort_dir=desc&page=1
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import type { ScreenerRow, PaginatedResponse } from '@/types';

// Whitelisted sort columns — prevents SQL injection via sort_by param
const ALLOWED_SORT = new Set([
  'close',
  'change_pct',
  'volume',
  'pe_ratio',
  'pb_ratio',
  'roe',
  'foreign_net',
  'trust_net',
  'latest_yield_pct',
  'market_cap',
]);

// Base SELECT + JOINs — latest date per table via subquery
const BASE_QUERY = `
  SELECT
    s.symbol,
    s.name_zh,
    s.sector,
    s.market,
    dp.close,
    dp.change_pct,
    dp.volume,
    f.pe_ratio,
    f.pb_ratio,
    f.roe,
    f.gross_margin,
    f.revenue_growth_yoy,
    f.eps_growth_yoy,
    f.debt_ratio,
    f.market_cap,
    i.foreign_net,
    i.trust_net,
    i.total_net,
    i.foreign_consecutive_days,
    i.triple_buy,
    m.margin_balance,
    m.margin_change,
    ds.latest_yield_pct,
    ds.consecutive_years
  FROM stocks s
  LEFT JOIN daily_prices dp
    ON s.symbol = dp.symbol
    AND dp.date = (SELECT MAX(date) FROM daily_prices)
  LEFT JOIN fundamentals f
    ON s.symbol = f.symbol
    AND f.period = (
      SELECT MAX(period) FROM fundamentals WHERE symbol = s.symbol
    )
  LEFT JOIN institutional_flows i
    ON s.symbol = i.symbol
    AND i.date = (SELECT MAX(date) FROM institutional_flows)
  LEFT JOIN margin_data m
    ON s.symbol = m.symbol
    AND m.date = (SELECT MAX(date) FROM margin_data)
  LEFT JOIN dividend_summary ds
    ON s.symbol = ds.symbol
`;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // ── Parse all filter params ──────────────────────────────────────────────
  const p = {
    pe_min:                  searchParams.get('pe_min'),
    pe_max:                  searchParams.get('pe_max'),
    pb_min:                  searchParams.get('pb_min'),
    pb_max:                  searchParams.get('pb_max'),
    roe_min:                 searchParams.get('roe_min'),
    gross_margin_min:        searchParams.get('gross_margin_min'),
    debt_ratio_max:          searchParams.get('debt_ratio_max'),
    revenue_growth_min:      searchParams.get('revenue_growth_min'),
    eps_growth_min:          searchParams.get('eps_growth_min'),
    market_cap_min:          searchParams.get('market_cap_min'),
    market_cap_max:          searchParams.get('market_cap_max'),
    price_min:               searchParams.get('price_min'),
    price_max:               searchParams.get('price_max'),
    volume_min:              searchParams.get('volume_min'),
    change_pct_min:          searchParams.get('change_pct_min'),
    change_pct_max:          searchParams.get('change_pct_max'),
    foreign_net_min:         searchParams.get('foreign_net_min'),
    trust_net_min:           searchParams.get('trust_net_min'),
    foreign_consecutive_min: searchParams.get('foreign_consecutive_min'),
    trust_consecutive_min:   searchParams.get('trust_consecutive_min'),
    triple_buy:              searchParams.get('triple_buy'),
    yield_min:               searchParams.get('yield_min'),
    yield_max:               searchParams.get('yield_max'),
    consecutive_years_min:   searchParams.get('consecutive_years_min'),
    sector:                  searchParams.get('sector'),
    market:                  searchParams.get('market'),
    sort_by:                 searchParams.get('sort_by'),
    sort_dir:                searchParams.get('sort_dir'),
    page:                    searchParams.get('page'),
    per_page:                searchParams.get('per_page'),
  };

  // Cache key includes all params for correct cache isolation
  const cacheKey = 'screener:' + JSON.stringify(p);

  try {
    const result = await cached<PaginatedResponse<ScreenerRow>>(
      cacheKey,
      15 * 60, // 15-minute TTL
      async () => {
        // ── Build WHERE conditions ─────────────────────────────────────────
        const conditions: string[] = [];
        const params: unknown[] = [];

        let idx = 1; // PostgreSQL $1, $2, ... parameter index

        const addCondition = (sql: string, value: unknown) => {
          conditions.push(sql.replace('?', `$${idx++}`));
          params.push(value);
        };

        // Valuation
        if (p.pe_min)           addCondition('f.pe_ratio >= ?',            parseFloat(p.pe_min));
        if (p.pe_max)           addCondition('f.pe_ratio <= ?',            parseFloat(p.pe_max));
        if (p.pb_min)           addCondition('f.pb_ratio >= ?',            parseFloat(p.pb_min));
        if (p.pb_max)           addCondition('f.pb_ratio <= ?',            parseFloat(p.pb_max));

        // Profitability
        if (p.roe_min)          addCondition('f.roe >= ?',                 parseFloat(p.roe_min));
        if (p.gross_margin_min) addCondition('f.gross_margin >= ?',        parseFloat(p.gross_margin_min));
        if (p.debt_ratio_max)   addCondition('f.debt_ratio <= ?',          parseFloat(p.debt_ratio_max));

        // Growth
        if (p.revenue_growth_min) addCondition('f.revenue_growth_yoy >= ?', parseFloat(p.revenue_growth_min));
        if (p.eps_growth_min)     addCondition('f.eps_growth_yoy >= ?',     parseFloat(p.eps_growth_min));

        // Market cap
        if (p.market_cap_min)   addCondition('f.market_cap >= ?',          parseInt(p.market_cap_min, 10));
        if (p.market_cap_max)   addCondition('f.market_cap <= ?',          parseInt(p.market_cap_max, 10));

        // Price
        if (p.price_min)        addCondition('dp.close >= ?',              parseFloat(p.price_min));
        if (p.price_max)        addCondition('dp.close <= ?',              parseFloat(p.price_max));

        // Volume
        if (p.volume_min)       addCondition('dp.volume >= ?',             parseInt(p.volume_min, 10));

        // Price change
        if (p.change_pct_min)   addCondition('dp.change_pct >= ?',        parseFloat(p.change_pct_min));
        if (p.change_pct_max)   addCondition('dp.change_pct <= ?',        parseFloat(p.change_pct_max));

        // Institutional flows
        if (p.foreign_net_min)  addCondition('i.foreign_net >= ?',         parseInt(p.foreign_net_min, 10));
        if (p.trust_net_min)    addCondition('i.trust_net >= ?',            parseInt(p.trust_net_min, 10));

        // Consecutive days
        if (p.foreign_consecutive_min)
          addCondition('i.foreign_consecutive_days >= ?', parseInt(p.foreign_consecutive_min, 10));
        if (p.trust_consecutive_min)
          addCondition('i.trust_consecutive_days >= ?',   parseInt(p.trust_consecutive_min, 10));

        // Triple buy flag
        if (p.triple_buy === 'true')  addCondition('i.triple_buy = ?', true);
        if (p.triple_buy === 'false') addCondition('i.triple_buy = ?', false);

        // Dividends
        if (p.yield_min)             addCondition('ds.latest_yield_pct >= ?',  parseFloat(p.yield_min));
        if (p.yield_max)             addCondition('ds.latest_yield_pct <= ?',  parseFloat(p.yield_max));
        if (p.consecutive_years_min) addCondition('ds.consecutive_years >= ?', parseInt(p.consecutive_years_min, 10));

        // Sector (comma-separated → IN clause)
        if (p.sector) {
          const sectors = p.sector.split(',').map(s => s.trim()).filter(Boolean);
          if (sectors.length > 0) {
            const placeholders = sectors.map(() => `$${idx++}`).join(', ');
            conditions.push(`s.sector IN (${placeholders})`);
            params.push(...sectors);
          }
        }

        // Market
        if (p.market && p.market !== 'all') {
          addCondition('s.market = ?', p.market);
        }

        // ── Assemble WHERE clause ──────────────────────────────────────────
        const whereClause = conditions.length > 0
          ? 'WHERE ' + conditions.join(' AND ')
          : '';

        // ── Sort ───────────────────────────────────────────────────────────
        const sortBy  = ALLOWED_SORT.has(p.sort_by ?? '') ? p.sort_by! : 'change_pct';
        const sortDir = p.sort_dir === 'asc' ? 'ASC' : 'DESC';

        // Map sort column to its table alias
        const SORT_ALIAS: Record<string, string> = {
          close:            'dp.close',
          change_pct:       'dp.change_pct',
          volume:           'dp.volume',
          pe_ratio:         'f.pe_ratio',
          pb_ratio:         'f.pb_ratio',
          roe:              'f.roe',
          foreign_net:      'i.foreign_net',
          trust_net:        'i.trust_net',
          latest_yield_pct: 'ds.latest_yield_pct',
          market_cap:       'f.market_cap',
        };
        const orderExpr = `${SORT_ALIAS[sortBy]} ${sortDir} NULLS LAST`;

        // ── Pagination ─────────────────────────────────────────────────────
        const page     = Math.max(1, parseInt(p.page     ?? '1',  10));
        const per_page = Math.min(200, Math.max(1, parseInt(p.per_page ?? '50', 10)));
        const offset   = (page - 1) * per_page;

        // ── COUNT query (same WHERE, no LIMIT) ────────────────────────────
        const countSQL = `
          SELECT COUNT(*) AS total
          FROM stocks s
          LEFT JOIN daily_prices dp
            ON s.symbol = dp.symbol
            AND dp.date = (SELECT MAX(date) FROM daily_prices)
          LEFT JOIN fundamentals f
            ON s.symbol = f.symbol
            AND f.period = (
              SELECT MAX(period) FROM fundamentals WHERE symbol = s.symbol
            )
          LEFT JOIN institutional_flows i
            ON s.symbol = i.symbol
            AND i.date = (SELECT MAX(date) FROM institutional_flows)
          LEFT JOIN margin_data m
            ON s.symbol = m.symbol
            AND m.date = (SELECT MAX(date) FROM margin_data)
          LEFT JOIN dividend_summary ds
            ON s.symbol = ds.symbol
          ${whereClause}
        `;

        const countRows = await queryUnsafe<{ total: string }>(countSQL, params);
        const total = parseInt(countRows[0]?.total ?? '0', 10);

        // ── Data query ─────────────────────────────────────────────────────
        const limitIdx  = idx++;
        const offsetIdx = idx++;

        const dataSQL = `
          ${BASE_QUERY}
          ${whereClause}
          ORDER BY ${orderExpr}
          LIMIT $${limitIdx} OFFSET $${offsetIdx}
        `;

        const rows = await queryUnsafe<ScreenerRow>(dataSQL, [
          ...params,
          per_page,
          offset,
        ]);

        return { data: rows, total, page, per_page };
      },
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error('[screener] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}