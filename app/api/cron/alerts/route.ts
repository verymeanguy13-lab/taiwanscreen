// app/api/cron/alerts/route.ts
//
// Runs every hour during Taiwan trading hours.
// Called from inside the daily cron (NOT a separate Vercel cron —
// Hobby plan only supports 2 crons. See vercel.json.)
//
// To trigger manually for testing:
//   curl -H "x-cron-secret: mysecret123" https://taiwanscreen.vercel.app/api/cron/alerts

import { NextRequest, NextResponse } from 'next/server'
import { queryUnsafe } from '@/lib/db'
import { sendAlertEmail } from '@/lib/notify'

export async function GET(request: NextRequest) {
  // ─── 1. Validate secret header ───────────────────────────────────────────
  // Header name: x-cron-secret (lowercase — HTTP headers are case-insensitive
  // but Next.js normalises them to lowercase)
  const secret = request.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ─── 2. Taiwan time gate ─────────────────────────────────────────────────
  // Only run during trading hours: Mon–Fri 09:00–14:00 Taiwan time (UTC+8)
  const taiwanNow = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' })
  )
  const day  = taiwanNow.getDay()    // 0=Sun, 6=Sat
  const hour = taiwanNow.getHours()  // 0-23

  if (day === 0 || day === 6) {
    return NextResponse.json({ message: 'Market closed — weekend' })
  }
  if (hour < 9 || hour >= 14) {
    return NextResponse.json({ message: 'Outside trading hours' })
  }

  // ─── 3. Fetch all active alerts ──────────────────────────────────────────
  type AlertRow = {
    id: number
    user_id: number
    symbol: string
    alert_type: string
    threshold: number
    name_zh: string
    email: string
    current_price: number | null
    foreign_consecutive_days: number | null
    triple_buy: boolean | null
    latest_yield_pct: number | null
  }

  const alerts = await queryUnsafe<AlertRow>(
    `SELECT
       a.id,
       a.user_id,
       a.symbol,
       a.alert_type,
       a.threshold,
       s.name_zh,
       u.email,
       dp.close                        AS current_price,
       i.foreign_consecutive_days,
       i.triple_buy,
       ds.latest_yield_pct
     FROM alerts a
     JOIN users  u  ON a.user_id  = u.id
     JOIN stocks s  ON a.symbol   = s.symbol
     LEFT JOIN daily_prices dp
       ON  a.symbol  = dp.symbol
       AND dp.date   = (SELECT MAX(date) FROM daily_prices)
     LEFT JOIN institutional_flows i
       ON  a.symbol  = i.symbol
       AND i.date    = (SELECT MAX(date) FROM institutional_flows)
     LEFT JOIN dividend_summary ds
       ON  a.symbol  = ds.symbol
     WHERE a.is_active = TRUE
       AND (
         a.last_triggered IS NULL
         OR a.last_triggered < CURRENT_DATE
       )`,
    []
  )

  // ─── 4 & 5. Check conditions and send emails ─────────────────────────────
  let triggered = 0
  let emailsSent = 0

  for (const alert of alerts) {
    const {
      id, symbol, alert_type, threshold, name_zh, email,
      current_price, foreign_consecutive_days, triple_buy, latest_yield_pct
    } = alert

    let conditionMet = false

    switch (alert_type) {
      case 'price_above':
        conditionMet = current_price != null && current_price > threshold
        break
      case 'price_below':
        conditionMet = current_price != null && current_price < threshold
        break
      case 'triple_buy':
        conditionMet = triple_buy === true
        break
      case 'foreign_buy_streak':
        conditionMet =
          foreign_consecutive_days != null &&
          foreign_consecutive_days >= threshold
        break
      case 'yield_above':
        conditionMet =
          latest_yield_pct != null && latest_yield_pct >= threshold
        break
    }

    if (!conditionMet) continue

    triggered++

    const sent = await sendAlertEmail({
      to: email,
      stock_symbol: symbol,
      stock_name: name_zh,
      alert_type,
      threshold,
      current_value:
        alert_type === 'yield_above'
          ? (latest_yield_pct ?? 0)
          : alert_type === 'foreign_buy_streak'
          ? (foreign_consecutive_days ?? 0)
          : (current_price ?? 0),
    })

    if (sent) emailsSent++

    // Mark alert as triggered today so it doesn't fire again until tomorrow
    await queryUnsafe(
      `UPDATE alerts SET last_triggered = NOW() WHERE id = $1`,
      [id]
    )
  }

  return NextResponse.json({
    checked:      alerts.length,
    triggered,
    emails_sent:  emailsSent,
  })
}