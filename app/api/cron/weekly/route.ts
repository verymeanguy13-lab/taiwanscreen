// =============================================================================
// app/api/cron/weekly/route.ts
// Triggered by Vercel Cron at 10:00 UTC on Saturdays = 6:00pm Taiwan time.
// Recomputes dividend_summary for all stocks with dividend history.
//
// NOTE: does NOT touch latest_yield_pct — that field is owned by the
// separate TWSE-based pipeline (ingestFundamentals, runs daily). This job
// previously overwrote it with 0 every run because the FinMind-sourced
// `dividends.yield_pct` column is never actually populated by ingest-dividends,
// so the lookup always failed and silently zeroed out the real value.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export const maxDuration = 300; // 5 minutes -- was hitting Hobby's 10s default

export async function GET(req: NextRequest) {
  // ── 1. Validate cron secret — allow Vercel cron trigger OR manual secret ──
  const secret = req.headers.get('x-cron-secret');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';

  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
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
        ex_dividend_date: string;
      }>(
        `SELECT year, period, cash_dividend, ex_dividend_date
         FROM dividends
         WHERE symbol = $1
         ORDER BY year DESC, period DESC`,
        [symbol],
      );

      if (rows.length === 0) continue;

      // ── consecutive_years ────────────────────────────────────────────────
      const yearsWithDividend = [
        ...new Set(
          rows
            .filter(r => (r.cash_dividend ?? 0) > 0)
            .map(r => r.year),
        ),
      ].sort((a, b) => b - a);

      let consecutiveYears = 0;
      for (let i = 0; i < yearsWithDividend.length; i++) {
        if (i === 0 || yearsWithDividend[i] === yearsWithDividend[i - 1] - 1) {
          consecutiveYears++;
        } else {
          break;
        }
      }

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
      // Previously this counted distinct periods within rows[0]'s calendar
      // year only. That's unreliable for most of the year: e.g. checked in
      // July, a genuinely quarterly payer has usually only had 1 payout so
      // far in the current year, making it indistinguishable from a true
      // annual payer. Instead, look at the trailing 365 days ending at the
      // stock's own most recent ex-dividend date -- that always captures
      // one full payout cycle regardless of where we are in the calendar.
      const exDatesSorted = rows
        .map(r => r.ex_dividend_date)
        .filter((d): d is string => !!d)
        .sort()
        .reverse();
      const mostRecentExDate = exDatesSorted[0] ?? null;

      let freq = 1;
      if (mostRecentExDate) {
        const cutoff = new Date(mostRecentExDate);
        cutoff.setUTCDate(cutoff.getUTCDate() - 365);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        freq = new Set(exDatesSorted.filter(d => d > cutoffStr)).size;
      }
      const dividend_frequency =
        freq >= 12 ? 'monthly'
        : freq >= 4  ? 'quarterly'
        : freq >= 2  ? 'semi-annual'
        : 'annual';

      // ── stability_score (0–100) ──────────────────────────────────────────
      const baseScore = Math.min(consecutiveYears * 5, 50);
      const consistencyBonus = Math.min(Math.floor(consecutiveYears / 10 * 30), 30);
      const frequencyBonus =
        dividend_frequency === 'monthly'     ? 20
        : dividend_frequency === 'quarterly'  ? 10
        : dividend_frequency === 'semi-annual' ? 5
        : 0;
      const stability_score = Math.min(baseScore + consistencyBonus + frequencyBonus, 100);

      // ── Upsert dividend_summary (latest_yield_pct intentionally excluded) ─
      await queryUnsafe(
        `INSERT INTO dividend_summary
           (symbol, consecutive_years, dividend_frequency,
            stability_score, next_ex_date, last_cash_dividend)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (symbol) DO UPDATE
           SET consecutive_years  = EXCLUDED.consecutive_years,
               dividend_frequency = EXCLUDED.dividend_frequency,
               stability_score    = EXCLUDED.stability_score,
               next_ex_date       = EXCLUDED.next_ex_date,
               last_cash_dividend = EXCLUDED.last_cash_dividend`,
        [
          symbol,
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