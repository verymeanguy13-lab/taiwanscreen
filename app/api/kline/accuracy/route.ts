// =============================================================================
// app/api/kline/accuracy/route.ts
// GET /api/kline/accuracy?signal_type=all&period=10d&industry=all&limit=100
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export interface SignalTypeStats {
  signal_type:    string;
  total_signals:  number;
  price_up_count: number;
  price_up_rate:  number;
  avg_return:     number;
  best_return:    number;
  worst_return:   number;
  median_return:  number;
  stocks_covered: number;
}

export interface MonthlyWinRate {
  month:          string;
  signal_type:    string;
  total:          number;
  price_up_count: number;
  price_up_rate:  number;
}

export interface SignalResult {
  id:            number;
  symbol:        string;
  signal_type:   string;
  signal_date:   string;
  entry_price:   number;
  price_5d:      number | null;
  price_10d:     number | null;
  price_20d:     number | null;
  return_5d:     number | null;
  return_10d:    number | null;
  return_20d:    number | null;
  price_up_5d:   boolean | null;
  price_up_10d:  boolean | null;
  price_up_20d:  boolean | null;
  breakout_type: string | null;
  confidence:    number | null;
  industry:      string | null;
}

const VALID_PERIODS = ['5d', '10d', '20d'] as const;
type Period = typeof VALID_PERIODS[number];

function priceUpCol(period: Period): string {
  return `price_up_${period.replace('d', '')}d`;
}
function returnCol(period: Period): string {
  return `return_${period.replace('d', '')}d`;
}
function priceCol(period: Period): string {
  return `price_${period.replace('d', '')}d`;
}

