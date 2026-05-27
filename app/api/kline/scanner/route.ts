// =============================================================================
// app/api/kline/scanner/route.ts
// GET /api/kline/scanner?type=all|uptrend|box|vreversal&industry=xxx
//
// SERVER-SIDE ONLY. Reads Neon. No live tick fetching. No timeout risk.
// Cache: s-maxage=3600 (1 hour)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import type { Candle } from '@/types';

import { sma, rsi as calcRsi, macd as calcMacd, volumeRatio } from '@/lib/indicators';
import { detectAllBreakouts }   from '@/lib/breakouts';
import { evaluateSignalMatrix } from '@/lib/signals';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanResult {
  symbol:      string;
  name_zh:     string;
  sector:      string;
  breakoutType?: string;
  confidence:  number;
  matrixScore: number;
  price:       number;
  changePercent: number;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type     = (searchParams.get('type') ?? 'all') as 'all' | 'uptrend' | 'box' | 'vreversal';
  const industry = searchParams.get('industry') ?? '';

  const cacheKey = `scanner:${type}:${industry}`;

  try {
    const result = await cached(cacheKey, 3600, async () => {
      // ── 1. Fetch all symbols with recent data ─────────────────────────────
      const stockRows = await queryUnsafe<{ symbol: string; name_zh: string; sector: string }>(
        `SELECT DISTINCT s.symbol, s.name_zh, COALESCE(s.sector, '') AS sector
         FROM stocks s
         INNER JOIN daily_prices dp ON dp.symbol = s.symbol
         WHERE dp.date >= CURRENT_DATE - INTERVAL '5 days'`,
        [],
      );

      // Optionally filter by industry
      const filtered = industry
        ? stockRows.filter((r) => r.sector === industry)
        : stockRows;

      const totalScanned = filtered.length;
      const results: ScanResult[] = [];
      const signalCounts = { uptrend: 0, box: 0, vreversal: 0 };

      // ── 2. Process in batches of 20 ───────────────────────────────────────
      const BATCH = 20;
      for (let i = 0; i < filtered.length; i += BATCH) {
        const batch = filtered.slice(i, i + BATCH);

        const settled = await Promise.allSettled(
          batch.map(async ({ symbol, name_zh, sector }) => {
            // Fetch 60 days of prices
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

            const closes  = candles.map((c) => c.close);
            const volumes = candles.map((c) => c.volume ?? 0);

            const sma5  = sma(closes, 5);
            const sma20 = sma(closes, 20);
            const sma60 = sma(closes, 60);
            const rsi14 = calcRsi(closes, 14);
            const macdData = calcMacd(closes);
            const volRatioData = volumeRatio(volumes, 5);

            const breakouts = detectAllBreakouts(candles, {
              sma5, sma20, sma60, rsi14, macd: macdData,
            });

            // Minimal indicator snapshot for signal matrix
            const { bollingerBands, obv: calcObv } = await import('@/lib/indicators');
            const bbData  = bollingerBands(closes);
            const obvData = calcObv(candles);
            const { kdj } = await import('@/lib/indicators');
            const kdjData = kdj(
              candles.map((c) => c.high),
              candles.map((c) => c.low),
              closes,
            );

            const matrix = evaluateSignalMatrix(candles, {
              sma5, sma20, sma60, rsi14,
              macd: macdData,
              kd:   { k: kdjData.k, d: kdjData.d },
              bb:   bbData,
              obv:  obvData,
              volRatio: volRatioData,
            });

            // ── Keep: breakout fired OR matrixScore > 55 ──────────────────
            const topBreakout = breakouts[0] ?? null;
            if (!topBreakout && matrix.matrixScore <= 55) return null;

            const lastCandle = candles[candles.length - 1];
            const prevCandle = candles[candles.length - 2];
            const changePercent = prevCandle?.close > 0
              ? ((lastCandle.close - prevCandle.close) / prevCandle.close) * 100
              : 0;

            return {
              symbol,
              name_zh,
              sector,
              breakoutType: topBreakout?.type,
              confidence:   topBreakout?.confidence ?? matrix.matrixScore,
              matrixScore:  matrix.matrixScore,
              price:        lastCandle.close,
              changePercent: Math.round(changePercent * 100) / 100,
            } satisfies ScanResult;
          }),
        );

        for (const s of settled) {
          if (s.status === 'fulfilled' && s.value !== null) {
            const item = s.value;
            results.push(item);
            if (item.breakoutType === '上漲趨勢突破') signalCounts.uptrend++;
            if (item.breakoutType === '箱型整理突破') signalCounts.box++;
            if (item.breakoutType === '下跌V轉突破')  signalCounts.vreversal++;
          }
        }
      }

      // ── 3. Filter by type ─────────────────────────────────────────────────
      const typeFiltered = type === 'all'
        ? results
        : results.filter((r) => {
            if (type === 'uptrend')   return r.breakoutType === '上漲趨勢突破';
            if (type === 'box')       return r.breakoutType === '箱型整理突破';
            if (type === 'vreversal') return r.breakoutType === '下跌V轉突破';
            return true;
          });

      // ── 4. Sort by confidence desc, return top 100 ───────────────────────
      const top100 = typeFiltered
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 100);

      return { results: top100, totalScanned, signalCounts };
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' },
    });

  } catch (err) {
    console.error('[kline/scanner] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
