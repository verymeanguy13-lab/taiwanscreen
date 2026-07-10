// =============================================================================
// app/api/screener/route.ts
// GET /api/screener?price_min=10&pe_ratio_max=20&sort_by=change_pct&page=1
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

const ALLOWED_SORT = new Set([
  'change_pct', 'close', 'volume', 'market_cap',
  'pe_ratio', 'pb_ratio', 'dividend_yield',
  'margin_change', 'foreign_net',
]);

// Computed market cap expression (in 億 NTD)
const MARKET_CAP_EXPR = `COALESCE(f.market_cap, (s.shares_outstanding * dp.close / 100000000.0))`;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const page     = Math.max(1, parseInt(p.get('page')     ?? '1',  10));
  const per_page = Math.min(100, Math.max(1, parseInt(p.get('per_page') ?? '50', 10)));
  const offset   = (page - 1) * per_page;

  const raw_sort = p.get('sort_by') ?? 'change_pct';
  const sort_by  = ALLOWED_SORT.has(raw_sort) ? raw_sort : 'change_pct';
  const sort_dir = p.get('sort_dir') === 'asc' ? 'ASC' : 'DESC';

  const conditions: string[] = [];
  const params: unknown[]    = [];
  let   idx = 1;

  const addNum = (col: string, val: string | null, op: '>=' | '<=') => {
    if (!val) return;
    const n = parseFloat(val);
    if (!isNaN(n)) { conditions.push(`${col} ${op} $${idx++}`); params.push(n); }
  };

  addNum('dp.close',            p.get('price_min'),      '>=');
  addNum('dp.close',            p.get('price_max'),      '<=');
  addNum('dp.change_pct',       p.get('change_pct_min'), '>=');
  addNum('dp.change_pct',       p.get('change_pct_max'), '<=');
  addNum('dp.volume',           p.get('volume_min'),     '>=');
  addNum(MARKET_CAP_EXPR,       p.get('market_cap_min'), '>=');
  addNum(MARKET_CAP_EXPR,       p.get('market_cap_max'), '<=');
  addNum('f.pe_ratio',          p.get('pe_ratio_min'),   '>=');
  addNum('f.pe_ratio',          p.get('pe_ratio_max'),   '<=');
  addNum('f.pb_ratio',          p.get('pb_ratio_min'),   '>=');
  addNum('f.pb_ratio',          p.get('pb_ratio_max'),   '<=');
  addNum('ds.latest_yield_pct', p.get('yield_min'),      '>=');
  addNum('ds.latest_yield_pct', p.get('yield_max'),      '<=');
  addNum('ds.consecutive_years',p.get('consecutive_years_min'), '>=');
  addNum('inst.foreign_net',    p.get('foreign_net_min'), '>=');
  addNum('inst.trust_net',      p.get('trust_net_min'),   '>=');

  if (p.get('triple_buy') === 'true') {
    conditions.push(`inst.foreign_net > 0 AND inst.trust_net > 0 AND inst.dealer_net > 0`);
  }

  const sector = p.get('sector');
  if (sector && sector !== 'all') {
    const sectors = sector.split(',').filter(Boolean);
    if (sectors.length > 0) {
      conditions.push(`s.sector = ANY($${idx++}::text[])`);
      params.push(sectors);
    }
  }

  const market = p.get('market');
  if (market && market !== 'all') {
    conditions.push(`s.market = $${idx++}`);
    params.push(market);
  }

  const search = p.get('search');
  if (search && search.trim()) {
    conditions.push(`(s.symbol ILIKE $${idx} OR s.name_zh ILIKE $${idx} OR s.name_en ILIKE $${idx})`);
    params.push(`%${search.trim()}%`);
    idx++;
  }
  const WHERE = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const SORT_COL: Record<string, string> = {
    change_pct:     'dp.change_pct',
    close:          'dp.close',
    volume:         'dp.volume',
    market_cap:     MARKET_CAP_EXPR,
    pe_ratio:       'f.pe_ratio',
    pb_ratio:       'f.pb_ratio',
    dividend_yield: 'ds.latest_yield_pct',
    margin_change:  'm.margin_change',
    foreign_net:    'inst.foreign_net',
  };
  const orderCol = SORT_COL[sort_by] ?? 'dp.change_pct';

  const JOINS = `
    FROM stocks s
    INNER JOIN daily_prices dp
      ON dp.symbol = s.symbol
      AND dp.date = (SELECT MAX(date) FROM daily_prices)
    LEFT JOIN (
      SELECT DISTINCT ON (symbol)
        symbol, pe_ratio, pb_ratio, market_cap,
        eps, roe, roa, gross_margin, net_margin,
        revenue_growth_yoy, eps_growth_yoy, debt_ratio
      FROM fundamentals
      ORDER BY symbol, period DESC
    ) f ON f.symbol = s.symbol
    LEFT JOIN dividend_summary ds ON ds.symbol = s.symbol
    LEFT JOIN (
      SELECT symbol, foreign_net, trust_net, dealer_net
      FROM institutional_flows
      WHERE date = (SELECT MAX(date) FROM institutional_flows)
    ) inst ON inst.symbol = s.symbol
    LEFT JOIN (
      SELECT symbol, margin_change, margin_balance
      FROM margin_data
      WHERE date = (SELECT MAX(date) FROM margin_data)
    ) m ON m.symbol = s.symbol
  `;

  try {
    const countSql = `SELECT COUNT(*) AS total ${JOINS} ${WHERE}`;
    const dataSql  = `
      SELECT
        s.symbol, s.name_zh, s.sector, s.market,
        dp.close, dp.change_pct, dp.volume, dp.open, dp.high, dp.low,
        f.pe_ratio, f.pb_ratio,
        ${MARKET_CAP_EXPR} AS market_cap,
        f.eps, f.roe, f.roa, f.gross_margin, f.net_margin,
        f.revenue_growth_yoy, f.eps_growth_yoy, f.debt_ratio,
        ds.latest_yield_pct  AS dividend_yield,
        ds.consecutive_years,
        inst.foreign_net, inst.trust_net, inst.dealer_net,
        m.margin_change, m.margin_balance
      ${JOINS}
      ${WHERE}
      ORDER BY ${orderCol} ${sort_dir} NULLS LAST
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const countParams = [...params];
    const dataParams  = [...params, per_page, offset];

    const [countRows, dataRows] = await Promise.all([
      queryUnsafe<{ total: string }>(countSql, countParams),
      queryUnsafe(dataSql, dataParams),
    ]);

    const total = parseInt(countRows[0]?.total ?? '0', 10);

    return NextResponse.json({
      data: dataRows,
      total,
      page,
      per_page,
      pages: Math.ceil(total / per_page),
    });

  } catch (err) {
    console.error('[screener] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}