import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sma, rsi, macd, kdj, bollingerBands, obv, volumeRatio } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';
import { evaluateSignalMatrix } from '@/lib/signals';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';
  const industry = searchParams.get('industry') || null;

  try {
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

    const BATCH_SIZE = 20;
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(
        batch.map(async ({ symbol, name_zh, sector }) => {
          try {
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

            const closes  = candles.map(c => c.close);
            const highs   = candles.map(c => c.high);
            const lows    = candles.map(c => c.low);
            const volumes = candles.map(c => c.volume);

            const kdjResult = kdj(highs, lows, closes);

            const indicators = {
              sma5:     sma(closes, 5),
              sma20:    sma(closes, 20),
              sma60:    sma(closes, 60),
              rsi14:    rsi(closes, 14),
              macd:     macd(closes),
              kd:       { k: kdjResult.k, d: kdjResult.d },
              bb:       bollingerBands(closes),
              obv:      obv(candles),
              volRatio: volumeRatio(volumes, 5),
            };

            const breakouts = detectAllBreakouts(candles, indicators);
            const matrix = evaluateSignalMatrix(candles, indicators);
            const matrixScore = matrix.matrixScore ?? 0;
            const breakoutFired = breakouts.some((b) => b.triggered);

            if (!breakoutFired && matrixScore <= 55) return;

            let signalType = 'uptrend';
            if (breakouts.find((b) => b.triggered && b.type === '箱型整理突破')) {
              signalType = 'box';
            } else if (breakouts.find((b) => b.triggered && b.type === '下跌V轉突破')) {
              signalType = 'vreversal';
            }

            if (type !== 'all' && signalType !== type) return;
            if (industry && sector !== industry) return;

            const confidence = breakoutFired
              ? Math.max(...breakouts.filter((b) => b.triggered).map((b) => b.confidence ?? 50))
              : matrixScore;

            results.push({ symbol, name_zh, sector, confidence, signalType, matrixScore, breakouts });
          } catch {
            // skip
          }
        })
      );
    }

    results.sort((a, b) => b.confidence - a.confidence);
    const top100 = results.slice(0, 100);

    return NextResponse.json(
      {
        results: top100,
        totalScanned: symbols.length,
        signalCounts: {
          uptrend:   top100.filter((r) => r.signalType === 'uptrend').length,
          box:       top100.filter((r) => r.signalType === 'box').length,
          vreversal: top100.filter((r) => r.signalType === 'vreversal').length,
        },
      },
      { headers: { 'Cache-Control': 's-maxage=3600' } }
    );
  } catch (error) {
    console.error('Scanner error:', error);
    return NextResponse.json({ error: 'Scanner failed' }, { status: 500 });
  }
}