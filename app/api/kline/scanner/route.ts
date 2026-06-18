import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { computeIndicators } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateSignalMatrix } from '@/lib/signals';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';
  const industry = searchParams.get('industry') || null;

  try {
    // 1. Fetch all symbols that have recent price data
    const symbolRows = await sql`
      SELECT DISTINCT dp.symbol, s.name_zh, s.sector
      FROM daily_prices dp
      JOIN stocks s ON s.symbol = dp.symbol
      WHERE dp.date >= NOW() - INTERVAL '5 days'
      ORDER BY dp.symbol
    `;

    const symbols = symbolRows as { symbol: string; name_zh: string; sector: string }[];

    const results: Array<{
      symbol: string;
      name_zh: string;
      sector: string;
      confidence: number;
      signalType: string;
      matrixScore: number;
      breakouts: ReturnType<typeof detectAllBreakouts>;
    }> = [];

    // 2. Process in batches of 20
    const BATCH_SIZE = 20;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async ({ symbol, name_zh, sector }) => {
          try {
            // Fetch 60 days of price data
            const priceRows = await sql`
              SELECT date, open, high, low, close, volume
              FROM daily_prices
              WHERE symbol = ${symbol}
              ORDER BY date DESC
              LIMIT 60
            `;

            const candles = (priceRows as any[])
              .reverse()
              .map((r) => ({
                date: r.date,
                open: Number(r.open),
                high: Number(r.high),
                low: Number(r.low),
                close: Number(r.close),
                volume: Number(r.volume),
              }));

            if (candles.length < 20) return;

            // Compute indicators
            const indicators = computeIndicators(candles);

            // Run breakout detection
            const breakouts = detectAllBreakouts(candles, indicators);

            // Run signal matrix
            const matrix = evaluateSignalMatrix(candles, indicators, [], []);
            const matrixScore = matrix.score ?? 0;

            const breakoutFired = breakouts.some((b) => b.triggered);

            // Keep if breakout fired OR matrix score > 55
            if (!breakoutFired && matrixScore <= 55) return;

            // Determine signal type
            let signalType = 'uptrend';
            if (breakouts.find((b) => b.triggered && b.type === '箱型整理突破')) {
              signalType = 'box';
            } else if (breakouts.find((b) => b.triggered && b.type === '下跌V轉突破')) {
              signalType = 'vreversal';
            }

            // Apply type filter
            if (type !== 'all' && signalType !== type) return;

            // Apply industry filter
            if (industry && sector !== industry) return;

            const confidence = breakoutFired
              ? Math.max(...breakouts.filter((b) => b.triggered).map((b) => b.confidence ?? 50))
              : matrixScore;

            results.push({ symbol, name_zh, sector, confidence, signalType, matrixScore, breakouts });
          } catch {
            // Skip stocks that error
          }
        })
      );
    }

    // 3. Sort by confidence desc, return top 100
    results.sort((a, b) => b.confidence - a.confidence);
    const top100 = results.slice(0, 100);

    const signalCounts = {
      uptrend: top100.filter((r) => r.signalType === 'uptrend').length,
      box: top100.filter((r) => r.signalType === 'box').length,
      vreversal: top100.filter((r) => r.signalType === 'vreversal').length,
    };

    return NextResponse.json(
      {
        results: top100,
        totalScanned: symbols.length,
        signalCounts,
      },
      {
        headers: {
          'Cache-Control': 's-maxage=3600',
        },
      }
    );
  } catch (error) {
    console.error('Scanner error:', error);
    return NextResponse.json({ error: 'Scanner failed' }, { status: 500 });
  }
}