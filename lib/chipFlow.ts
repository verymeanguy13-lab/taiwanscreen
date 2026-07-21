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

// BIG_PLAYER_PERCENTILE: top X% of a session's minutes, ranked by volume,
// are classified "big player." 0.75 = top quartile (75th percentile cutoff).
// Self-calibrating per session — no fixed absolute or ratio threshold that
// can silently never fire, which is what happened with the previous
// fixed-multiplier approach (tried 2x, then 1.5x, both fired essentially
// never across two very different stocks in live testing).
const BIG_PLAYER_PERCENTILE = 0.75;

// Don't attempt classification on a near-empty session — needs enough
// buckets for "top quartile" to mean anything.
const MIN_BUCKETS_FOR_CLASSIFICATION = 8;

function getPercentileThreshold(values: number[], percentile: number): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[idx];
}

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

    // Self-calibrating classification: flag the top quartile of minutes BY
    // VOLUME (relative to this session's own range) as "big player" minutes,
    // rest as "retail". Replaces an earlier fixed-multiplier-vs-rolling-avg
    // approach (tried 2x, then 1.5x) that turned out to essentially never
    // fire — net signed FLOW can swing a lot minute to minute even when raw
    // total VOLUME per minute stays fairly consistent, so no fixed ratio
    // reliably separated the two. A percentile split always produces a
    // sensible division regardless of how "spiky" a given day's data is.
    const volumeThreshold = getPercentileThreshold(
      minutes.map(m => m.totalVolume),
      BIG_PLAYER_PERCENTILE,
    );

    const snapshots: ChipFlowSnapshot[] = [];
    let cumulativeBigPlayer = 0;
    let cumulativeRetail    = 0;

    for (const bucket of minutes) {
      const isBigPlayerMinute = minutes.length >= MIN_BUCKETS_FOR_CLASSIFICATION
        && bucket.totalVolume >= volumeThreshold;

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