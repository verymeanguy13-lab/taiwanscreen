// =============================================================================
// app/api/cron/weekly/route.ts
// Triggered by Vercel Cron at 10:00 UTC on Saturdays = 6:00pm Taiwan time.
// Recomputes dividend_summary for all stocks with dividend history.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function GET(req: NextRequest) {
  // ── 1. Validate cron secret ──────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[cron/weekly] Starting dividend summary recomputation…');

  // ── 2. Get all symbols that have dividend records ─────────────────────────
  const symbols = await queryUnsafe<{ symbol: string }>(
    `SELECT DISTINCT symbol FROM dividends ORDER BY symbol`,
    [],
  );

  console.log(`[cron/weekly] Processing ${symbols.length} symbols…`);

  let updated = 0;
  const errors: string[] = [];

  for (const { symbol } of symbols) {
    try {
      // Fetch all dividend records for this symbol, newest first
      const rows = await queryUnsafe<{
        year: number;
        period: string;
        cash_dividend: number;
        yield_pct: number;
        ex_dividend_date: string;
      }>(
        `SELECT year, period, cash_dividend, yield_pct, ex_dividend_date
         FROM dividends
         WHERE symbol = $1
         ORDER BY year DESC, period DESC`,
        [symbol],
      );

      if (rows.length === 0) continue;

      // ── consecutive_years ────────────────────────────────────────────────
      // Count distinct years with cash_dividend > 0, in unbroken sequence
      // from the most recent year backwards.
      const yearsWithDividend = [
        ...new Set(
          rows
            .filter(r => (r.cash_dividend ?? 0) > 0)
            .map(r => r.year),
        ),
      ].sort((a, b) => b - a); // newest first

      let consecutiveYears = 0;
      for (let i = 0; i < yearsWithDividend.length; i++) {
        // Expect each year to be exactly 1 less than the previous
        if (i === 0 || yearsWithDividend[i] === yearsWithDividend[i - 1] - 1) {
          consecutiveYears++;
        } else {
          break;
        }
      }

      // ── latest_yield_pct ─────────────────────────────────────────────────
      const latestWithYield = rows.find(r => r.yield_pct != null && r.yield_pct > 0);
      const latest_yield_pct = latestWithYield?.yield_pct ?? 0;

      // ── last_cash_dividend ───────────────────────────────────────────────
      const latestCash = rows.find(r => (r.cash_dividend ?? 0) > 0);
      const last_cash_dividend = latestCash?.cash_dividend ?? 0;

      // ── next_ex_date ─────────────────────────────────────────────────────
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = rows.find(
        r => r.ex_dividend_date && r.ex_dividend_date > today,
      );
      const next_ex_date = upcoming?.ex_dividend_date ?? null;

      // ── dividend_frequency ───────────────────────────────────────────────
      // Inferred from how many distinct periods appear in the most recent year
      const recentYear = rows[0]?.year;
      const periodsThisYear = [
        ...new Set(rows.filter(r => r.year === recentYear).map(r => r.period)),
      ];
      const freq = periodsThisYear.length;
      const dividend_frequency =
        freq >= 12 ? 'monthly'
        : freq >= 4  ? 'quarterly'
        : freq >= 2  ? 'semi-annual'
        : 'annual';

      // ── stability_score (0–100) ──────────────────────────────────────────
      // Base: 5 points per consecutive year, max 50
      const baseScore = Math.min(consecutiveYears * 5, 50);

      // Consistency bonus: up to 30 points
      // Full 30 if ≥10 consecutive years, scaled linearly below that
      const consistencyBonus = Math.min(Math.floor(consecutiveYears / 10 * 30), 30);

      // Frequency bonus
      const frequencyBonus =
        dividend_frequency === 'monthly'    ? 20
        : dividend_frequency === 'quarterly'  ? 10
        : dividend_frequency === 'semi-annual' ? 5
        : 0;

      const stability_score = Math.min(baseScore + consistencyBonus + frequencyBonus, 100);

      // ── Upsert dividend_summary ──────────────────────────────────────────
      await queryUnsafe(
        `INSERT INTO dividend_summary
           (symbol, latest_yield_pct, consecutive_years, dividend_frequency,
            stability_score, next_ex_date, last_cash_dividend)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (symbol) DO UPDATE
           SET latest_yield_pct   = EXCLUDED.latest_yield_pct,
               consecutive_years  = EXCLUDED.consecutive_years,
               dividend_frequency = EXCLUDED.dividend_frequency,
               stability_score    = EXCLUDED.stability_score,
               next_ex_date       = EXCLUDED.next_ex_date,
               last_cash_dividend = EXCLUDED.last_cash_dividend`,
        [
          symbol,
          latest_yield_pct,
          consecutiveYears,
          dividend_frequency,
          stability_score,
          next_ex_date,
          last_cash_dividend,
        ],
      );

      updated++;
    } catch (err) {
      const msg = `[cron/weekly] Failed for ${symbol}: ${err}`;
      console.error(msg);
      errors.push(msg);
    }
  }

  console.log(`[cron/weekly] Done. Updated ${updated} records, ${errors.length} errors.`);

  return NextResponse.json({
    success: true,
    updated,
    total: symbols.length,
    errors,
  });
}