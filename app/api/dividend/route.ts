// =============================================================================
// app/api/dividend/route.ts
// GET /api/dividend?mode=screener&min_yield=4&consecutive_years_min=5
// GET /api/dividend?mode=calendar&months=3
// GET /api/dividend?mode=upcoming&days=7
// GET /api/dividend?mode=stats
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get('mode') ?? 'screener';

  // Parse common params
  const min_yield              = searchParams.get('min_yield');
  const max_yield              = searchParams.get('max_yield');
  const consecutive_years_min  = searchParams.get('consecutive_years_min');
  const dividend_freq          = searchParams.get('dividend_freq');
  const sector                 = searchParams.get('sector');
  const market                 = searchParams.get('market');
  const sort_by                = searchParams.get('sort_by') ?? 'latest_yield_pct';
  const page                   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const months                 = Math.min(24, Math.max(1, parseInt(searchParams.get('months') ?? '3', 10)));
  const days                   = Math.min(90, Math.max(1, parseInt(searchParams.get('days') ?? '7', 10)));

  const cacheKey = `dividend:${mode}:${[min_yield,max_yield,consecutive_years_min,dividend_freq,sector,market,sort_by,page,months,days].join(':')}`;

  // Whitelist sort columns
  const ALLOWED_SORT = new Set([
    'latest_yield_pct', 'consecutive_years',
    'stability_score', 'last_cash_dividend', 'close',
  ]);
  const sortCol = ALLOWED_SORT.has(sort_by) ? sort_by : 'latest_yield_pct';

  try {
    const data = await cached(cacheKey, 6 * 60 * 60, async () => {

      // ── screener ────────────────────────────────────────────────────────
      if (mode === 'screener') {
        const conditions: string[] = ['ds.latest_yield_pct IS NOT NULL'];
        const params: unknown[] = [];
        let idx = 1;

        const add = (sql: string, val: unknown) => {
          conditions.push(sql.replace('?', `$${idx++}`));
          params.push(val);
        };

        if (min_yield)             add('ds.latest_yield_pct >= ?',  parseFloat(min_yield));
        if (max_yield)             add('ds.latest_yield_pct <= ?',  parseFloat(max_yield));
        if (consecutive_years_min) add('ds.consecutive_years >= ?', parseInt(consecutive_years_min, 10));
        if (dividend_freq)         add('ds.dividend_frequency = ?', dividend_freq);
        if (sector) {
          const sectors = sector.split(',').map(s => s.trim()).filter(Boolean);
          if (sectors.length > 0) {
            const placeholders = sectors.map(() => `$${idx++}`).join(', ');
            conditions.push(`s.sector IN (${placeholders})`);
            params.push(...sectors);
          }
        }
        if (market && market !== 'all') add('s.market = ?', market);

        const where = 'WHERE ' + conditions.join(' AND ');

        // COUNT query
        const countRows = await queryUnsafe<{ total: string }>(
          `SELECT COUNT(*) AS total
           FROM dividend_summary ds
           JOIN stocks s ON ds.symbol = s.symbol
           ${where}`,
          params,
        );
        const total = parseInt(countRows[0]?.total ?? '0', 10);

        // Data query
        const limitIdx  = idx++;
        const offsetIdx = idx++;
        const rows = await queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector, s.market,
             dp.close, dp.change_pct,
             ds.latest_yield_pct, ds.consecutive_years,
             ds.dividend_frequency, ds.stability_score,
             ds.next_ex_date, ds.last_cash_dividend
           FROM dividend_summary ds
           JOIN stocks s ON ds.symbol = s.symbol
           LEFT JOIN daily_prices dp
             ON s.symbol = dp.symbol
             AND dp.date = (SELECT MAX(date) FROM daily_prices)
           ${where}
           ORDER BY ds.${sortCol} DESC NULLS LAST
           LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
          [...params, 50, (page - 1) * 50],
        );

        return { rows, total, page, per_page: 50 };
      }

      // ── calendar ─────────────────────────────────────────────────────────
      if (mode === 'calendar') {
        const rows = await queryUnsafe(
          `SELECT
             s.symbol, s.name_zh, s.sector,
             d.ex_dividend_date, d.cash_dividend, d.yield_pct,
             d.year, d.period
           FROM dividends d
           JOIN stocks s ON d.symbol = s.symbol
           WHERE d.ex_dividend_date BETWEEN NOW()
             AND NOW() + ($1 || ' months')::interval
           ORDER BY d.ex_dividend_date ASC`,
          [months],
        );
        return { rows, months };
      }

      // ── upcoming ──────────────────────────────────────────────────────────
      if (mode === 'upcoming') {
        const rows = await queryUnsafe(
          `SELECT
             s.symbol, s.name_zh,
             d.ex_dividend_date, d.cash_dividend, d.yield_pct
           FROM dividends d
           JOIN stocks s ON d.symbol = s.symbol
           WHERE d.ex_dividend_date BETWEEN NOW()
             AND NOW() + ($1 || ' days')::interval
           ORDER BY d.ex_dividend_date ASC
           LIMIT 20`,
          [days],
        );
        return { rows, days };
      }

      // ── stats ─────────────────────────────────────────────────────────────
      if (mode === 'stats') {
        const rows = await queryUnsafe<{
          above_4pct: string;
          above_5pct: string;
          avg_yield:  string;
          total:      string;
        }>(
          `SELECT
             COUNT(*) FILTER (WHERE latest_yield_pct >= 4) AS above_4pct,
             COUNT(*) FILTER (WHERE latest_yield_pct >= 5) AS above_5pct,
             ROUND(AVG(latest_yield_pct)::numeric, 2)      AS avg_yield,
             COUNT(*)                                       AS total
           FROM dividend_summary
           WHERE latest_yield_pct IS NOT NULL`,
          [],
        );
        const r = rows[0];
        return {
          above_4pct: parseInt(r?.above_4pct ?? '0', 10),
          above_5pct: parseInt(r?.above_5pct ?? '0', 10),
          avg_yield:  parseFloat(r?.avg_yield  ?? '0'),
          total:      parseInt(r?.total        ?? '0', 10),
        };
      }

      throw new Error(`Unknown mode: ${mode}`);
    });

    return NextResponse.json({ data });
  } catch (err) {
    const msg    = err instanceof Error ? err.message : String(err);
    const status = msg.startsWith('Unknown mode') ? 400 : 500;
    console.error(`[dividend] Error (mode=${mode}):`, err);
    return NextResponse.json({ error: msg }, { status });
  }
}