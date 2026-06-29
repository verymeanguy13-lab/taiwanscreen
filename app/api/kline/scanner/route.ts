import { NextRequest, NextResponse } from 'next/server'
import { queryUnsafe } from '@/lib/db'

export const maxDuration = 10

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit  = Math.min(parseInt(searchParams.get('limit')  ?? '50'),  200)
    const offset = Math.max(parseInt(searchParams.get('offset') ?? '0'),   0)
    const signal = searchParams.get('signal') ?? null   // optional filter by signal_type

    // ── Get the latest available trading date ─────────────────────────────────
    const latestDateRes = await queryUnsafe(
      `SELECT MAX(date) AS latest_date FROM daily_prices LIMIT 1`,
      []
    )
    const latestDate: string | null = latestDateRes.rows[0]?.latest_date ?? null

    if (!latestDate) {
      return NextResponse.json({ results: [], total: 0, date: null })
    }

    // ── Base WHERE clause — exclude 近十日強勢股 (0/26 win rate, worse than random)
    //    and sentinel records
    const excludedSignals = ['近十日強勢股', '__sentinel__']
    const excludePlaceholders = excludedSignals.map((_, i) => `$${i + 1}`).join(', ')
    const baseParams: (string | number)[] = [...excludedSignals]

    let signalFilter = ''
    if (signal) {
      baseParams.push(signal)
      signalFilter = ` AND sr.signal_type = $${baseParams.length}`
    }

    // ── Count total matching rows ─────────────────────────────────────────────
    const countSql = `
      SELECT COUNT(DISTINCT sr.symbol) AS total
      FROM signal_results sr
      WHERE sr.signal_type NOT IN (${excludePlaceholders})
        AND sr.signal_date = (SELECT MAX(date) FROM daily_prices LIMIT 1)
        ${signalFilter}
    `
    const countRes = await queryUnsafe(countSql, baseParams)
    const total = parseInt(countRes.rows[0]?.total ?? '0')

    // ── Main query: latest daily_prices join, no correlated subqueries ────────
    baseParams.push(limit)
    const limitPlaceholder = `$${baseParams.length}`
    baseParams.push(offset)
    const offsetPlaceholder = `$${baseParams.length}`

    const sql = `
      WITH latest AS (
        SELECT MAX(date) AS max_date FROM daily_prices LIMIT 1
      )
      SELECT
        sr.symbol,
        sr.signal_type,
        sr.signal_date,
        sr.score,
        dp.close                                        AS price,
        dp.change_pct                                   AS change_percent,
        dp.volume,
        dp.open,
        dp.high,
        dp.low
      FROM signal_results sr
      JOIN latest           ON sr.signal_date = latest.max_date
      JOIN daily_prices dp  ON dp.symbol = sr.symbol
                           AND dp.date   = latest.max_date
      WHERE sr.signal_type NOT IN (${excludePlaceholders})
        ${signalFilter}
      ORDER BY sr.score DESC, dp.volume DESC
      LIMIT  ${limitPlaceholder}
      OFFSET ${offsetPlaceholder}
    `

    const res = await queryUnsafe(sql, baseParams)

    const results = res.rows.map((r: Record<string, unknown>) => ({
      symbol:        r.symbol,
      signalType:    r.signal_type,
      signalDate:    r.signal_date,
      score:         Number(r.score),
      price:         Number(r.price),
      changePercent: Number(r.change_percent),
      volume:        Number(r.volume),
      open:          Number(r.open),
      high:          Number(r.high),
      low:           Number(r.low),
    }))

    return NextResponse.json({
      results,
      total,
      date: latestDate,   // ← consumed by rankings page freshness label
    })
  } catch (err) {
    console.error('[kline/scanner] error:', err)
    return NextResponse.json(
      { error: 'Scanner query failed', detail: String(err) },
      { status: 500 }
    )
  }
}