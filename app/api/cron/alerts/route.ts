// =============================================================================
// app/api/cron/alerts/route.ts
//
// NOT a Vercel Cron job — called internally by app/api/cron/daily/route.ts
// at the end of each daily ingestion run. This keeps us within Vercel Hobby's
// 2-cron-job limit.
//
// Checks all active user alerts and sends email if conditions are met.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { query, sql } from '@/lib/db';
import { sendAlertEmail } from '@/lib/notify';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertRow {
  id: number;
  user_id: string;
  symbol: string;
  alert_type: string;
  threshold: number;
  name_zh: string;
  email: string;
  current_price: number | null;
  foreign_consecutive_days: number | null;
  triple_buy: boolean | null;
  latest_yield_pct: number | null;
}

// ── Condition checker ─────────────────────────────────────────────────────────

function isConditionTriggered(
  alert: AlertRow,
): { triggered: boolean; current_value: number } {
  const {
    alert_type,
    threshold,
    current_price,
    foreign_consecutive_days,
    triple_buy,
    latest_yield_pct,
  } = alert;

  switch (alert_type) {
    case 'price_above':
      return {
        triggered: current_price != null && current_price > threshold,
        current_value: current_price ?? 0,
      };
    case 'price_below':
      return {
        triggered: current_price != null && current_price < threshold,
        current_value: current_price ?? 0,
      };
    case 'triple_buy':
      return {
        triggered: triple_buy === true,
        current_value: triple_buy ? 1 : 0,
      };
    case 'foreign_buy_streak':
      return {
        triggered:
          foreign_consecutive_days != null &&
          foreign_consecutive_days >= threshold,
        current_value: foreign_consecutive_days ?? 0,
      };
    case 'yield_above':
      return {
        triggered: latest_yield_pct != null && latest_yield_pct >= threshold,
        current_value: latest_yield_pct ?? 0,
      };
    default:
      return { triggered: false, current_value: 0 };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── 1. Validate secret ───────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Taiwan time gate: Mon–Fri, 08:00–23:59 (UTC+8) ───────────────────
  const now = new Date();
  const twMs   = now.getTime() + 8 * 60 * 60 * 1000;
  const twDate = new Date(twMs);
  const day    = twDate.getUTCDay();   // 0 = Sun, 6 = Sat
  const hour   = twDate.getUTCHours();

  if (day === 0 || day === 6 || hour < 8) {
    return NextResponse.json({ skipped: true, reason: 'Outside trading window' });
  }

  // ── 3. Fetch all active alerts not yet triggered today ───────────────────
  const alerts = await query<AlertRow>`
    SELECT
      a.id,
      a.user_id,
      a.symbol,
      a.alert_type,
      a.threshold,
      s.name_zh,
      u.email,
      dp.close                    AS current_price,
      i.foreign_consecutive_days,
      i.triple_buy,
      ds.latest_yield_pct
    FROM alerts a
    JOIN users u
      ON a.user_id = u.id
    JOIN stocks s
      ON a.symbol = s.symbol
    LEFT JOIN daily_prices dp
      ON a.symbol = dp.symbol
     AND dp.date  = (SELECT MAX(date) FROM daily_prices)
    LEFT JOIN institutional_flows i
      ON a.symbol = i.symbol
     AND i.date   = (SELECT MAX(date) FROM institutional_flows)
    LEFT JOIN dividend_summary ds
      ON a.symbol = ds.symbol
    WHERE a.is_active = TRUE
      AND (a.last_triggered IS NULL OR a.last_triggered < CURRENT_DATE)
  `;

  // ── 4. Check each alert and send email if triggered ──────────────────────
  let triggered   = 0;
  let emails_sent = 0;

  for (const alert of alerts) {
    const { triggered: fired, current_value } = isConditionTriggered(alert);
    if (!fired) continue;

    triggered++;

    const sent = await sendAlertEmail({
      to:           alert.email,
      stock_symbol: alert.symbol,
      stock_name:   alert.name_zh,
      alert_type:   alert.alert_type,
      threshold:    Number(alert.threshold),
      current_value,
    });

    if (sent) emails_sent++;

    // Always mark triggered — even if email failed — so we don't retry
    // the same alert today. Fix RESEND_API_KEY first, then manually
    // clear last_triggered if you need to resend.
    await sql`
      UPDATE alerts
      SET last_triggered = NOW()
      WHERE id = ${alert.id}
    `;
  }

  // ── 5. Return summary ────────────────────────────────────────────────────
  console.log(
    `[cron/alerts] checked=${alerts.length} triggered=${triggered} emails_sent=${emails_sent}`,
  );

  return NextResponse.json({
    checked:      alerts.length,
    triggered,
    emails_sent,
  });
}