// =============================================================================
// app/api/admin/detect-signals/route.ts
// POST /api/admin/detect-signals?offset=0&limit=15
// limit is now configurable via the URL, capped at 25 to stay within
// Vercel's 10s timeout on the Hobby plan (was previously hardcoded to 5,
// ignoring whatever was passed in the URL).
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { sma, rsi as calcRsi, macd as calcMacd, kdj, bollingerBands, obv, volumeRatio } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateAfterHours } from '@/lib/bullbearSignals';
import { computeScore } from '@/lib/scoring';

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const offset = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? '5', 10);
    const limit = Math.min(Math.max(limitParam, 1), 25); // clamp 1–25 for safety

    const dateRow = await queryUnsafe<{ max: string }>(
      `SELECT MAX(date)::text AS max FROM daily_prices`,
      [],
    );
    const todayDate = String(dateRow[0]?.max ?? '').slice(0, 10);
    if (!todayDate) {
      return NextResponse.json({ error: 'No price data found' }, { status: 400 });
    }

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
    const results: { symbol: string; signals: number; score?: number; skipped?: boolean; error?: string }[] = [];

    for (const { symbol, sector } of symbols) {
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

        if (rows.length < 20) { results.push({ symbol, signals: 0 }); continue; }

        const candles  = rows.reverse();
        const closes   = candles.map(c => Number(c.close));
        const highs    = candles.map(c => Number(c.high));
        const lows     = candles.map(c => Number(c.low));
        const volumes  = candles.map(c => Number(c.volume));
        const sma5arr  = sma(closes, 5);
        const sma20arr = sma(closes, 20);
        const sma60arr = sma(closes, 60);
        const macdData = calcMacd(closes);
        const bbData   = bollingerBands(closes);

        const today = candles[candles.length - 1];
        let symbolSignals = 0;

        // ------------------------------------------------------------------
        // Compute composite score ONCE per stock.
        // Used as a gate: bullish signals are only written to signal_results
        // if the overall score is >= 45 (not bearish).
        // This prevents slow-drift or weak stocks from appearing in 起漲雷達.
        // ------------------------------------------------------------------
        const scoreResult = computeScore(candles as any);
        const overallScore = scoreResult.overall;

        // Breakout signals — not gated by score (breakouts are objective
        // price events; let the confidence field carry the weight instead)
        try {
          const breakouts = detectAllBreakouts(candles as any, {
            sma5: sma5arr, sma20: sma20arr, sma60: sma60arr,
            rsi14: calcRsi(closes, 14), macd: macdData,
          });
          for (const b of breakouts) {
            // For breakout signals, blend breakout confidence with overall score
            const blendedConfidence = Math.round((b.confidence * 0.7) + (overallScore * 0.3));
            try {
              await queryUnsafe(
                `INSERT INTO signal_results
                   (symbol, signal_type, signal_date, entry_price, breakout_type, confidence, industry)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (symbol, signal_type, signal_date) DO NOTHING`,
                [symbol, b.type, todayDate, Number(today.close), b.type, blendedConfidence, sector],
              );
              symbolSignals++; newSignals++;
            } catch { /* skip */ }
          }
        } catch { /* skip symbol */ }

        // After-hours bull signals — GATED by score
        // A stock must score >= 45 to appear as bullish in 起漲雷達.
        // This prevents ETFs drifting up, or stocks below all MAs, from
        // appearing alongside genuine breakout candidates.
        try {
          if (overallScore >= 45) {
            const afterHours = evaluateAfterHours(candles as any, {
              sma5: sma5arr, sma20: sma20arr, sma60: sma60arr, bb: bbData,
            });
            // Win-rate based weights for 起漲雷達 scoring (measured June 2026):
            // 突破均線 83%, 剛轉多 75%, 昨日強勢股 67%, 近五日強勢股 60%
            // 突破壓力 58%, 開布林 57%, 突破趨勢線 51%, 近十日強勢股 22%
            const WIN_RATE_WEIGHTS: Record<string, number> = {
              '突破均線':     30,
              '剛轉多':       25,
              '昨日強勢股':   20,
              '近五日強勢股': 15,
              '突破壓力':     15,
              '開布林':       15,
              '突破趨勢線':   8,
            };
            const MAX_WEIGHT = 128; // theoretical max if all strategies fire

            // Blend win-rate score with overall technical score
            const winRateRaw = afterHours.bullStrategies.reduce(
              (sum, s) => sum + (WIN_RATE_WEIGHTS[s] ?? 8), 0
            );
            const winRateScore = Math.min(100, Math.round((winRateRaw / MAX_WEIGHT) * 100));

            // Final confidence = 60% win-rate signal + 40% overall technical score
            // This means a stock with great pattern but weak fundamentals scores lower
            const finalConfidence = Math.round((winRateScore * 0.6) + (overallScore * 0.4));

            for (const s of afterHours.bullStrategies) {
              try {
                await queryUnsafe(
                  `INSERT INTO signal_results
                     (symbol, signal_type, signal_date, entry_price, confidence, industry)
                   VALUES ($1,$2,$3,$4,$5,$6)
                   ON CONFLICT (symbol, signal_type, signal_date) DO NOTHING`,
                  [symbol, s, todayDate, Number(today.close), finalConfidence, sector],
                );
                symbolSignals++; newSignals++;
              } catch { /* skip */ }
            }
          } else {
            // Score too low — log that we skipped this stock's bull signals
            console.log(`[detect-signals] Skipped bull signals for ${symbol} — score ${overallScore} < 45`);
          }
        } catch { /* skip symbol */ }

        results.push({ symbol, signals: symbolSignals, score: overallScore });
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