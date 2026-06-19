// =============================================================================
// app/api/kline/afterhours/route.ts
// GET /api/kline/afterhours?side=bull|bear
//
// Uses computeScore (same as individual stock page) for consistency.
// Bull = overall >= 60, Bear = overall < 40
// Quality gate: avg5vol >= 1000, latest vol >= 500
// Bulk fetches all price data in 2 queries instead of 1980 queries.
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
  const cacheKey = `afterhours:v3:${side}:${today}`;

  try {
    const result = await cached(cacheKey, 43200, async () => {

      // ── 1. Fetch all stocks ────────────────────────────────────────────────
      const stockRows = await queryUnsafe<{ symbol: string; name_zh: string; sector: string }>(
        `SELECT DISTINCT s.symbol, s.name_zh, COALESCE(s.sector, '') AS sector
         FROM stocks s
         INNER JOIN daily_prices dp ON dp.symbol = s.symbol
         WHERE dp.date >= CURRENT_DATE - INTERVAL '5 days'`,
        [],
      );

      // ── 2. Bulk fetch ALL price data in one query ─────────────────────────
      const allPriceRows = await queryUnsafe<{
        symbol: string;
        date:   string;
        open:   string;
        high:   string;
        low:    string;
        close:  string;
        volume: string;
      }>(
        `SELECT symbol, date, open, high, low, close, volume
         FROM daily_prices
         WHERE date >= CURRENT_DATE - INTERVAL '60 days'
         ORDER BY symbol, date ASC`,
        [],
      );

      // ── 3. Group prices by symbol ─────────────────────────────────────────
      const pricesBySymbol = new Map<string, Candle[]>();
      for (const row of allPriceRows) {
        if (!pricesBySymbol.has(row.symbol)) {
          pricesBySymbol.set(row.symbol, []);
        }
        pricesBySymbol.get(row.symbol)!.push({
          open:   Number(row.open),
          high:   Number(row.high),
          low:    Number(row.low),
          close:  Number(row.close),
          volume: Number(row.volume),
          date:   String(row.date),
        });
      }

      // ── 4. Score each stock ───────────────────────────────────────────────
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

      const DIMENSION_LABELS: Record<string, string> = {
        trend:     '趨勢強勢',
        momentum:  '動能強勁',
        volume:    '量能放大',
        chips:     '籌碼買超',
        pattern:   '型態突破',
        sentiment: '情緒偏多',
      };

      for (const { symbol, name_zh, sector } of stockRows) {
        try {
          const candles = pricesBySymbol.get(symbol);
          if (!candles || candles.length < 20) continue;

          // Quality gate
          const last5 = candles.slice(-5);
          const avg5vol = last5.reduce((s, c) => s + (c.volume ?? 0), 0) / 5;
          const latestVol = candles[candles.length - 1].volume ?? 0;
          if (avg5vol < 1000) continue;
          if (latestVol < 500) continue;

          // Score
          const scoreResult = computeScore(candles);
          const { overall, technicalReading, dimensions } = scoreResult;

          const isBull = overall >= 60;
          const isBear = overall < 40;

          if (side === 'bull' && !isBull) continue;
          if (side === 'bear' && !isBear) continue;

          const latestCandle = candles[candles.length - 1];
          const prevCandle   = candles[candles.length - 2];
          const changePercent = prevCandle?.close
            ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
            : 0;

          const topDimension = Object.entries(dimensions)
            .sort(([, a], [, b]) => b.score - a.score)[0];

          results.push({
            symbol,
            name_zh,
            sector,
            price:         latestCandle.close,
            changePercent: Math.round(changePercent * 100) / 100,
            volume:        latestVol,
            confidence:    overall,
            matrixScore:   overall,
            signalLabel:   DIMENSION_LABELS[topDimension?.[0]] ?? technicalReading,
          });
        } catch {
          // skip
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