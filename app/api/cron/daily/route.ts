// =============================================================================
// app/api/cron/daily/route.ts
// Triggered by Vercel Cron at 08:30 UTC = 4:30pm Taiwan time (UTC+8), weekdays.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import {
  ingestStockList,
  ingestDailyPrices,
  ingestInstitutionalFlows,
  ingestMarginData,
} from '@/lib/ingest';
import { queryUnsafe } from '@/lib/db';
import { sma, rsi as calcRsi, macd as calcMacd, bollingerBands } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateAfterHours } from '@/lib/bullbearSignals';

export async function GET(req: NextRequest) {
  // ── 1. Validate cron secret ──────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Skip weekends (Taiwan time) ───────────────────────────────────────
  const now = new Date();
  const taiwanOffset = 8 * 60;
  const taiwanMs  = now.getTime() + taiwanOffset * 60 * 1000;
  const taiwanDay = new Date(taiwanMs).getUTCDay();

  if (taiwanDay === 0 || taiwanDay === 6) {
    return NextResponse.json({ message: 'Market closed today' });
  }

  // ── 3. Build today's date string (Taiwan local date) ─────────────────────
  const taiwanDate = new Date(taiwanMs).toISOString().slice(0, 10);
  console.log(`[cron/daily] Running ingestion for ${taiwanDate}…`);

  // ── 4. Run each ingestion step ────────────────────────────────────────────
  const allErrors: string[] = [];

  const stocks = await (async () => {
    try { return await ingestStockList(); }
    catch (err) {
      const msg = `ingestStockList fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const prices = await (async () => {
    try { return await ingestDailyPrices(taiwanDate); }
    catch (err) {
      const msg = `ingestDailyPrices fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const institutional = await (async () => {
    try { return await ingestInstitutionalFlows(taiwanDate); }
    catch (err) {
      const msg = `ingestInstitutionalFlows fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  const margin = await (async () => {
    try { return await ingestMarginData(taiwanDate); }
    catch (err) {
      const msg = `ingestMarginData fatal: ${err}`;
      console.error(msg); allErrors.push(msg);
      return { count: 0, errors: [msg] };
    }
  })();

  allErrors.push(...stocks.errors, ...prices.errors, ...institutional.errors, ...margin.errors);

  // ── 5. Signal accuracy update ─────────────────────────────────────────────

  // Helper: returns date N trading days ago (skips Sat/Sun)
  function tradingDaysAgo(n: number): string {
    let count = 0;
    const d = new Date();
    while (count < n) {
      d.setDate(d.getDate() - 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
    }
    return d.toISOString().slice(0, 10);
  }

  let newSignals  = 0;
  let updated5d   = 0;
  let updated10d  = 0;
  let updated20d  = 0;

  try {
    // ── Step A: Detect today's signals ──────────────────────────────────────
    const allSymbols = await queryUnsafe<{ symbol: string; sector: string | null }>(
      `SELECT s.symbol, s.sector
       FROM stocks s
       JOIN daily_prices dp ON dp.symbol = s.symbol
       WHERE dp.date = (SELECT MAX(date) FROM daily_prices)
       ORDER BY dp.volume DESC
       LIMIT 500`,
      [],
    );

    const BATCH = 50;
    for (let i = 0; i < allSymbols.length; i += BATCH) {
      const batch = allSymbols.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async ({ symbol, sector }) => {
        try {
          const rows = await queryUnsafe<{
            date: string; open: number; high: number;
            low: number; close: number; volume: number;
          }>(
            `SELECT date, open, high, low, close, volume
             FROM daily_prices WHERE symbol = $1
             ORDER BY date DESC LIMIT 60`,
            [symbol],
          );
          if (rows.length < 20) return;
          const candles = rows.reverse();

          const closes  = candles.map(c => c.close);
          const highs   = candles.map(c => c.high);
          const lows    = candles.map(c => c.low);

          const indicators = {
            sma5:  sma(closes, 5),
            sma20: sma(closes, 20),
            sma60: sma(closes, 60),
            rsi14: calcRsi(closes, 14),
            macd:  calcMacd(closes),
            bb:    bollingerBands(closes),
          };

          const today     = candles[candles.length - 1];
          const todayDate = String(today.date).slice(0, 10);

          // Breakout signals
          const breakouts = detectAllBreakouts(candles as any, indicators);
          for (const b of breakouts) {
            try {
              await queryUnsafe(
                `INSERT INTO signal_results
                   (symbol, signal_type, signal_date, entry_price, breakout_type, confidence, industry)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (symbol, signal_type, signal_date) DO NOTHING`,
                [symbol, b.type, todayDate, today.close, b.type, b.confidence, sector],
              );
              newSignals++;
            } catch { /* skip duplicate */ }
          }

          // After-hours bull signals
          const afterHours = evaluateAfterHours(candles as any, {
            sma5:  indicators.sma5,
            sma20: indicators.sma20,
            sma60: indicators.sma60,
            bb:    indicators.bb,
          });
          for (const s of afterHours.bullStrategies) {
            try {
              await queryUnsafe(
                `INSERT INTO signal_results
                   (symbol, signal_type, signal_date, entry_price, confidence, industry)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (symbol, signal_type, signal_date) DO NOTHING`,
                [symbol, s, todayDate, today.close, afterHours.bullScore, sector],
              );
              newSignals++;
            } catch { /* skip duplicate */ }
          }
        } catch { /* skip symbol */ }
      }));
    }

    // ── Step B: Fill in outcomes for signals old enough ──────────────────────
    for (const [days, col, retCol, upCol] of [
      [5,  'price_5d',  'return_5d',  'price_up_5d' ],
      [10, 'price_10d', 'return_10d', 'price_up_10d'],
      [20, 'price_20d', 'return_20d', 'price_up_20d'],
    ] as [number, string, string, string][]) {
      const targetDate = tradingDaysAgo(days);

      const toUpdate = await queryUnsafe<{
        id: number; symbol: string; entry_price: number;
      }>(
        `SELECT id, symbol, entry_price
         FROM signal_results
         WHERE signal_date <= $1 AND ${col} IS NULL`,
        [targetDate],
      );

      for (const row of toUpdate) {
        try {
          const priceRow = await queryUnsafe<{ close: number }>(
            `SELECT close FROM daily_prices
             WHERE symbol = $1 AND date >= $2
             ORDER BY date ASC LIMIT 1`,
            [row.symbol, targetDate],
          );
          if (!priceRow[0]) continue;

          const futurePrice = priceRow[0].close;
          const ret = ((futurePrice - row.entry_price) / row.entry_price) * 100;

          await queryUnsafe(
            `UPDATE signal_results
             SET ${col}  = $1,
                 ${retCol} = $2,
                 ${upCol}  = $3
             WHERE id = $4`,
            [futurePrice, Math.round(ret * 10000) / 10000, ret > 3, row.id],
          );

          if (days === 5)  updated5d++;
          if (days === 10) updated10d++;
          if (days === 20) updated20d++;
        } catch { /* skip */ }
      }
    }

    console.log(`[signal accuracy] new=${newSignals} 5d=${updated5d} 10d=${updated10d} 20d=${updated20d}`);
  } catch (err) {
    console.error('[signal accuracy] fatal:', err);
    allErrors.push(`signal_accuracy: ${err}`);
  }

  // ── 6. Trigger alert checks ───────────────────────────────────────────────
  await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/cron/alerts`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET ?? '' },
  }).catch(err => console.error('[daily] alerts cron error:', err));

  // ── 7. Return summary ─────────────────────────────────────────────────────
  console.log(`[cron/daily] Completed for ${taiwanDate}. Total errors: ${allErrors.length}`);

  return NextResponse.json({
    success: true,
    date:    taiwanDate,
    results: {
      stocks:         { count: stocks.count },
      prices:         { count: prices.count },
      institutional:  { count: institutional.count },
      margin:         { count: margin.count },
      signal_results: { new: newSignals, updated5d, updated10d, updated20d },
    },
    errors: allErrors,
  });
}