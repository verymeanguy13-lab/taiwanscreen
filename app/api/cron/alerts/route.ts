// =============================================================================
// app/api/cron/alerts/route.ts
// Runs every hour during Taiwan trading hours (9:00–14:00).
// Schedule: "0 1-6 * * 1-5" in vercel.json
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { sendAlertEmail } from '@/lib/notify';

interface AlertRow {
  id:                       number;
  symbol:                   string;
  alert_type:               string;
  threshold:                number;
  email:                    string;
  name_zh:                  string;
  current_price:            number | null;
  foreign_consecutive_days: number | null;
  triple_buy:               boolean | null;
  latest_yield_pct:         number | null;
}

export async function GET(req: NextRequest) {
  // ── 1. Validate cron secret ──────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Check Taiwan trading hours (9:00–14:00, UTC+8) ───────────────────
  const now         = new Date();
  const taiwanHour  = (now.getUTCHours() + 8) % 24;
  if (taiwanHour < 9 || taiwanHour >= 14) {
    return NextResponse.json({ message: 'Outside trading hours', hour: taiwanHour });
  }

  // ── 3. Fetch all active alerts with market data ──────────────────────────
  let alerts: AlertRow[] = [];
  try {
    alerts = await queryUnsafe<AlertRow>(
      `SELECT
         a.id,
         a.symbol,
         a.alert_type,
         a.threshold,
         u.email,
         s.name_zh,
         dp.close              AS current_price,
         i.foreign_consecutive_days,
         i.triple_buy,
         ds.latest_yield_pct
       FROM alerts a
       JOIN users u        ON a.user_id  = u.id
       JOIN stocks s       ON a.symbol   = s.symbol
       LEFT JOIN daily_prices dp
         ON a.symbol = dp.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices)
       LEFT JOIN institutional_flows i
         ON a.symbol = i.symbol
         AND i.date = (SELECT MAX(date) FROM institutional_flows)
       LEFT JOIN dividend_summary ds
         ON a.symbol = ds.symbol
       WHERE a.is_active = TRUE
         AND (a.last_triggered IS NULL
              OR a.last_triggered < CURRENT_DATE)`,
      [],
    );
  } catch (err) {
    console.error('[cron/alerts] Failed to fetch alerts:', err);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  // ── 4 & 5. Check conditions and send emails ──────────────────────────────
  let triggered   = 0;
  let emails_sent = 0;

  for (const alert of alerts) {
    const price   = alert.current_price            ?? 0;
    const streak  = alert.foreign_consecutive_days ?? 0;
    const triple  = alert.triple_buy               ?? false;
    const yield_  = alert.latest_yield_pct         ?? 0;

    let conditionMet  = false;
    let current_value = 0;

    switch (alert.alert_type) {
      case 'price_above':
        conditionMet  = price > alert.threshold;
        current_value = price;
        break;
      case 'price_below':
        conditionMet  = price < alert.threshold;
        current_value = price;
        break;
      case 'triple_buy':
        conditionMet  = triple;
        current_value = triple ? 1 : 0;
        break;
      case 'foreign_buy_streak':
        conditionMet  = streak >= alert.threshold;
        current_value = streak;
        break;
      case 'yield_above':
        conditionMet  = yield_ >= alert.threshold;
        current_value = yield_;
        break;
    }

    if (!conditionMet) continue;
    triggered++;

    // Send email
    const sent = await sendAlertEmail({
      to:            alert.email,
      stock_symbol:  alert.symbol,
      stock_name:    alert.name_zh,
      alert_type:    alert.alert_type,
      threshold:     alert.threshold,
      current_value,
    });

    if (sent) {
      emails_sent++;
      // Mark as triggered so it won't fire again today
      try {
        await queryUnsafe(
          `UPDATE alerts SET last_triggered = NOW() WHERE id = $1`,
          [alert.id],
        );
      } catch (err) {
        console.error(`[cron/alerts] Failed to update last_triggered for alert ${alert.id}:`, err);
      }
    }
  }

  console.log(`[cron/alerts] Checked ${alerts.length}, triggered ${triggered}, sent ${emails_sent}`);

  return NextResponse.json({
    checked:     alerts.length,
    triggered,
    emails_sent,
  });
}