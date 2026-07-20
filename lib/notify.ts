// =============================================================================
// lib/notify.ts — Email alert sender using Resend
//
// Resend free tier: 100 emails/day, no credit card needed.
// Sign up at https://resend.com and add RESEND_API_KEY to your .env.local
// =============================================================================

import { Resend } from 'resend';

// Constructed lazily (inside sendAlertEmail), not at module load time.
// A top-level `new Resend(...)` throws immediately if RESEND_API_KEY is
// missing/placeholder, and Next.js hits that just from statically
// collecting page data for any route that imports this file — failing
// `next build` even though no email is ever actually sent during build.
let resend: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertEmailParams {
  to: string;
  stock_symbol: string;
  stock_name: string;
  alert_type: string;
  threshold: number;
  current_value: number;
}

// ── Build human-readable subject + HTML body ──────────────────────────────────

function buildAlertDescription(
  type: string,
  threshold: number,
  current: number,
  name: string,
  symbol: string,
): { subject: string; body: string } {
  const fmt = (v: number) =>
    v.toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // One subject line per alert type
  const subjects: Record<string, string> = {
    price_above:        `[${name}] ${symbol} 股價突破 NT$${threshold}`,
    price_below:        `[${name}] ${symbol} 股價跌破 NT$${threshold}`,
    triple_buy:         `[${name}] ${symbol} 出現三買訊號`,
    foreign_buy_streak: `[${name}] ${symbol} 外資連續買超達 ${threshold} 日`,
    yield_above:        `[${name}] ${symbol} 殖利率達 ${threshold}%`,
  };

  // One plain-language condition sentence per alert type
  const conditions: Record<string, string> = {
    price_above:        `股價 NT$${fmt(current)} 已突破您設定的 NT$${threshold} 上限警示`,
    price_below:        `股價 NT$${fmt(current)} 已跌破您設定的 NT$${threshold} 下限警示`,
    triple_buy:         `今日出現三買訊號（月均線、季均線、年均線同步向上排列）`,
    foreign_buy_streak: `外資已連續買超 ${current} 日，達到您設定的 ${threshold} 日門檻`,
    yield_above:        `殖利率 ${fmt(current)}% 已達到您設定的 ${threshold}% 門檻`,
  };

  const subject   = subjects[type]   ?? `[${name}] ${symbol} 警示觸發`;
  const condition = conditions[type] ?? `警示條件已觸發（當前值：${current}）`;

  const body = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0"
          style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a56db,#0e9f6e);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px;">
                📡 台股雷達警示通知
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                Taiwan Screen · 智慧選股平台
              </p>
            </td>
          </tr>

          <!-- Stock Info Box -->
          <tr>
            <td style="padding:32px 40px 0;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#f0f4ff;border:1px solid #d0dbf5;border-radius:10px;padding:20px 24px;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">股票代號</p>
                    <p style="margin:0;font-size:28px;font-weight:800;color:#1e3a8a;">${symbol}</p>
                  </td>
                  <td align="right">
                    <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">公司名稱</p>
                    <p style="margin:0;font-size:18px;font-weight:600;color:#111827;">${name}</p>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:16px;">
                    <p style="margin:0;font-size:13px;color:#6b7280;">當前數值</p>
                    <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#059669;">${fmt(current)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Alert Condition -->
          <tr>
            <td style="padding:24px 40px 0;">
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;padding:16px 20px;">
                <tr>
                  <td>
                    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#92400e;
                      text-transform:uppercase;letter-spacing:0.5px;">⚠️ 觸發條件</p>
                    <p style="margin:0;font-size:15px;color:#78350f;line-height:1.6;">${condition}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:32px 40px;text-align:center;">
              <a href="https://taiwanscreen.vercel.app/stock/${symbol}"
                style="display:inline-block;background:linear-gradient(135deg,#1a56db,#0e9f6e);
                  color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;
                  padding:14px 36px;border-radius:8px;letter-spacing:0.5px;">
                查看股票詳情 →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.8;">
                若要取消此警示，請至 <strong>台股雷達 → 警示設定</strong><br />
                © ${new Date().getFullYear()} Taiwan Screen · 自動通知系統
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, body };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Sends an alert email via Resend.
 * Returns true on success, false on any error (never throws).
 */
export async function sendAlertEmail(params: AlertEmailParams): Promise<boolean> {
  const { to, stock_symbol, stock_name, alert_type, threshold, current_value } = params;

  const { subject, body } = buildAlertDescription(
    alert_type,
    threshold,
    current_value,
    stock_name,
    stock_symbol,
  );

  const client = getResendClient();
  if (!client) {
    console.warn(`[notify] RESEND_API_KEY not configured — skipping email to ${to} for ${stock_symbol}`);
    return false;
  }

  try {
    const { error } = await client.emails.send({
      from: 'onboarding@resend.dev',    // swap for your verified domain later
      to,
      subject,
      html: body,
    });

    if (error) {
      console.error(`[notify] Resend error for ${stock_symbol} → ${to}:`, error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`[notify] Unexpected error sending alert for ${stock_symbol} → ${to}:`, err);
    return false;
  }
}