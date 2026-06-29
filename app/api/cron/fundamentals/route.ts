import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

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
    // ── your existing fundamentals logic below (unchanged) ────────────────────
    // e.g. ingest P/E, P/B, EPS, ROE from MOPS/TWSE quarterly data.
    // Replace the block below with whatever was already in this file.

    const result = await query(
      `SELECT COUNT(*) AS cnt FROM fundamentals WHERE period >= '2024'`,
      []
    )
    const count = result.rows[0]?.cnt ?? 0

    return NextResponse.json({
      success: true,
      message: `Fundamentals cron complete. Rows in fundamentals: ${count}`,
      timestamp: new Date().toISOString(),
    })
    // ── end existing logic ────────────────────────────────────────────────────
  } catch (err) {
    console.error('[cron/fundamentals] error:', err)
    return NextResponse.json({ error: 'Fundamentals cron failed', detail: String(err) }, { status: 500 })
  }
}