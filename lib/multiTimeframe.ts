// =============================================================================
// lib/multiTimeframe.ts
// Session 65 — Multi-timeframe Trend View (短長線同步看盤)
//
// Derives weekly and monthly candles from the existing daily_prices table —
// no extra API/data-source call, matching how CandlestickChart.tsx already
// aggregates weekly/monthly for its own W/M toggle (same aggregation logic,
// duplicated here rather than importing from that component, since those
// helpers aren't exported and this keeps the working chart file untouched).
// =============================================================================

import { queryUnsafe } from '@/lib/db';
import { cached }      from '@/lib/cache';
import { sma, detectBox } from '@/lib/indicators';
import type { Candle } from '@/types';

export type Trend = 'strong_up' | 'up' | 'neutral' | 'down' | 'strong_down';

export type KeyLevel = {
  price:    number;
  type:     'support' | 'resistance';
  strength: number; // 0–100, derived from how tightly price has respected the level
};

export type TimeframeData = {
  timeframe:  'daily' | 'weekly' | 'monthly';
  candles:    Candle[];
  trend:      Trend;
  trendScore: number; // -100 to +100
  keyLevels:  KeyLevel[];
};

// ---------------------------------------------------------------------------
// Aggregation — mirrors CandlestickChart.tsx's local aggregateWeekly/Monthly
// ---------------------------------------------------------------------------

function aggregateWeekly(candles: Candle[]): Candle[] {
  const weeks: Record<string, Candle> = {};
  for (const c of candles) {
    const d = new Date(c.date! + 'T00:00:00Z');
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d); mon.setUTCDate(diff);
    const key = mon.toISOString().slice(0, 10);
    if (!weeks[key]) {
      weeks[key] = { ...c, date: key };
    } else {
      weeks[key].high   = Math.max(weeks[key].high, c.high);
      weeks[key].low    = Math.min(weeks[key].low,  c.low);
      weeks[key].close  = c.close;
      weeks[key].volume = (weeks[key].volume ?? 0) + (c.volume ?? 0);
    }
  }
  return Object.values(weeks).sort((a, b) => a.date!.localeCompare(b.date!));
}

function aggregateMonthly(candles: Candle[]): Candle[] {
  const months: Record<string, Candle> = {};
  for (const c of candles) {
    const key = c.date!.slice(0, 7);
    if (!months[key]) {
      months[key] = { ...c, date: `${key}-01` };
    } else {
      months[key].high   = Math.max(months[key].high, c.high);
      months[key].low    = Math.min(months[key].low,  c.low);
      months[key].close  = c.close;
      months[key].volume = (months[key].volume ?? 0) + (c.volume ?? 0);
    }
  }
  return Object.values(months).sort((a, b) => a.date!.localeCompare(b.date!));
}

// ---------------------------------------------------------------------------
// Trend classification — price vs MA20 + slope of MA20
// ---------------------------------------------------------------------------

function classifyTrend(candles: Candle[]): { trend: Trend; trendScore: number } {
  const closes = candles.map(c => c.close);
  const ma20   = sma(closes, 20);

  const lastMA = ma20[ma20.length - 1];
  const lastClose = closes[closes.length - 1];

  if (lastMA == null || lastClose == null) {
    return { trend: 'neutral', trendScore: 0 };
  }

  // Slope: compare current MA20 to MA20 five bars ago (or as far back as available)
  const slopeLookback = Math.min(5, ma20.length - 1);
  const priorMA = ma20[ma20.length - 1 - slopeLookback];

  const priceVsMA = ((lastClose - lastMA) / lastMA) * 100;
  const slopeVsMA = priorMA != null && priorMA !== 0
    ? ((lastMA - priorMA) / priorMA) * 100
    : 0;

  // Slope weighted more heavily — direction of the average matters more
  // than momentary distance from it for a "trend" read.
  const raw = priceVsMA * 3 + slopeVsMA * 6;
  const trendScore = Math.max(-100, Math.min(100, Math.round(raw)));

  let trend: Trend = 'neutral';
  if (trendScore >= 40)      trend = 'strong_up';
  else if (trendScore >= 10) trend = 'up';
  else if (trendScore <= -40) trend = 'strong_down';
  else if (trendScore <= -10) trend = 'down';

  return { trend, trendScore };
}

// ---------------------------------------------------------------------------
// Key levels — reuses lib/indicators.ts's detectBox as a simple, consistent
// support/resistance pair (highest high / lowest low over a lookback window),
// with strength derived from how box-like (tightly respected) that range is.
// ---------------------------------------------------------------------------

function getKeyLevels(candles: Candle[]): KeyLevel[] {
  const box = detectBox(candles, Math.min(20, candles.length));
  if (!box) return [];

  const strength = Math.min(100, Math.round((box.duration / 20) * 100));

  return [
    { price: box.upper, type: 'resistance', strength },
    { price: box.lower, type: 'support',    strength },
  ];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function getMultiTimeframeData(symbol: string): Promise<TimeframeData[]> {
  return cached(`multiTimeframe:${symbol}`, 300, async () => {
    // ~800 days (~2.2 years) so monthly candles have enough history for a
    // meaningful MA20 (20 months back), not just enough for daily/weekly.
    const priceRows = await queryUnsafe<{
      date: string; open: number; high: number; low: number; close: number; volume: number;
    }>(
      `SELECT date, open, high, low, close, volume
       FROM daily_prices
       WHERE symbol = $1
         AND date >= CURRENT_DATE - INTERVAL '800 days'
       ORDER BY date ASC`,
      [symbol],
    );

    if (priceRows.length < 20) return [];

    // queryUnsafe returns Postgres DATE columns as native JS Date objects at
    // runtime, regardless of the declared `date: string` type above — that
    // type is a compile-time label only, not enforced. The existing kline
    // route never notices this because it never manipulates the value
    // directly; it just hands it to NextResponse.json(), which auto-converts
    // Date objects to ISO strings during serialization. This code does its
    // own date math (aggregateWeekly/Monthly) BEFORE any such serialization,
    // so it needs a real string up front or `.toISOString()` etc. crash with
    // "RangeError: Invalid time value" on the resulting garbage.
    const toDateStr = (d: unknown): string => {
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return String(d).slice(0, 10);
    };

    const dailyCandles: Candle[] = priceRows.map(r => ({
      open: Number(r.open), high: Number(r.high), low: Number(r.low),
      close: Number(r.close), volume: Number(r.volume), date: toDateStr(r.date),
    }));

    const weeklyCandles  = aggregateWeekly(dailyCandles);
    const monthlyCandles = aggregateMonthly(dailyCandles);

    const build = (timeframe: TimeframeData['timeframe'], candles: Candle[]): TimeframeData => {
      const { trend, trendScore } = classifyTrend(candles);
      return { timeframe, candles, trend, trendScore, keyLevels: getKeyLevels(candles) };
    };

    return [
      // Daily trimmed to the last 90 days to match the existing daily chart's
      // display window — still far more than the 20 candles MA20 needs.
      build('daily',   dailyCandles.slice(-90)),
      build('weekly',  weeklyCandles),
      build('monthly', monthlyCandles),
    ];
  });
}