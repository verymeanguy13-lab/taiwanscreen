// =============================================================================
// app/api/kline/scanner/route.ts
// GET /api/kline/scanner?type=all|uptrend|box|vreversal&industry=xxx
//
// Reads from signal_results table (populated by detect-signals cron).
// No live recalculation — fast and consistent with what was detected.
// Cache: s-maxage=300 (5 minutes)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const industry = searchParams.get('industry') ?? '';

  try {
    const dateRows = await queryUnsafe<{ max: string }>(
      `SELECT MAX(signal_date)::text AS max FROM signal_results`,
      [],
    );
    const latestDate = String(dateRows[0]?.max ?? '').slice(0, 10);

    if (!latestDate) {
      return NextResponse.json({ results: [], totalScanned: 0, signalCounts: {} });
    }

    const rows = await queryUnsafe<{
      symbol:      string;
      name_zh:     string;
      sector:      string;
      signal_type: string;
      entry_price: number;
      confidence:  number;
      close:       number;
      change_pct:  number;
      volume:      number;
    }>(
      `SELECT
         sr.symbol,
         s.name_zh,
         COALESCE(s.sector, '') AS sector,
         sr.signal_type,
         sr.entry_price,
         sr.confidence,
         dp.close,
         dp.change_pct,
         dp.volume
       FROM signal_results sr
       JOIN stocks s ON s.symbol = sr.symbol
       JOIN daily_prices dp
         ON dp.symbol = sr.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices LIMIT 1)
       WHERE sr.signal_date = $1
       AND sr.confidence >= 50
       AND sr.signal_type NOT IN ('近十日強勢股', '__sentinel__')
       ORDER BY sr.confidence DESC`,
      [latestDate],
    );

    const totalRows = await queryUnsafe<{ count: number }>(
      `SELECT COUNT(DISTINCT symbol)::int AS count
       FROM daily_prices WHERE date = $1`,
      [latestDate],
    );
    const totalScanned = totalRows[0]?.count ?? 0;

    // Deduplicate: keep highest confidence signal per symbol
    const symbolMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      const existing = symbolMap.get(row.symbol);
      if (!existing || row.confidence > existing.confidence) {
        symbolMap.set(row.symbol, row);
      }
    }

    let filtered = Array.from(symbolMap.values());
    if (industry) {
      filtered = filtered.filter(r => r.sector === industry);
    }

    // breakoutType now shows the TRUE, raw signal_type — no more cosmetic
    // remapping. The previous SIGNAL_TO_BREAKOUT table relabeled several
    // different, looser momentum signals (開布林, 剛轉多, 昨日強勢股,
    // 近五日強勢股, 突破趨勢線) as if they were one of the three strict
    // detectAllBreakouts() categories. That made the rankings page disagree
    // with the accuracy page, which correctly counts by the real stored
    // type — a stock tagged 開布林 here would show 0 occurrences under
    // 箱型整理突破 on /accuracy, since it was never actually that type.
    const results = filtered.map(r => ({
      symbol:        r.symbol,
      name_zh:       r.name_zh,
      sector:        r.sector,
      breakoutType:  r.signal_type,
      signalLabel:   r.signal_type,
      confidence:    Number(r.confidence) || 50,
      matrixScore:   Number(r.confidence) || 50,
      price:         Number(r.close) || Number(r.entry_price) || 0,
      changePercent: Number(r.change_pct) || 0,
      volume:        Number(r.volume) || 0,
    }));

    results.sort((a, b) => b.confidence - a.confidence);

    const signalCounts = {
      uptrend:   results.filter(r => r.breakoutType === '上漲趨勢突破').length,
      box:       results.filter(r => r.breakoutType === '箱型整理突破').length,
      vreversal: results.filter(r => r.breakoutType === '下跌V轉突破').length,
    };

    return NextResponse.json(
      { results, totalScanned, signalCounts, date: latestDate },
      { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=60' } },
    );

  } catch (err) {
    console.error('[kline/scanner] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}