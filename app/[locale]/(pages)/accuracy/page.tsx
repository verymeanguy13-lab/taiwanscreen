// =============================================================================
// app/[locale]/(pages)/accuracy/page.tsx
// =============================================================================

import { AccuracyDashboard } from '@/components/kline/AccuracyDashboard';
import { queryUnsafe }       from '@/lib/db';
import UpdateSignalsButton   from './UpdateSignalsButton';

export async function generateMetadata() {
  return {
    title: '歷史技術型態統計 — 台股雷達',
    description: '台股雷達歷史技術型態統計，公開每個型態出現後的價格走勢數據',
  };
}

async function fetchSummarySSR() {
  try {
    const rows = await queryUnsafe<{
      total_signals:  string;
      price_up_count: string;
      avg_return:     string;
    }>(
      `SELECT
         COUNT(*)                                      AS total_signals,
         SUM(CASE WHEN price_up_5d THEN 1 ELSE 0 END) AS price_up_count,
         ROUND(AVG(return_5d)::numeric, 2)            AS avg_return
       FROM signal_results
       WHERE price_up_5d IS NOT NULL`,
      [],
    );
    const r     = rows[0];
    const total = Number(r?.total_signals  ?? 0);
    const up    = Number(r?.price_up_count ?? 0);
    return {
      totalSignals: total,
      priceUpRate:  total > 0 ? Math.round((up / total) * 1000) / 10 : 0,
      avgReturn:    Number(r?.avg_return ?? 0),
    };
  } catch {
    return { totalSignals: 0, priceUpRate: 0, avgReturn: 0 };
  }
}

export default async function AccuracyPage() {
  const summary = await fetchSummarySSR();

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-8">

        <div style={{
          textAlign: 'center',
          padding: '40px 20px 48px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 32,
        }}>
          <h1 style={{
            fontSize: 28, fontWeight: 900,
            color: 'var(--text-primary)',
            marginBottom: 10, lineHeight: 1.3,
          }}>
            歷史技術型態出現後，<br />價格怎麼走？
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 32 }}>
            所有歷史技術型態出現後的價格走勢統計，資料來源：TWSE
          </p>

          <div style={{
            display: 'flex', justifyContent: 'center',
            gap: 48, flexWrap: 'wrap', marginBottom: 32,
          }}>
            {[
              {
                value: `${summary.priceUpRate}%`,
                label: '條件後上漲比例',
                color: summary.priceUpRate >= 50 ? 'var(--accent-red)' : 'var(--accent-green)',
              },
              {
                value: `+${summary.avgReturn}%`,
                label: '平均5日報酬',
                color: summary.avgReturn >= 0 ? 'var(--accent-red)' : 'var(--accent-green)',
              },
              {
                value: summary.totalSignals.toLocaleString(),
                label: '累計訊號次數',
                color: 'var(--text-primary)',
              },
            ].map(({ value, label, color }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1 }}>{value}</span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
              </div>
            ))}
          </div>

          
            href="/auth/signin"
            style={{
              display: 'inline-block', padding: '12px 28px',
              backgroundColor: 'var(--accent-green)', color: 'var(--bg-primary)',
              borderRadius: 8, fontWeight: 700, fontSize: 15, textDecoration: 'none',
            }}
          >
            免費使用 →
          </a>
        </div>

        <AccuracyDashboard />

        <div className="mt-8 flex justify-center">
          <UpdateSignalsButton />
        </div>

      </div>
    </div>
  );
}
