// =============================================================================
// app/api/compare/route.ts
// GET /api/compare?symbols=2330,2454,2317
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const raw = searchParams.get('symbols') ?? '';
  const symbols = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4);

  if (symbols.length === 0) {
    return NextResponse.json([]);
  }

  const cacheKey = `compare:${symbols.sort().join(',')}`;

  try {
    const result = await cached(cacheKey, 15 * 60, async () => {
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);

      const stocks = await Promise.all(
        symbols.map(async symbol => {
          try {
            // ── 1. Stock info ──────────────────────────────────────────────
            const infoRows = await queryUnsafe<{
              symbol: string; name_zh: string; sector: string; market: string;
            }>(
              `SELECT symbol, name_zh, sector, market FROM stocks WHERE symbol = $1`,
              [symbol],
            );
            if (!infoRows[0]) return null;
            const info = infoRows[0];

            // ── 2. Latest daily price + 52w high/low ──────────────────────
            const priceRows = await queryUnsafe<{
              close: number; change_pct: number; volume: number; date: string;
            }>(
              `SELECT close, change_pct, volume, date
               FROM daily_prices
               WHERE symbol = $1
               ORDER BY date DESC LIMIT 1`,
              [symbol],
            );
            const quote = priceRows[0] ?? {};

            const w52Rows = await queryUnsafe<{ high: number; low: number }>(
              `SELECT MAX(high) AS high, MIN(low) AS low
               FROM daily_prices
               WHERE symbol = $1 AND date >= $2`,
              [symbol, oneYearAgoStr],
            );
            const w52 = w52Rows[0] ?? {};

            // ── 3. Latest fundamentals ─────────────────────────────────────
            const fundRows = await queryUnsafe<{
              pe_ratio: number; pb_ratio: number; roe: number;
              gross_margin: number; net_margin: number;
              revenue_growth_yoy: number; eps_growth_yoy: number;
              debt_ratio: number; market_cap: number; eps: number;
            }>(
              `SELECT pe_ratio, pb_ratio, roe, gross_margin, net_margin,
                      revenue_growth_yoy, eps_growth_yoy, debt_ratio,
                      market_cap, eps
               FROM fundamentals
               WHERE symbol = $1
               ORDER BY period DESC LIMIT 1`,
              [symbol],
            );
            const fund = fundRows[0] ?? {};

            // ── 4. Dividend summary ────────────────────────────────────────
            const divRows = await queryUnsafe<{
              latest_yield_pct: number; consecutive_years: number; stability_score: number;
            }>(
              `SELECT latest_yield_pct, consecutive_years, stability_score
               FROM dividend_summary WHERE symbol = $1`,
              [symbol],
            );
            const div = divRows[0] ?? {};

            // ── 5. Latest institutional flows ─────────────────────────────
            const flowRows = await queryUnsafe<{
              foreign_net: number; trust_net: number; foreign_consecutive_days: number;
            }>(
              `SELECT foreign_net, trust_net, foreign_consecutive_days
               FROM institutional_flows
               WHERE symbol = $1
               ORDER BY date DESC LIMIT 1`,
              [symbol],
            );
            const flow = flowRows[0] ?? {};

            // ── 6. 1-year price history ───────────────────────────────────
            const historyRows = await queryUnsafe<{ date: string; close: number }>(
              `SELECT date, close
               FROM daily_prices
               WHERE symbol = $1 AND date >= $2
               ORDER BY date ASC`,
              [symbol, oneYearAgoStr],
            );

            return {
              symbol:                   info.symbol,
              name_zh:                  info.name_zh,
              sector:                   info.sector,
              market:                   info.market,
              // Price
              close:                    quote.close                    ?? null,
              change_pct:               quote.change_pct               ?? null,
              volume:                   quote.volume                   ?? null,
              high_52w:                 w52.high                       ?? null,
              low_52w:                  w52.low                        ?? null,
              // Fundamentals
              pe_ratio:                 fund.pe_ratio                  ?? null,
              pb_ratio:                 fund.pb_ratio                  ?? null,
              roe:                      fund.roe                       ?? null,
              gross_margin:             fund.gross_margin              ?? null,
              net_margin:               fund.net_margin                ?? null,
              revenue_growth_yoy:       fund.revenue_growth_yoy        ?? null,
              eps_growth_yoy:           fund.eps_growth_yoy            ?? null,
              debt_ratio:               fund.debt_ratio                ?? null,
              market_cap:               fund.market_cap                ?? null,
              eps:                      fund.eps                       ?? null,
              // Dividends
              latest_yield_pct:         div.latest_yield_pct           ?? null,
              consecutive_years:        div.consecutive_years          ?? null,
              stability_score:          div.stability_score            ?? null,
              // Institutional
              foreign_net:              flow.foreign_net               ?? null,
              trust_net:                flow.trust_net                 ?? null,
              foreign_consecutive_days: flow.foreign_consecutive_days  ?? null,
              // History
              priceHistory: historyRows,
            };
          } catch {
            return null;
          }
        }),
      );

      return stocks.filter(Boolean);
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[compare] Unexpected error:', err);
    return NextResponse.json([], { status: 200 });
  }
}