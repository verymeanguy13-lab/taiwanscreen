import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sma, rsi, macd, kdj, bollingerBands, atr, obv, volumeRatio } from '@/lib/indicators';
import { evaluateAfterHours } from '@/lib/bullbearSignals';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'all';

  try {
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

            const closes  = candles.map(c => c.close);
            const volumes = candles.map(c => c.volume);
            const indicators = {
              sma5:          sma(closes, 5),
              sma20:         sma(closes, 20),
              sma60:         sma(closes, 60),
              rsi14:         rsi(closes, 14),
              macd:          macd(closes),
              kdj:           kdj(candles),
              bollinger:     bollingerBands(closes),
              atr14:         atr(candles),
              obv:           obv(candles),
              volumeRatio:   volumeRatio(volumes, 5),
            };

            const afterHours = evaluateAfterHours(candles, indicators);

            if (afterHours.bullScore > 0 && (type === 'all' || type === 'bull')) {
              bull.push({
                symbol,
                name_zh,
                sector,
                score: afterHours.bullScore,
                signals: afterHours.bullStrategies.map((s: any) => s.name ?? s),
              });
            }

            if (afterHours.bearScore > 0 && (type === 'all' || type === 'bear')) {
              bear.push({
                symbol,
                name_zh,
                sector,
                score: afterHours.bearScore,
                signals: afterHours.bearStrategies.map((s: any) => s.name ?? s),
              });
            }
          } catch {
            // skip
          }
        })
      );
    }

    bull.sort((a, b) => b.score - a.score);
    bear.sort((a, b) => b.score - a.score);

    return NextResponse.json(
      { bull: bull.slice(0, 50), bear: bear.slice(0, 50) },
      { headers: { 'Cache-Control': 's-maxage=3600' } }
    );
  } catch (error) {
    console.error('Afterhours scanner error:', error);
    return NextResponse.json({ error: 'After hours scanner failed' }, { status: 500 });
  }
}