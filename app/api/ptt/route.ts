// =============================================================================
// app/api/ptt/route.ts
// GET /api/ptt?symbol=2330
// GET /api/ptt/trending
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

export async function GET(req: NextRequest) {
  const { searchParams, pathname } = req.nextUrl;

  // ── Trending endpoint ──────────────────────────────────────────────────────
  if (pathname.endsWith('/trending')) {
    try {
      const result = await cached('ptt:trending', 4 * 60 * 60, async () => {
        const rows = await queryUnsafe<{
          symbol:          string;
          name_zh:         string;
          mention_count:   number;
          sentiment_score: number;
        }>(
          `SELECT pm.symbol, s.name_zh, pm.mention_count, pm.sentiment_score
           FROM ptt_mentions pm
           JOIN stocks s ON pm.symbol = s.symbol
           WHERE pm.date = (SELECT MAX(date) FROM ptt_mentions)
           ORDER BY pm.mention_count DESC
           LIMIT 10`,
          [],
        );
        return rows;
      });
      return NextResponse.json(result);
    } catch (err) {
      console.error('[ptt/trending] Error:', err);
      return NextResponse.json([], { status: 200 });
    }
  }

  // ── Per-symbol endpoint ────────────────────────────────────────────────────
  const symbol = searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json({ error: 'symbol required' }, { status: 400 });
  }

  const cacheKey = `ptt:symbol:${symbol}`;

  try {
    const result = await cached(cacheKey, 4 * 60 * 60, async () => {
      const rows = await queryUnsafe<{
        date:            string;
        mention_count:   number;
        sentiment_score: number;
      }>(
        `SELECT date::text, mention_count, sentiment_score
         FROM ptt_mentions
         WHERE symbol = $1
           AND date >= NOW() - INTERVAL '7 days'
         ORDER BY date DESC
         LIMIT 7`,
        [symbol],
      );

      if (!rows.length) {
        return {
          today:            null,
          week_avg_mentions: 0,
          sentiment_trend:  0,
          sample_titles:    [],
        };
      }

      const today         = rows[0];
      const week_avg      = rows.reduce((s, r) => s + r.mention_count, 0) / rows.length;
      const sentiment_avg = rows.reduce((s, r) => s + r.sentiment_score, 0) / rows.length;

      return {
        today:             today.mention_count,
        week_avg_mentions: parseFloat(week_avg.toFixed(1)),
        sentiment_trend:   parseFloat(sentiment_avg.toFixed(4)),
        sample_titles:     [],
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[ptt] Error:', err);
    return NextResponse.json(
      { today: null, week_avg_mentions: 0, sentiment_trend: 0, sample_titles: [] },
      { status: 200 },
    );
  }
}