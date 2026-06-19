// =============================================================================
// app/api/kline/afterhours/route.ts
// GET /api/kline/afterhours?side=bull|bear
//
// Uses computeScore (same as individual stock page) for consistency.
// Bull = overall >= 60, Bear = overall < 40
// Quality gate: avg5vol >= 1000, latest vol >= 500
// Cache: 12 hours (survives Vercel cold starts via CDN)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import type { Candle } from '@/types';
import { computeScore } from '@/lib/scoring';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const side = (searchParams.get('side') ?? 'bull') as 'bull' | 'bear';

  const today = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const cacheKey = `afterhours:v2:${side}:${today}`;

  try {
    const result = await cached(cacheKey, 43200, async () => {
      const stockRows = await queryUnsafe<{ symbol: string; name_zh: string; sector: string }>(
        `SELECT DISTINCT s.symbol, s.name_zh, COALESCE(s.sector, '') AS sector
         FROM stocks s
         INNER JOIN daily_prices dp ON dp.symbol = s.symbol
         WHERE dp.date >= CURRENT_DATE - INTERVAL '5 days'`,
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

      const BATCH = 20;
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

            const last5 = candles.slice(-5);
            const avg5vol = last5.reduce((s, c) => s + (c.volume ?? 0), 0) / 5;
            const latestVol = candles[candles.length - 1].volume ?? 0;

            if (avg5vol < 1000) return null;
            if (latestVol < 500) return null;

            const scoreResult = computeScore(candles);
            const { overall, technicalReading, dimensions } = scoreResult;

            const isBull = overall >= 60;
            const isBear = overall < 40;

            if (side === 'bull' && !isBull) return null;
            if (side === 'bear' && !isBear) return null;

            const latestCandle = candles[candles.length - 1];
            const prevCandle   = candles[candles.length - 2];
            const changePercent = prevCandle?.close
              ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
              : 0;

            const topDimension = Object.entries(dimensions)
              .sort(([, a], [, b]) => b.score - a.score)[0];

            const DIMENSION_LABELS: Record<string, string> = {
              trend:     '趨勢強勢',
              momentum:  '動能強勁',
              volume:    '量能放大',
              chips:     '籌碼買超',
              pattern:   '型態突破',
              sentiment: '情緒偏多',
            };

            return {
              symbol,
              name_zh,
              sector,
              price:         latestCandle.close,
              changePercent: Math.round(changePercent * 100) / 100,
              volume:        latestVol,
              confidence:    overall,
              matrixScore:   overall,
              signalLabel:   DIMENSION_LABELS[topDimension?.[0]] ?? technicalReading,
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
      headers: { 'Cache-Control': 's-maxage=43200, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[afterhours] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}