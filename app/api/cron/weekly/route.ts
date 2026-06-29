import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { fetchWeeklyData } from '@/lib/twse'   // adjust import to match your actual lib

export const maxDuration = 10

export async function GET(request: NextRequest) {
  // Allow both the legacy secret header AND Vercel's built-in cron header
  const cronSecret  = request.headers.get('x-cron-secret')
  const vercelCron  = request.headers.get('x-vercel-cron')

  const validSecret = cronSecret === process.env.CRON_SECRET
  const validVercel = vercelCron === '1'

  if (!validSecret && !validVercel) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // ── your existing weekly logic below (unchanged) ──────────────────────────
    // e.g. fetch weekly aggregates, re-compute weekly signals, etc.
    // Replace the block below with whatever was already in this file.

    const result = await query(
      `SELECT COUNT(*) AS cnt FROM daily_prices WHERE date >= CURRENT_DATE - INTERVAL '7 days'`,
      []
    )
    const count = result.rows[0]?.cnt ?? 0

    return NextResponse.json({
      success: true,
      message: `Weekly cron complete. Rows in last 7 days: ${count}`,
      timestamp: new Date().toISOString(),
    })
    // ── end existing logic ────────────────────────────────────────────────────
  } catch (err) {
    console.error('[cron/weekly] error:', err)
    return NextResponse.json({ error: 'Weekly cron failed', detail: String(err) }, { status: 500 })
  }
}