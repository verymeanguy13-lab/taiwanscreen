// =============================================================================
// app/api/kline/[symbol]/route.ts
// GET /api/kline/[symbol]
// Returns 90 days of OHLCV candles + all technical indicators + scores.
// Cache: s-maxage=300 (5 minutes)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';
import type { Candle } from '@/types';
import type { InstitutionalFlow, MarginData } from '@/types';

import {
  sma, rsi as calcRsi, macd as calcMacd, kdj,
  bollingerBands, atr, obv, volumeRatio,
} from '@/lib/indicators';

import { detectPatterns }       from '@/lib/patterns';
import { detectAllBreakouts }   from '@/lib/breakouts';
import { evaluateSignalMatrix } from '@/lib/signals';
import { computeScore }         from '@/lib/scoring';
import {
  evaluateAfterHours,
  classifyYesterdayTrend,
} from '@/lib/bullbearSignals';

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const cacheKey = `kline:${symbol}`;

  try {
    const result = await cached(cacheKey, 300, async () => {
      // ── 1. Fetch last 90 days of prices ──────────────────────────────────
      const priceRows = await queryUnsafe<{
        date:    string;
        open:    number;
        high:    number;
        low:     number;
        close:   number;
        volume:  number;
      }>(
        `SELECT date, open, high, low, close, volume
         FROM daily_prices
         WHERE symbol = $1
           AND date >= CURRENT_DATE - INTERVAL '90 days'
         ORDER BY date ASC`,
        [symbol],
      );

      // ── 2. Insufficient data guard ────────────────────────────────────────
      if (priceRows.length < 20) {
        return null; // signal 404 to caller
      }

      // Map DB rows → Candle[]
      const candles: Candle[] = priceRows.map((r) => ({
        open:   Number(r.open),
        high:   Number(r.high),
        low:    Number(r.low),
        close:  Number(r.close),
        volume: Number(r.volume),
        date:   r.date,
      }));

      // ── 3. Compute indicators ─────────────────────────────────────────────
      const closes  = candles.map((c) => c.close);
      const highs   = candles.map((c) => c.high);
      const lows    = candles.map((c) => c.low);
      const volumes = candles.map((c) => c.volume ?? 0);

      const sma5  = sma(closes, 5);
      const sma20 = sma(closes, 20);
      const sma60 = sma(closes, 60);
      const rsi14 = calcRsi(closes, 14);
      const macdData = calcMacd(closes);
      const kdjData  = kdj(highs, lows, closes);
      const bbData   = bollingerBands(closes);
      const atrData  = atr(candles, 14);
      const obvData  = obv(candles);
      const volRatioData = volumeRatio(volumes, 5);

      const indicators = {
        sma5, sma20, sma60, rsi14,
        macd: macdData,
        kdj:  kdjData,
        bb:   bbData,
        atr:  atrData,
        obv:  obvData,
        volumeRatio: volRatioData,
      };

      // Snapshot shape used by breakouts / signals
      const indicatorSnapshot = {
        sma5, sma20, sma60, rsi14,
        macd: macdData,
        kd:   { k: kdjData.k, d: kdjData.d },
        bb:   bbData,
        obv:  obvData,
        volRatio: volRatioData,
      };

      // ── 4. Pattern & breakout analysis ───────────────────────────────────
      const breakouts    = detectAllBreakouts(candles, { sma5, sma20, sma60, rsi14, macd: macdData });
      const patterns     = detectPatterns(candles);
      const matrix       = evaluateSignalMatrix(candles, indicatorSnapshot);
      const afterHours   = evaluateAfterHours(candles, { sma5, sma20, sma60, bb: bbData });
      const yesterdayTrend = classifyYesterdayTrend(candles, { sma5, sma20, sma60, bb: bbData });

      // ── 5. Fetch institutional + margin (last 30 days) ───────────────────
      const [instRows, marginRows] = await Promise.all([
        queryUnsafe<InstitutionalFlow>(
          `SELECT symbol, date, foreign_net, trust_net, dealer_net, total_net,
                  foreign_consecutive_days, trust_consecutive_days, triple_buy
           FROM institutional_flows
           WHERE symbol = $1
             AND date >= CURRENT_DATE - INTERVAL '30 days'
           ORDER BY date ASC`,
          [symbol],
        ),
        queryUnsafe<MarginData>(
          `SELECT symbol, date, margin_balance, margin_change,
                  short_balance, short_change, margin_ratio
           FROM margin_data
           WHERE symbol = $1
             AND date >= CURRENT_DATE - INTERVAL '30 days'
           ORDER BY date ASC`,
          [symbol],
        ),
      ]);

      // ── 6. Compute composite score ────────────────────────────────────────
      const score = computeScore(candles, instRows, marginRows);

      // ── 7. Return payload ────────────────────────────────────────────────
      return {
        candles,
        indicators,
        breakouts,
        patterns,
        matrix,
        score,
        afterHours,
        yesterdayTrend,
      };
    });

    // Insufficient data
    if (result === null) {
      return NextResponse.json(
        { message: 'Data insufficient' },
        { status: 404 },
      );
    }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' },
    });

  } catch (err) {
    console.error('[kline/symbol] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
