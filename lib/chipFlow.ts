// =============================================================================
// lib/chipFlow.ts
// Session 63 — Intraday Chip Flow Dashboard (盤中籌碼動向)
//
// 股市籌碼K線's paid "籌碼動向" feature shows intraday big-player vs retail
// chip flow. This builds a free proxy version on top of the existing
// lib/fugle.ts tick-level data client (already live in production via
// /api/quote, /api/kline — not a new/unproven data source).
//
// Method (per spec):
//   1. Bucket raw ticks into synthetic 1-minute candles.
//   2. A minute is classified "big player" if its total volume exceeds 2x
//      the rolling 5-minute average volume — a volume-spike proxy for block
//      trades. All other minutes are classified "retail".
//   3. Net signed volume per minute (buy ticks minus sell ticks) is
//      attributed entirely to whichever class that minute belongs to.
//   4. Cumulative totals run from market open (09:00) through the ticks
//      returned for "today" — Fugle's intraday tick endpoint naturally
//      resets each trading day, so no explicit reset logic is needed.
// =============================================================================

import { getFugleTicks, isMarketOpen, type IntradayTick } from '@/lib/fugle';

export type ChipFlowSnapshot = {
  symbol:               string;
  time:                 string;  // HH:MM
  bigPlayerFlow:        number;  // net lots this minute; positive = net buying
  retailFlow:           number;  // net lots this minute; positive = net buying
  price:                number;
  volume:               number;  // total lots this minute
  cumulativeBigPlayer:  number;  // running total since open
  cumulativeRetail:     number;  // running total since open
};

export type ChipFlowSummary = {
  bigPlayerNetLots:    number;
  retailNetLots:       number;
  bigPlayerDominance:  number;   // 0–100%, share of total volume from big-player minutes
  signal:              'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
};

const ROLLING_WINDOW   = 5;   // minutes
// Tuned down from an initial 2x guess to 1.5x after live testing on both a
// mega-cap (2330, low volume-of-day variance) and a volatile mid-cap (3661)
// showed 2x essentially never fires — 主力 stayed at 0 all session on both.
// 1.5x is more forgiving while still requiring a genuine above-normal
// minute, not just noise. Worth revisiting after watching a few more days
// of real data if it now fires TOO often instead.
const SPIKE_MULTIPLIER = 1.5;

interface MinuteBucket {
  time:        string;  // HH:MM
  totalVolume: number;  // lots
  netSigned:   number;  // buy lots − sell lots
  lastPrice:   number;
}

function bucketTicksByMinute(ticks: IntradayTick[]): MinuteBucket[] {
  const buckets = new Map<string, MinuteBucket>();

  for (const t of ticks) {
    const minute = t.time.slice(0, 5); // "09:01:23" -> "09:01"
    const signed = t.side === 'B' ? t.volume : t.side === 'S' ? -t.volume : 0;

    const existing = buckets.get(minute);
    if (existing) {
      existing.totalVolume += t.volume;
      existing.netSigned   += signed;
      existing.lastPrice    = t.price; // ticks arrive in order, so last wins
    } else {
      buckets.set(minute, {
        time: minute,
        totalVolume: t.volume,
        netSigned: signed,
        lastPrice: t.price,
      });
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time.localeCompare(b.time));
}

export async function getIntradayChipFlow(symbol: string): Promise<ChipFlowSnapshot[]> {
  try {
    const ticks = await getFugleTicks(symbol);
    if (ticks.length === 0) return [];

    const minutes = bucketTicksByMinute(ticks);

    const snapshots: ChipFlowSnapshot[] = [];
    let cumulativeBigPlayer = 0;
    let cumulativeRetail    = 0;

    for (let i = 0; i < minutes.length; i++) {
      const bucket = minutes[i];

      // Rolling 5-min average volume from the minutes BEFORE this one
      // (falls back to however many preceding minutes exist near the open).
      const windowStart = Math.max(0, i - ROLLING_WINDOW);
      const priorWindow  = minutes.slice(windowStart, i);
      const rollingAvg   = priorWindow.length > 0
        ? priorWindow.reduce((sum, m) => sum + m.totalVolume, 0) / priorWindow.length
        : bucket.totalVolume; // first minute: no prior data, treat as baseline (not a spike)

      const isBigPlayerMinute = priorWindow.length > 0 && bucket.totalVolume > rollingAvg * SPIKE_MULTIPLIER;

      const bigPlayerFlow = isBigPlayerMinute ? bucket.netSigned : 0;
      const retailFlow    = isBigPlayerMinute ? 0 : bucket.netSigned;

      cumulativeBigPlayer += bigPlayerFlow;
      cumulativeRetail    += retailFlow;

      snapshots.push({
        symbol,
        time: bucket.time,
        bigPlayerFlow,
        retailFlow,
        price: bucket.lastPrice,
        volume: bucket.totalVolume,
        cumulativeBigPlayer,
        cumulativeRetail,
      });
    }

    return snapshots;
  } catch (err) {
    console.error(`[chipFlow] getIntradayChipFlow error for ${symbol}:`, err);
    return [];
  }
}

export async function getChipFlowSummary(symbol: string): Promise<ChipFlowSummary> {
  const snapshots = await getIntradayChipFlow(symbol);

  if (snapshots.length === 0) {
    return { bigPlayerNetLots: 0, retailNetLots: 0, bigPlayerDominance: 0, signal: 'neutral' };
  }

  const last = snapshots[snapshots.length - 1];
  const bigPlayerNetLots = last.cumulativeBigPlayer;
  const retailNetLots    = last.cumulativeRetail;

  const totalBigPlayerVolume = snapshots.reduce((s, snap) => s + (snap.bigPlayerFlow !== 0 ? snap.volume : 0), 0);
  const totalVolume          = snapshots.reduce((s, snap) => s + snap.volume, 0);
  const bigPlayerDominance   = totalVolume > 0 ? Math.round((totalBigPlayerVolume / totalVolume) * 100) : 0;

  let signal: ChipFlowSummary['signal'] = 'neutral';
  if (bigPlayerNetLots > 0) {
    signal = bigPlayerDominance >= 60 ? 'strong_buy' : 'buy';
  } else if (bigPlayerNetLots < 0) {
    signal = bigPlayerDominance >= 60 ? 'strong_sell' : 'sell';
  }

  return { bigPlayerNetLots, retailNetLots, bigPlayerDominance, signal };
}

export { isMarketOpen };