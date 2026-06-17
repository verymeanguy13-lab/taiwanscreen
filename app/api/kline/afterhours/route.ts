// =============================================================================
// app/api/kline/afterhours/route.ts
// GET /api/kline/afterhours?side=bull|bear
//
// Returns stocks filtered by bearStrategies / bullStrategies from evaluateAfterHours.
// Scans top 300 stocks by volume (not all 1800) to stay within Vercel's 60s timeout.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import type { Candle } from '@/types';
import { evaluateAfterHours } from '@/lib/bullbearSignals';
import { sma, bollingerBands } from '@/lib/indicators';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const side = (searchParams.get('side') ?? 'bull') as 'bull' | 'bear';

  const cacheKey = `afterhours:${side}`;

  try {
    const result = await cached(cacheKey, 1800, async () => {
      // Top 300 by recent volume — avoids scanning all 1800 stocks and timing out
      const stockRows = await queryUnsafe<{ symbol: string; name_zh: string; sector: string }>(
        `SELECT s.symbol, s.name_zh, COALESCE(s.sector, '') AS sector
         FROM stocks s
         INNER JOIN daily_prices dp ON dp.symbol = s.symbol
         WHERE dp.date = (SELECT MAX(date) FROM daily_prices)
         ORDER BY dp.volume DESC
         LIMIT 300`,
        [],
      );

      const results: Array<{
        symbol:        string;
        name_zh:       string;
        sector:        string;
        price:         number;
        changePercent: number;
        volume:        number;
        confidence:    number;
        matrixScore:   number;
        signalLabel:   string;
      }> = [];

      const BATCH = 50; // was 20 — fewer rounds, same total work
      for (let i = 0; i < stockRows.length; i += BATCH) {
        const batch = stockRows.slice(i, i + BATCH);

        const settled = await Promise.allSettled(
          batch.map(async ({ symbol, name_zh, sector }) => {
            const priceRows = await queryUnsafe<{
              date:   string;
              open:   number;
              high:   number;
              low:    number;
              close:  number;
              volume: number;
            }>(
              `SELECT date, open, high, low, close, volume
               FROM daily_prices
               WHERE symbol = $1
                 AND date >= CURRENT_DATE - INTERVAL '60 days'
               ORDER BY date ASC`,
              [symbol],
            );

            if (priceRows.length < 20) return null;

            const candles: Candle[] = priceRows.map((r) => ({
              open:   Number(r.open),
              high:   Number(r.high),
              low:    Number(r.low),
              close:  Number(r.close),
              volume: Number(r.volume),
              date:   r.date,
            }));

            const closes = candles.map((c) => c.close);

            const indicators = {
              sma5:  sma(closes, 5),
              sma20: sma(closes, 20),
              sma60: sma(closes, 60),
              bb:    bollingerBands(closes, 20, 2),
            };

            const evalResult = evaluateAfterHours(candles, indicators);

            const strategies = side === 'bear'
              ? evalResult.bearStrategies
              : evalResult.bullStrategies;
            const score = side === 'bear'
              ? evalResult.bearScore
              : evalResult.bullScore;

            if (!strategies || strategies.length === 0 || score <= 0) return null;

            if (!strategies || strategies.length === 0 || score <= 0) return null;

            const latestCandle = candles[candles.length - 1];
            const prevCandle   = candles[candles.length - 2];
            const changePercent = prevCandle?.close
              ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
              : 0;

            return {
              symbol,
              name_zh,
              sector,
              price:         latestCandle.close,
              changePercent: Math.round(changePercent * 100) / 100,
              volume:        latestCandle.volume ?? 0,
              confidence:    Math.min(score, 100),
              matrixScore:   Math.min(score, 100),
              signalLabel:   strategies[0],
            };
          }),
        );

        for (const r of settled) {
          if (r.status === 'fulfilled' && r.value !== null) {
            results.push(r.value);
          }
        }
      }

      results.sort((a, b) => b.confidence - a.confidence);

      return {
        results: results.slice(0, 100),
        totalScanned: stockRows.length,
      };
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=1800, stale-while-revalidate=300' },
    });
  } catch (err) {
    console.error('[afterhours] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}