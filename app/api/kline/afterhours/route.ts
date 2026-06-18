import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { computeIndicators } from '@/lib/indicators';
import { evaluateAfterHours } from '@/lib/bullbearSignals';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all'; // 'all' | 'bull' | 'bear'

  try {
    // Fetch symbols with recent price data
    const symbolRows = await sql`
      SELECT DISTINCT dp.symbol, s.name_zh, s.sector
      FROM daily_prices dp
      JOIN stocks s ON s.symbol = dp.symbol
      WHERE dp.date >= NOW() - INTERVAL '5 days'
      ORDER BY dp.symbol
    `;

    const symbols = symbolRows as { symbol: string; name_zh: string; sector: string }[];

    const bull: Array<{ symbol: string; name_zh: string; sector: string; score: number; signals: string[] }> = [];
    const bear: Array<{ symbol: string; name_zh: string; sector: string; score: number; signals: string[] }> = [];

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
              LIMIT 90
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

            const indicators = computeIndicators(candles);

            // Use evaluateAfterHours — the original function from lib/bullbearSignals.ts
            const afterHours = evaluateAfterHours(candles, indicators);

            if (afterHours.bull.length > 0 && (type === 'all' || type === 'bull')) {
              bull.push({
                symbol,
                name_zh,
                sector,
                score: afterHours.bull.length * 10,
                signals: afterHours.bull,
              });
            }

            if (afterHours.bear.length > 0 && (type === 'all' || type === 'bear')) {
              bear.push({
                symbol,
                name_zh,
                sector,
                score: afterHours.bear.length * 10,
                signals: afterHours.bear,
              });
            }
          } catch {
            // Skip erroring stocks
          }
        })
      );
    }

    // Sort by score desc
    bull.sort((a, b) => b.score - a.score);
    bear.sort((a, b) => b.score - a.score);

    return NextResponse.json(
      { bull: bull.slice(0, 50), bear: bear.slice(0, 50) },
      {
        headers: {
          'Cache-Control': 's-maxage=3600',
        },
      }
    );
  } catch (error) {
    console.error('Afterhours scanner error:', error);
    return NextResponse.json({ error: 'After hours scanner failed' }, { status: 500 });
  }
}