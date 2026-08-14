// =============================================================================
// lib/signalConfidence.ts
//
// Replaces hardcoded, guessed confidence weights (e.g. "剛轉多: 18" — a
// number someone picked, loosely justified by an ad hoc comment claiming
// "75%") with a REAL confidence score computed from that signal type's own
// actual historical win rate + average return in signal_results.
//
// This does NOT make breakout prediction "accurate" — no simple rule system
// can promise that. What it fixes: the confidence number a user sees now
// means what it claims to mean (a measured historical win rate for THIS
// exact signal type), instead of being a static guess dressed up as a
// precise-looking score.
// =============================================================================

import { queryUnsafe } from '@/lib/db';

const MIN_SAMPLE_SIZE = 30; // below this, the win rate is too noisy to trust
const DEFAULT_CONFIDENCE = 50; // neutral — "no evidence either way yet"

/**
 * Real, evidence-based confidence for a signal type, computed from its own
 * 5-day track record in signal_results.
 *
 * For bull signals: win = price went UP (price_up_5d = true).
 * For bear signals: win = price went DOWN (price_up_5d = false) — inverted,
 * since a bearish call that's followed by a decline is the "win" case.
 *
 * Blends win rate (70% weight) with average return, normalized into a
 * 0–100 scale (30% weight) — win rate matters more since it's more
 * robust to a handful of outlier trades skewing the average.
 *
 * Falls back to a neutral 50 if there isn't enough history yet (new signal
 * type, or one that rarely fires) — an untested signal should not be shown
 * with false confidence in either direction.
 */
export async function getBacktestedConfidence(
  signalType: string,
  isBearSignal: boolean,
): Promise<{ confidence: number; sampleSize: number; winRate: number | null }> {
  try {
    const rows = await queryUnsafe<{ n: string; win_rate: string | null; avg_ret: string | null }>(
      `SELECT
         COUNT(*) as n,
         ROUND(100.0 * SUM(CASE WHEN price_up_5d = $2 THEN 1 ELSE 0 END) / NULLIF(COUNT(return_5d), 0), 1) as win_rate,
         ROUND(AVG(return_5d)::numeric, 2) as avg_ret
       FROM signal_results
       WHERE signal_type = $1 AND return_5d IS NOT NULL`,
      [signalType, !isBearSignal], // bull: win = price_up_5d TRUE; bear: win = price_up_5d FALSE
    );

    const row = rows[0];
    const n = Number(row?.n ?? 0);

    if (n < MIN_SAMPLE_SIZE || row?.win_rate == null) {
      return { confidence: DEFAULT_CONFIDENCE, sampleSize: n, winRate: null };
    }

    const winRate = Number(row.win_rate);
    const avgRet  = Number(row.avg_ret ?? 0);

    // For bear signals, a "good" avg_ret is NEGATIVE (predicted the decline).
    // Normalize direction so both cases push confidence the same way.
    const directionalRet = isBearSignal ? -avgRet : avgRet;

    // Normalize avg return into a rough 0–100 contribution — ±5% treated as
    // a reasonably strong signal, clamped at the extremes.
    const retScore = Math.max(0, Math.min(100, 50 + directionalRet * 10));

    const confidence = Math.round(winRate * 0.7 + retScore * 0.3);

    return { confidence: Math.max(0, Math.min(100, confidence)), sampleSize: n, winRate };
  } catch (err) {
    console.error(`[signalConfidence] Error for ${signalType}:`, err);
    return { confidence: DEFAULT_CONFIDENCE, sampleSize: 0, winRate: null };
  }
}

/**
 * Batch version — computes confidence for every signal type in one go,
 * to avoid N separate DB round-trips when generating a full day's signals
 * across ~100 stocks.
 */
export async function getAllBacktestedConfidence(
  bullTypes: string[],
  bearTypes: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  await Promise.all([
    ...bullTypes.map(async (t) => {
      result[t] = (await getBacktestedConfidence(t, false)).confidence;
    }),
    ...bearTypes.map(async (t) => {
      result[t] = (await getBacktestedConfidence(t, true)).confidence;
    }),
  ]);
  return result;
}