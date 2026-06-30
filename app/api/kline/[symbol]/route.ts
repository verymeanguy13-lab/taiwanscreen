// =============================================================================
// app/api/kline/[symbol]/route.ts
// GET /api/kline/[symbol]
// Returns 90 days of OHLCV candles + all technical indicators + scores.
// During market hours (9:00–13:30 Taiwan time), the last candle is replaced
// with the live intraday quote so scores reflect today's price action.
// Cache: s-maxage=60 during market hours, s-maxage=300 after close.
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
// Helper: is the Taiwan market currently open?
// Market hours: Monday–Friday, 09:00–13:30 Taiwan time (UTC+8)
// ---------------------------------------------------------------------------
function isTaiwanMarketOpen(): boolean {
  const now = new Date();
  const taiwanMs = now.getTime() + 8 * 60 * 60 * 1000;
  const taiwan = new Date(taiwanMs);
  const day = taiwan.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const hour = taiwan.getUTCHours();
  const min  = taiwan.getUTCMinutes();
  const totalMin = hour * 60 + min;
  return totalMin >= 9 * 60 && totalMin < 13 * 60 + 30;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const isMarketOpen = isTaiwanMarketOpen();

  // Shorter cache during market hours so live price stays fresh
  const cacheTTL = isMarketOpen ? 60 : 300;
  const cacheKey = `kline:${symbol}:${isMarketOpen ? 'live' : 'eod'}`;

  try {
    const result = await cached(cacheKey, cacheTTL, async () => {
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

      if (priceRows.length < 5) {
        return null;
      }

      // Map DB rows → Candle[]
      let candles: Candle[] = priceRows.map((r) => ({
        open:   Number(r.open),
        high:   Number(r.high),
        low:    Number(r.low),
        close:  Number(r.close),
        volume: Number(r.volume),
        date:   r.date,
      }));

      // ── 2. Live price injection during market hours ───────────────────────
      // Replace or append today's candle with the live quote so the score
      // reflects what's happening RIGHT NOW, not yesterday's close.
      // Uses the same /api/quote endpoint the StockClient already calls.
      let isLive = false;
      if (isMarketOpen) {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://taiwanscreen.vercel.app';
          const quoteRes = await fetch(`${baseUrl}/api/quote/${symbol}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (quoteRes.ok) {
            const quoteJson = await quoteRes.json();
            const q = quoteJson; // { close, open, high, low, volume, change_pct, isLive, time }
            if (q?.close && q.close > 0) {
              const todayStr = new Date(new Date().getTime() + 8 * 60 * 60 * 1000)
                .toISOString().slice(0, 10);
              const lastCandle = candles[candles.length - 1];

              const liveCandle: Candle = {
                date:   todayStr,
                open:   Number(q.open   ?? lastCandle.close), // use prev close if open missing
                high:   Number(q.high   ?? q.close),
                low:    Number(q.low    ?? q.close),
                close:  Number(q.close),
                volume: Number(q.volume ?? 0),
              };

              if (lastCandle.date === todayStr) {
                // Today's EOD row already exists — overwrite it with live data
                candles[candles.length - 1] = liveCandle;
              } else {
                // Today not yet in DB — append as new candle
                candles = [...candles, liveCandle];
              }
              isLive = true;
            }
          }
        } catch (err) {
          // Live quote failed — fall through and use DB data
          console.warn(`[kline/${symbol}] Live quote fetch failed:`, err);
        }
      }

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

      const indicatorSnapshot = {
        sma5, sma20, sma60, rsi14,
        macd: macdData,
        kd:   { k: kdjData.k, d: kdjData.d },
        bb:   bbData,
        obv:  obvData,
        volRatio: volRatioData,
      };

      // ── 4. Pattern & breakout analysis ───────────────────────────────────
      const breakouts      = detectAllBreakouts(candles, { sma5, sma20, sma60, rsi14, macd: macdData });
      const patterns       = detectPatterns(candles);
      const matrix         = evaluateSignalMatrix(candles, indicatorSnapshot);
      const afterHours     = evaluateAfterHours(candles, { sma5, sma20, sma60, bb: bbData });
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

      // ── 7. Return payload ─────────────────────────────────────────────────
      return {
        candles,
        indicators,
        breakouts,
        patterns,
        matrix,
        score,
        afterHours,
        yesterdayTrend,
        isLive, // tells the UI whether score uses live or EOD data
      };
    });

    if (result === null) {
      return NextResponse.json(
        { message: 'Data insufficient' },
        { status: 404 },
      );
    }

    // Shorter cache header during market hours
    const cacheHeader = isMarketOpen
      ? 's-maxage=60, stale-while-revalidate=30'
      : 's-maxage=300, stale-while-revalidate=60';

    return NextResponse.json(result, {
      headers: { 'Cache-Control': cacheHeader },
    });

  } catch (err) {
    console.error('[kline/symbol] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}