const EMPTY_RESPONSE = {
  stats: [], monthlyTrend: [], recentSignals: [],
  summary: { totalSignals: 0, priceUpRate: 0, avgReturn: 0, bestSignalType: '—', dataStartDate: '—' },
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const periodParam = searchParams.get('period')      ?? '10d';
  const signalType  = searchParams.get('signal_type') ?? 'all';
  const industry    = searchParams.get('industry')    ?? 'all';
  const limit       = Math.min(parseInt(searchParams.get('limit') ?? '100', 10), 500);

  // ── Fast early return if table is empty ──────────────────────────────────
  try {
    const countRow = await queryUnsafe<{ count: string }>(
      `SELECT COUNT(*) AS count FROM signal_results`,
      [],
    );
    if (parseInt(countRow[0]?.count ?? '0', 10) === 0) {
      return NextResponse.json(EMPTY_RESPONSE,
        { headers: { 'Cache-Control': 'no-store' } });
    }
  } catch {
    return NextResponse.json(EMPTY_RESPONSE, { status: 500 });
  }

  const period: Period = VALID_PERIODS.includes(periodParam as Period)
    ? (periodParam as Period) : '10d';

  const upCol  = priceUpCol(period);
  const retCol = returnCol(period);

  const industryFilter = industry !== 'all'
    ? `AND industry = '${industry.replace(/'/g, "''")}'`
    : '';
  const typeFilter = signalType !== 'all'
    ? `AND signal_type = '${signalType.replace(/'/g, "''")}'`
    : '';

  try {
    // ── Query 1: Stats per signal type ───────────────────────────────────────
    const statsRaw = await queryUnsafe<any>(
      `SELECT
         signal_type,
         COUNT(*)                                                     AS total_signals,
         SUM(CASE WHEN ${upCol} THEN 1 ELSE 0 END)                   AS price_up_count,
         ROUND(AVG(${retCol})::numeric, 2)                           AS avg_return,
         ROUND(MAX(${retCol})::numeric, 2)                           AS best_return,
         ROUND(MIN(${retCol})::numeric, 2)                           AS worst_return,
         ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP
               (ORDER BY ${retCol})::numeric, 2)                     AS median_return,
         COUNT(DISTINCT symbol)                                       AS stocks_covered
       FROM signal_results
       WHERE ${upCol} IS NOT NULL
         ${industryFilter}
       GROUP BY signal_type
       ORDER BY (SUM(CASE WHEN ${upCol} THEN 1 ELSE 0 END)::float
                 / NULLIF(COUNT(*), 0)) DESC`,
      [],
    );

    const stats: SignalTypeStats[] = statsRaw.map((r: any) => {
      const total = Number(r.total_signals);
      const up    = Number(r.price_up_count);
      return {
        signal_type:    r.signal_type,
        total_signals:  total,
        price_up_count: up,
        price_up_rate:  total > 0 ? Math.round((up / total) * 1000) / 10 : 0,
        avg_return:     Number(r.avg_return)    ?? 0,
        best_return:    Number(r.best_return)   ?? 0,
        worst_return:   Number(r.worst_return)  ?? 0,
        median_return:  Number(r.median_return) ?? 0,
        stocks_covered: Number(r.stocks_covered),
      };
    });

    // ── Query 2: Monthly win rate ─────────────────────────────────────────────
    const monthlyRaw = await queryUnsafe<any>(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', signal_date), 'YYYY-MM') AS month,
         signal_type,
         COUNT(*)                                              AS total,
         SUM(CASE WHEN ${upCol} THEN 1 ELSE 0 END)            AS price_up_count
       FROM signal_results
       WHERE signal_date >= NOW() - INTERVAL '12 months'
         AND ${upCol} IS NOT NULL
         ${industryFilter}
       GROUP BY 1, 2
       ORDER BY 1 DESC, 2`,
      [],
    );

    const monthlyTrend: MonthlyWinRate[] = monthlyRaw.map((r: any) => {
      const total = Number(r.total);
      const up    = Number(r.price_up_count);
      return {
        month:          r.month,
        signal_type:    r.signal_type,
        total,
        price_up_count: up,
        price_up_rate:  total > 0 ? Math.round((up / total) * 1000) / 10 : 0,
      };
    });

    // ── Query 3: Recent signals ───────────────────────────────────────────────
    const recentSignals = await queryUnsafe<SignalResult>(
      `SELECT * FROM signal_results
       WHERE ${upCol} IS NOT NULL
         ${typeFilter}
         ${industryFilter}
       ORDER BY signal_date DESC
       LIMIT $1`,
      [limit],
    );

    // ── Query 4: Summary ──────────────────────────────────────────────────────
    const summaryRaw = await queryUnsafe<any>(
      `SELECT
         COUNT(*)                                        AS total_signals,
         SUM(CASE WHEN ${upCol} THEN 1 ELSE 0 END)      AS price_up_count,
         ROUND(AVG(${retCol})::numeric, 2)              AS avg_return,
         TO_CHAR(MIN(signal_date), 'YYYY-MM-DD')         AS data_start
       FROM signal_results
       WHERE ${upCol} IS NOT NULL
         ${industryFilter}`,
      [],
    );

    const sr         = summaryRaw[0];
    const totalSig   = Number(sr?.total_signals  ?? 0);
    const upCount    = Number(sr?.price_up_count ?? 0);

    const summary = {
      totalSignals:   totalSig,
      priceUpRate:    totalSig > 0 ? Math.round((upCount / totalSig) * 1000) / 10 : 0,
      avgReturn:      Number(sr?.avg_return ?? 0),
      bestSignalType: stats[0]?.signal_type ?? '—',
      dataStartDate:  sr?.data_start ?? '—',
    };

    return NextResponse.json(
      { stats, monthlyTrend, recentSignals, summary },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=600' } },
    );

  } catch (err) {
    console.error('[accuracy] error:', err);
    return NextResponse.json({
      stats: [], monthlyTrend: [], recentSignals: [],
      summary: { totalSignals: 0, priceUpRate: 0, avgReturn: 0, bestSignalType: '—', dataStartDate: '—' },
    }, { status: 500 });
  }
}