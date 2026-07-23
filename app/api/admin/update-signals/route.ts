import { NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { sma, rsi as calcRsi, macd as calcMacd, bollingerBands } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateAfterHours } from '@/lib/bullbearSignals';

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

export async function POST() {
  const allErrors: string[] = [];
  let newSignals = 0;
  let updated5d  = 0;
  let updated10d = 0;
  let updated20d = 0;

  try {
    const allSymbols = await queryUnsafe<{ symbol: string; sector: string | null }>(
      `SELECT s.symbol, s.sector
       FROM stocks s
       JOIN daily_prices dp ON dp.symbol = s.symbol
       WHERE dp.date = (SELECT MAX(date) FROM daily_prices)
       ORDER BY dp.volume DESC
       LIMIT 100`,
      [],
    );

    const todayDate = new Date().toISOString().slice(0, 10);

    await Promise.allSettled(allSymbols.map(async ({ symbol, sector }) => {
      try {
        const rows = await queryUnsafe<{
          date: string; open: number; high: number;
          low: number; close: number; volume: number;
        }>(
          `SELECT date, open, high, low, close, volume
           FROM daily_prices WHERE symbol = $1
           ORDER BY date DESC LIMIT 90`,
          [symbol],
        );
        if (rows.length < 20) return;
        const candles = rows.reverse();
        const closes  = candles.map(c => c.close);

        const indicators = {
          sma5:  sma(closes, 5),
          sma20: sma(closes, 20),
          sma60: sma(closes, 60),
          rsi14: calcRsi(closes, 14),
          macd:  calcMacd(closes),
          bb:    bollingerBands(closes),
        };

        const today = candles[candles.length - 1];
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
          } catch { /* skip */ }
        }

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
          } catch { /* skip */ }
        }
      } catch { /* skip symbol */ }
    }));

    for (const [days, col, retCol, upCol] of [
      [5,  'price_5d',  'return_5d',  'price_up_5d' ],
      [10, 'price_10d', 'return_10d', 'price_up_10d'],
      [20, 'price_20d', 'return_20d', 'price_up_20d'],
    ] as [number, string, string, string][]) {
      // targetDate is used ONLY as the eligibility filter (is this signal
      // old enough that `days` trading days have definitely passed since it
      // fired?) — NOT as the future-price lookup date. It was previously
      // reused for both, which meant the "future" price could end up being
      // fetched from at or near the signal's OWN entry date whenever
      // targetDate landed close to signal_date — producing exactly 0.00%
      // return for every signal, regardless of what the stock actually did.
      const targetDate = tradingDaysAgo(days);
      const toUpdate = await queryUnsafe<{ id: number; symbol: string; entry_price: number; signal_date: string }>(
        `SELECT id, symbol, entry_price, signal_date
         FROM signal_results
         WHERE signal_date <= $1 AND ${col} IS NULL
         LIMIT 200`,
        [targetDate],
      );

      for (const row of toUpdate) {
        try {
          // The Nth actual trading day AFTER this signal's own date — using
          // daily_prices' own row order (via OFFSET) rather than
          // reimplementing trading-day arithmetic, so weekends/holidays are
          // handled correctly automatically.
          const priceRow = await queryUnsafe<{ close: number }>(
            `SELECT close FROM daily_prices
             WHERE symbol = $1 AND date > $2
             ORDER BY date ASC
             OFFSET ${days - 1} LIMIT 1`,
            [row.symbol, row.signal_date],
          );
          if (!priceRow[0]) continue;
          const futurePrice = priceRow[0].close;
          const ret = ((futurePrice - row.entry_price) / row.entry_price) * 100;
          await queryUnsafe(
            `UPDATE signal_results
             SET ${col} = $1, ${retCol} = $2, ${upCol} = $3
             WHERE id = $4`,
            [futurePrice, Math.round(ret * 10000) / 10000, ret > 0, row.id],
          );
          if (days === 5)  updated5d++;
          if (days === 10) updated10d++;
          if (days === 20) updated20d++;
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    allErrors.push(`signal_accuracy: ${err}`);
  }

  return NextResponse.json({
    success: true,
    results: { newSignals, updated5d, updated10d, updated20d },
    errors: allErrors,
  });
}