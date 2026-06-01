// =============================================================================
// app/api/admin/detect-signals/route.ts
// POST /api/admin/detect-signals?offset=0
//
// Detects breakout and after-hours signals for 20 stocks at a time.
// Call repeatedly with increasing offset to backfill all stocks.
//
// PowerShell example:
//   Invoke-WebRequest -Uri "https://taiwanscreen.vercel.app/api/admin/detect-signals?offset=0" `
//     -Method POST `
//     -Headers @{"x-cron-secret"="GRsiYRX6H8cyTIzPappLQM4NZvE2GiO3QodPFz6jgFo="} `
//     -UseBasicParsing | Select-Object -ExpandProperty Content
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { sma, rsi as calcRsi, macd as calcMacd, bollingerBands } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateAfterHours } from '@/lib/bullbearSignals';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
  const limit  = 20;

  // Get today's date from latest daily_prices
  const dateRow = await queryUnsafe<{ max: string }>(
    `SELECT MAX(date) AS max FROM daily_prices`,
    [],
  );
  const todayDate = String(dateRow[0]?.max ?? '').slice(0, 10);
  if (!todayDate) return NextResponse.json({ error: 'No price data found' }, { status: 400 });

  // Get top stocks by volume
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

      const today = candles[candles.length - 1];
      let symbolSignals = 0;

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
          symbolSignals++;
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
          symbolSignals++;
          newSignals++;
        } catch { /* skip duplicate */ }
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
}