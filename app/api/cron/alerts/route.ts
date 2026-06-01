// =============================================================================
// app/api/cron/alerts/route.ts
//
// NOT a Vercel Cron job — called internally by app/api/cron/daily/route.ts
// at the end of each daily ingestion run. This keeps us within Vercel Hobby's
// 2-cron-job limit.
//
// Checks all active user alerts and sends email if conditions are met.
// Updated Session 60: uses alertEvaluator for 36-condition multi-rule support.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { query, queryUnsafe, sql } from '@/lib/db';
import { sendAlertEmail } from '@/lib/notify';
import { evaluateRule, buildAlertMessage } from '@/lib/alertEvaluator';
import type { AlertRule, AlertCondition, EvaluationContext, IndicatorSet } from '@/lib/alertEvaluator';
import { sma, rsi as calcRsi, macd as calcMacd, kdj as calcKdj, bollingerBands, volumeRatio } from '@/lib/indicators';
import { detectAllBreakouts } from '@/lib/breakouts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlertRow {
  id:                       number;
  user_id:                  string;
  symbol:                   string;
  alert_type:               string;
  threshold:                number;
  alert_logic:              string | null;
  conditions:               unknown;   // JSONB — parsed below
  name_zh:                  string;
  email:                    string;
  current_price:            number | null;
  foreign_consecutive_days: number | null;
  triple_buy:               boolean | null;
  latest_yield_pct:         number | null;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {

  // ── 1. Validate secret ───────────────────────────────────────────────────
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Taiwan time gate: Mon–Fri, 08:00–23:59 (UTC+8) ───────────────────
  const now    = new Date();
  const twMs   = now.getTime() + 8 * 60 * 60 * 1000;
  const twDate = new Date(twMs);
  const day    = twDate.getUTCDay();
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
      a.alert_logic,
      a.conditions,
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

  // ── 4. Evaluate each alert ────────────────────────────────────────────────
  let triggered   = 0;
  let emails_sent = 0;

  for (const alert of alerts) {

    // ── Parse conditions (support legacy single-condition rows) ─────────────
    let conditions: AlertCondition[] = [];
    try {
      const raw = alert.conditions;
      if (Array.isArray(raw)) {
        conditions = raw as AlertCondition[];
      } else if (typeof raw === 'string') {
        conditions = JSON.parse(raw) as AlertCondition[];
      } else {
        // Legacy row — build condition from alert_type + threshold columns
        conditions = [{ type: alert.alert_type as any, threshold: alert.threshold }];
      }
    } catch {
      conditions = [{ type: alert.alert_type as any, threshold: alert.threshold }];
    }

    if (conditions.length === 0) continue;

    const rule: AlertRule = {
      id:        String(alert.id),
      stockId:   alert.symbol,
      conditions,
      logic:     (alert.alert_logic as 'AND' | 'OR') ?? 'OR',
      enabled:   true,
      triggered: false,
      createdAt: '',
    };

    // ── Fetch last 60 candles ───────────────────────────────────────────────
    const candleRows = await queryUnsafe<{
      date: string; open: number; high: number;
      low: number; close: number; volume: number;
    }>(
      `SELECT date, open, high, low, close, volume
       FROM daily_prices
       WHERE symbol = $1
       ORDER BY date DESC LIMIT 60`,
      [alert.symbol],
    );

    if (candleRows.length < 5) continue;
    const candles = candleRows.reverse();

    // ── Compute indicators ──────────────────────────────────────────────────
    const closes  = candles.map(c => c.close);
    const highs   = candles.map(c => c.high);
    const lows    = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    const indicators: IndicatorSet = {
      sma5:     sma(closes, 5),
      sma20:    sma(closes, 20),
      sma60:    sma(closes, 60),
      rsi14:    calcRsi(closes, 14),
      macd:     calcMacd(closes),
      kdj:      calcKdj(highs, lows, closes),
      bb:       bollingerBands(closes),
      volRatio: volumeRatio(volumes, 5),
    };

    // ── Conditionally fetch extra data only when needed ─────────────────────
    const condTypes = conditions.map(c => c.type);

    const institutionalData = condTypes.some(
      t => t === 'institutional_buy' || t === 'institutional_sell',
    )
      ? await queryUnsafe<any>(
          `SELECT foreign_net, trust_net, dealer_net, total_net, date
           FROM institutional_flows
           WHERE symbol = $1
           ORDER BY date DESC LIMIT 5`,
          [alert.symbol],
        )
      : undefined;

    const dividendDates = condTypes.includes('ex_dividend_soon')
      ? await queryUnsafe<{ exDate: string }>(
          `SELECT ex_dividend_date AS "exDate"
           FROM dividends
           WHERE symbol = $1 AND ex_dividend_date >= CURRENT_DATE
           ORDER BY ex_dividend_date ASC LIMIT 3`,
          [alert.symbol],
        )
      : undefined;

    const breakouts = condTypes.includes('qichang_signal')
      ? detectAllBreakouts(candles as any, {
          sma5:  indicators.sma5,
          sma20: indicators.sma20,
          sma60: indicators.sma60,
          rsi14: indicators.rsi14,
          macd:  indicators.macd,
        })
      : undefined;

    // ── Build EvaluationContext ─────────────────────────────────────────────
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const price      = alert.current_price ?? lastCandle.close;
    const prevClose  = prevCandle?.close ?? lastCandle.close;

    const quote: any = {
      z:  price,
      y:  prevClose,
      h:  lastCandle.high,
      l:  lastCandle.low,
      v:  lastCandle.volume,
      tv: 0,
      p:  prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
    };

    const ctx: EvaluationContext = {
      quote,
      candles:        candles as any,
      indicators,
      institutional:  institutionalData,
      dividendDates,
      breakouts,
    };

    // ── Evaluate rule ───────────────────────────────────────────────────────
    const fired = evaluateRule(rule, ctx);

    if (fired) {
      triggered++;

      const message = buildAlertMessage(rule, ctx);

      const sent = await sendAlertEmail({
        to:            alert.email,
        stock_symbol:  alert.symbol,
        stock_name:    alert.name_zh,
        alert_type:    message,
        threshold:     conditions[0]?.threshold ?? 0,
        current_value: price,
      });

      if (sent) emails_sent++;

      await sql`
        UPDATE alerts
        SET last_triggered = NOW()
        WHERE id = ${alert.id}
      `;
    } else {
      // Reset so the alert can re-trigger next time conditions are met
      await sql`
        UPDATE alerts
        SET last_triggered = NULL
        WHERE id = ${alert.id}
          AND last_triggered IS NOT NULL
          AND last_triggered < CURRENT_DATE
      `;
    }
  }

  // ── 5. Return summary ────────────────────────────────────────────────────
  console.log(
    `[cron/alerts] checked=${alerts.length} triggered=${triggered} emails_sent=${emails_sent}`,
  );

  return NextResponse.json({
    checked:     alerts.length,
    triggered,
    emails_sent,
  });
}