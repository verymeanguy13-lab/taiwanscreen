// =============================================================================
// lib/notify.ts — Email notifications via Resend
// =============================================================================

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY ?? 'placeholder');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertEmailParams {
  to:            string;
  stock_symbol:  string;
  stock_name:    string;
  alert_type:    string;
  threshold:     number;
  current_value: number;
}

// ── Build alert description ───────────────────────────────────────────────────

function buildAlertDescription(
  type:      string,
  threshold: number,
  current:   number,
  name:      string,
): { subject: string; body: string } {
  switch (type) {
    case 'price_above':
      return {
        subject: `[${name}] 股價突破 NT$${threshold}`,
        body:    `${name} 目前股價為 NT$${current.toFixed(2)}，已突破您設定的警示價 NT$${threshold}。`,
      };
    case 'price_below':
      return {
        subject: `[${name}] 股價跌破 NT$${threshold}`,
        body:    `${name} 目前股價為 NT$${current.toFixed(2)}，已跌破您設定的警示價 NT$${threshold}。`,
      };
    case 'triple_buy':
      return {
        subject: `[${name}] 出現三買訊號`,
        body:    `${name} 今日出現三大法人同步買超訊號，外資、投信、自營商均呈現買超。`,
      };
    case 'foreign_buy_streak':
      return {
        subject: `[${name}] 外資連續買超達 ${current} 日`,
        body:    `${name} 外資已連續買超 ${current} 日，達到您設定的 ${threshold} 日門檻。`,
      };
    case 'yield_above':
      return {
        subject: `[${name}] 殖利率達 ${current.toFixed(2)}%`,
        body:    `${name} 目前殖利率為 ${current.toFixed(2)}%，已達到您設定的 ${threshold}% 門檻。`,
      };
    default:
      return {
        subject: `[${name}] 警示條件已觸發`,
        body:    `${name} 的警示條件已觸發。目前數值：${current}，門檻：${threshold}。`,
      };
  }
}

// ── Build HTML email ──────────────────────────────────────────────────────────

function buildHTML(
  params:  AlertEmailParams,
  subject: string,
  body:    string,
): string {
  const stockUrl = `https://taiwanscreen.vercel.app/stock/${params.stock_symbol}`;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0d0f17;font-family:'Noto Sans TC',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background:#0d0f17;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
          style="background:#161822;border-radius:12px;overflow:hidden;border:1px solid #2a2d3e;">

          <!-- Header -->
          <tr>
            <td style="background:#00d4aa;padding:20px 28px;">
              <p style="margin:0;font-size:13px;font-weight:700;color:#08090e;letter-spacing:0.5px;">
                台股雷達警示通知
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px;">

              <!-- Stock info box -->
              <table width="100%" cellpadding="0" cellspacing="0"
                style="background:#1e2030;border-radius:8px;padding:16px;margin-bottom:20px;border:1px solid #2a2d3e;">
                <tr>
                  <td>
                    <p style="margin:0 0 4px;font-size:20px;font-weight:700;color:#ffffff;font-family:monospace;">
                      ${params.stock_symbol}
                    </p>
                    <p style="margin:0 0 12px;font-size:14px;color:#8b8fa8;">
                      ${params.stock_name}
                    </p>
                    <p style="margin:0;font-size:24px;font-weight:700;color:#00d4aa;font-family:monospace;">
                      ${params.alert_type.startsWith('price')
                        ? `NT$${params.current_value.toFixed(2)}`
                        : params.alert_type === 'yield_above'
                        ? `${params.current_value.toFixed(2)}%`
                        : `${params.current_value}`}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Alert description -->
              <p style="margin:0 0 24px;font-size:15px;color:#c5c8d8;line-height:1.6;">
                ${body}
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:8px;background:#00d4aa;">
                    <a href="${stockUrl}"
                      style="display:inline-block;padding:12px 28px;font-size:14px;
                             font-weight:600;color:#08090e;text-decoration:none;
                             border-radius:8px;">
                      查看股票詳情 →
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 28px;border-top:1px solid #2a2d3e;">
              <p style="margin:0;font-size:11px;color:#4a4d60;line-height:1.6;">
                若要取消此警示，請至台股雷達 → 警示設定。<br/>
                此為系統自動發送，請勿直接回覆此信件。
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Send alert email ──────────────────────────────────────────────────────────

export async function sendAlertEmail(params: AlertEmailParams): Promise<boolean> {
  try {
    const { subject, body } = buildAlertDescription(
      params.alert_type,
      params.threshold,
      params.current_value,
      params.stock_name,
    );

    const html = buildHTML(params, subject, body);

    const { error } = await resend.emails.send({
      from:    'Taiwan Stock Radar <alerts@taiwanscreen.com>',
      to:      params.to,
      subject,
      html,
    });

    if (error) {
      console.error('[notify] Resend error:', error);
      return false;
    }

    console.log(`[notify] Alert email sent to ${params.to} for ${params.stock_symbol} (${params.alert_type})`);
    return true;
  } catch (err) {
    console.error('[notify] Unexpected error:', err);
    return false;
  }
}