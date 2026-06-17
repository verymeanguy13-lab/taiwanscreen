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
    // ── Get latest signal date ──────────────────────────────────────────────
    const dateRows = await queryUnsafe<{ max: string }>(
      `SELECT MAX(signal_date)::text AS max FROM signal_results`,
      [],
    );
    const latestDate = String(dateRows[0]?.max ?? '').slice(0, 10);

    if (!latestDate) {
      return NextResponse.json({ results: [], totalScanned: 0, signalCounts: {} });
    }

    // ── Fetch today's signals joined with stock info and latest price ───────
    const rows = await queryUnsafe<{
      symbol:       string;
      name_zh:      string;
      sector:       string;
      signal_type:  string;
      entry_price:  number;
      confidence:   number;
      close:        number;
      prev_close:   number;
      volume:       number;
    }>(
      `SELECT
         sr.symbol,
         s.name_zh,
         COALESCE(s.sector, '') AS sector,
         sr.signal_type,
         sr.entry_price,
         sr.confidence,
         dp.close,
         dp_prev.close AS prev_close,
         dp.volume
       FROM signal_results sr
       JOIN stocks s ON s.symbol = sr.symbol
       LEFT JOIN daily_prices dp
         ON dp.symbol = sr.symbol
         AND dp.date = $1
       LEFT JOIN daily_prices dp_prev
         ON dp_prev.symbol = sr.symbol
         AND dp_prev.date = (
           SELECT MAX(date) FROM daily_prices
           WHERE symbol = sr.symbol AND date < $1
         )
       WHERE sr.signal_date = $1
       AND sr.confidence >= 60
       ORDER BY sr.confidence DESC`,
      [latestDate],
    );

    // ── Get total stocks scanned (stocks with price data that day) ──────────
    const totalRows = await queryUnsafe<{ count: number }>(
      `SELECT COUNT(DISTINCT symbol)::int AS count
       FROM daily_prices WHERE date = $1`,
      [latestDate],
    );
    const totalScanned = totalRows[0]?.count ?? 0;

    // ── Map signal_type to breakoutType for UI compatibility ────────────────
    const SIGNAL_TO_BREAKOUT: Record<string, string> = {
      '上漲趨勢突破': '上漲趨勢突破',
      '箱型整理突破': '箱型整理突破',
      '下跌V轉突破':  '下跌V轉突破',
      '突破趨勢線':   '上漲趨勢突破',
      '開布林':       '箱型整理突破',
      '剛轉多':       '下跌V轉突破',
      '昨日強勢股':   '上漲趨勢突破',
      '近五日強勢股': '上漲趨勢突破',
    };

    // Deduplicate — keep highest confidence signal per symbol
    const symbolMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      const existing = symbolMap.get(row.symbol);
      if (!existing || row.confidence > existing.confidence) {
        symbolMap.set(row.symbol, row);
      }
    }

    // Apply industry filter
    let filtered = Array.from(symbolMap.values());
    if (industry) {
      filtered = filtered.filter(r => r.sector === industry);
    }

    // Build results
    const results = filtered.map(r => {
      const close     = Number(r.close)     || Number(r.entry_price) || 0;
      const prevClose = Number(r.prev_close) || 0;
      const changePercent = prevClose > 0
        ? Math.round(((close - prevClose) / prevClose) * 10000) / 100
        : 0;

      return {
        symbol:       r.symbol,
        name_zh:      r.name_zh,
        sector:       r.sector,
        breakoutType: SIGNAL_TO_BREAKOUT[r.signal_type] ?? '上漲趨勢突破',
        signalLabel:  r.signal_type,
        confidence:   Number(r.confidence) || 50,
        matrixScore:  Number(r.confidence) || 50,
        price:        close,
        changePercent,
        volume:       Number(r.volume) || 0,
      };
    });

    // Sort by confidence desc
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