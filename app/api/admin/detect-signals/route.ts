// =============================================================================
// app/api/admin/detect-signals/route.ts
// POST /api/admin/detect-signals?offset=0
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { sma, rsi as calcRsi, macd as calcMacd, bollingerBands } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateAfterHours } from '@/lib/bullbearSignals';

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
    const limit  = 20;

    // Get latest date from daily_prices
    const dateRow = await queryUnsafe<{ max: string }>(
      `SELECT MAX(date)::text AS max FROM daily_prices`,
      [],
    );
    const todayDate = String(dateRow[0]?.max ?? '').slice(0, 10);
    if (!todayDate) {
      return NextResponse.json({ error: 'No price data found' }, { status: 400 });
    }

    // Get stocks ordered by volume
    const symbols = await queryUnsafe<{ symbol: string; sector: string | null }>(
      `SELECT s.symbol, s.sector
       FROM stocks s
       JOIN daily_prices dp ON dp.symbol = s.symbol
       WHERE dp.date = $1
       ORDER BY dp.volume DESC
       LIMIT $2 OFFSET $3`,
      [todayDate, limit, offset],
    );

    if (symbols.length === 0) {
      return NextResponse.json({ message: 'No stocks at this offset', offset, todayDate });
    }

    let newSignals = 0;
    const results: { symbol: string; signals: number; error?: string }[] = [];

    for (const { symbol, sector } of symbols) {
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

        if (rows.length < 20) {
          results.push({ symbol, signals: 0 });
          continue;
        }

        const candles = rows.reverse();
        const closes  = candles.map(c => Number(c.close));
        const highs   = candles.map(c => Number(c.high));
        const lows    = candles.map(c => Number(c.low));

        const sma5arr  = sma(closes, 5);
        const sma20arr = sma(closes, 20);
        const sma60arr = sma(closes, 60);
        const rsi14arr = calcRsi(closes, 14);
        const macdData = calcMacd(closes);
        const bbData   = bollingerBands(closes);

        const breakoutIndicators = {
          sma5:  sma5arr,
          sma20: sma20arr,
          sma60: sma60arr,
          rsi14: rsi14arr,
          macd:  macdData,
        };

        const afterHoursIndicators = {
          sma5:  sma5arr,
          sma20: sma20arr,
          sma60: sma60arr,
          bb:    bbData,
        };

        const today = candles[candles.length - 1];
        let symbolSignals = 0;

        // Breakout signals
        try {
          const breakouts = detectAllBreakouts(candles as any, breakoutIndicators);
          for (const b of breakouts) {
            try {
              await queryUnsafe(
                `INSERT INTO signal_results
                   (symbol, signal_type, signal_date, entry_price, breakout_type, confidence, industry)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (symbol, signal_type, signal_date) DO NOTHING`,
                [symbol, b.type, todayDate, Number(today.close), b.type, b.confidence, sector],
              );
              symbolSignals++;
              newSignals++;
            } catch { /* skip duplicate */ }
          }
        } catch (e) {
          // breakout detection failed for this symbol — skip
        }

        // After-hours bull signals
        try {
          const afterHours = evaluateAfterHours(candles as any, afterHoursIndicators);
          for (const s of afterHours.bullStrategies) {
            try {
              await queryUnsafe(
                `INSERT INTO signal_results
                   (symbol, signal_type, signal_date, entry_price, confidence, industry)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (symbol, signal_type, signal_date) DO NOTHING`,
                [symbol, s, todayDate, Number(today.close), afterHours.bullScore, sector],
              );
              symbolSignals++;
              newSignals++;
            } catch { /* skip duplicate */ }
          }
        } catch (e) {
          // after-hours detection failed for this symbol — skip
        }

        results.push({ symbol, signals: symbolSignals });
      } catch (err) {
        results.push({ symbol, signals: 0, error: String(err) });
      }
    }

    return NextResponse.json({
      offset,
      next_offset:      offset + limit,
      date:             todayDate,
      stocks_processed: symbols.length,
      new_signals:      newSignals,
      results,
    });

  } catch (err) {
    console.error('[detect-signals] fatal:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}