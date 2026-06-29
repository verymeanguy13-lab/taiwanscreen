import { NextRequest, NextResponse } from 'next/server'
import { queryUnsafe } from '@/lib/db'

export const maxDuration = 10

export async function GET(_request: NextRequest) {
  try {
    // ── 1. Per-signal accuracy stats ─────────────────────────────────────────
    const signalSql = `
      SELECT
        signal_type,
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE return_5d > 0.01)             AS wins,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE return_5d > 0.01)
               / NULLIF(COUNT(*), 0),
          1
        )                                                     AS win_rate_pct,
        ROUND(AVG(return_5d) * 100, 2)                       AS avg_return_pct,
        ROUND(AVG(return_10d) * 100, 2)                      AS avg_return_10d_pct,
        MIN(signal_date)                                      AS earliest_date,
        MAX(signal_date)                                      AS latest_date
      FROM signal_results
      WHERE signal_type NOT IN ('近十日強勢股', '__sentinel__')
        AND return_5d IS NOT NULL
      GROUP BY signal_type
      HAVING COUNT(*) >= 5
      ORDER BY win_rate_pct DESC
    `
    const signalRows = await queryUnsafe(signalSql, [])

    // ── 2. Baseline: natural probability any Taiwan stock hits +1% in 5 days ─
    const baselineSql = `
      WITH forward AS (
        SELECT
          d1.symbol,
          d1.date AS entry_date,
          (
            SELECT d2.close
            FROM daily_prices d2
            WHERE d2.symbol = d1.symbol
              AND d2.date > d1.date
            ORDER BY d2.date ASC
            LIMIT 1 OFFSET 4
          ) AS close_5d,
          d1.close AS entry_close
        FROM daily_prices d1
        WHERE d1.date >= CURRENT_DATE - INTERVAL '180 days'
          AND d1.date <  CURRENT_DATE - INTERVAL '7 days'
      )
      SELECT
        COUNT(*)                                                       AS total_samples,
        COUNT(*) FILTER (WHERE close_5d > entry_close * 1.01)         AS hits_1pct,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE close_5d > entry_close * 1.01)
               / NULLIF(COUNT(*), 0),
          1
        )                                                              AS baseline_win_rate_pct,
        ROUND(
          AVG((close_5d - entry_close) / NULLIF(entry_close, 0)) * 100,
          2
        )                                                              AS baseline_avg_return_pct
      FROM forward
      WHERE close_5d IS NOT NULL
    `
    const baselineRows = await queryUnsafe(baselineSql, [])

    // queryUnsafe returns the array directly — index with [0], not .rows[0]
    const baseline = (baselineRows as Record<string, unknown>[])[0] ?? {
      total_samples: 0,
      hits_1pct: 0,
      baseline_win_rate_pct: null,
      baseline_avg_return_pct: null,
    }

    const baselineRate = parseFloat(String(baseline.baseline_win_rate_pct ?? '0'))

    const signals = (signalRows as Record<string, unknown>[]).map(r => {
      const winRate = parseFloat(String(r.win_rate_pct ?? '0'))
      return {
        signalType:      r.signal_type,
        total:           Number(r.total),
        wins:            Number(r.wins),
        winRatePct:      winRate,
        avgReturn5dPct:  Number(r.avg_return_pct),
        avgReturn10dPct: Number(r.avg_return_10d_pct),
        edgeVsBaseline:  parseFloat((winRate - baselineRate).toFixed(1)),
        earliestDate:    r.earliest_date,
        latestDate:      r.latest_date,
      }
    })

    return NextResponse.json({
      signals,
      baseline: {
        totalSamples:   Number(baseline.total_samples),
        hitsOnePct:     Number(baseline.hits_1pct),
        winRatePct:     parseFloat(String(baseline.baseline_win_rate_pct ?? '0')),
        avgReturn5dPct: parseFloat(String(baseline.baseline_avg_return_pct ?? '0')),
        description:    '過去180天所有台股，持有5日後收益 > 1% 的自然機率（基準線）',
      },
      meta: {
        winDefinition: 'return_5d > 1%（持有5個交易日，報酬率 > 1%）',
        note:          '勝率需顯著高於基準線才代表訊號有實際選股優勢',
      },
    })
  } catch (err) {
    console.error('[kline/accuracy] error:', err)
    return NextResponse.json(
      { error: 'Accuracy query failed', detail: String(err) },
      { status: 500 }
    )
  }
}