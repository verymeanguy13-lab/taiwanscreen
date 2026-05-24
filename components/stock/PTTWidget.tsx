'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface PTTData {
  today:             number | null;
  week_avg_mentions: number;
  sentiment_trend:   number;
  sample_titles:     string[];
}

interface Props {
  symbol:  string;
  name_zh: string;
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function WidgetSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[80, 60, 100, 70].map((w, i) => (
        <div
          key={i}
          className="h-4 rounded"
          style={{
            width: `${w}%`,
            backgroundColor: 'var(--bg-secondary)',
            opacity: 1 - i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

// ── Sentiment bar ─────────────────────────────────────────────────────────────
function SentimentBar({ score }: { score: number }) {
  // score: -1 to 1. Map to 0–100% fill from left (bullish) or right (bearish)
  const bullishPct = Math.round(((score + 1) / 2) * 100);
  const label      = score > 0.1 ? '偏多' : score < -0.1 ? '偏空' : '中性';
  const labelColor = score > 0.1
    ? 'var(--accent-green)'
    : score < -0.1
    ? 'var(--accent-red)'
    : 'var(--text-secondary)';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-muted)' }}>市場情緒</span>
        <span className="font-semibold" style={{ color: labelColor }}>{label}</span>
      </div>
      <div
        className="h-2 w-full rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${bullishPct}%`,
            backgroundColor: bullishPct >= 50 ? 'var(--accent-green)' : 'var(--accent-red)',
          }}
        />
      </div>
      <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>多</span>
        <span>空</span>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────
export function PTTWidget({ symbol, name_zh }: Props) {
  const { data, error } = useSWR<PTTData>(
    `/api/ptt?symbol=${symbol}`,
    fetcher,
    { shouldRetryOnError: false },
  );

  return (
    <div
      className="flex flex-col gap-3 rounded-lg p-4"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          PTT 討論熱度
        </span>
        <a
          href="https://www.ptt.cc/bbs/Stock"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs"
          style={{ color: 'var(--accent-blue)' }}
        >
          Stock板 →
        </a>
      </div>

      {/* Loading */}
      {!data && !error && <WidgetSkeleton />}

      {/* Error */}
      {error && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>資料載入失敗</p>
      )}

      {/* Data */}
      {data && (
        <>
          {/* Low activity */}
          {(data.today ?? 0) < 2 ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              近期討論較少
            </p>
          ) : (
            <>
              {/* Mention count */}
              <div className="flex items-baseline gap-2">
                <span className="num text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {data.today}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  次提及
                </span>
                {data.today != null && data.today > data.week_avg_mentions && (
                  <span className="text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>
                    ↑ 高於均值
                  </span>
                )}
                {data.today != null && data.today < data.week_avg_mentions && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    ↓ 低於均值
                  </span>
                )}
              </div>

              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                7日均值：{data.week_avg_mentions} 次
              </p>

              {/* Sentiment bar */}
              <SentimentBar score={data.sentiment_trend} />

              {/* Sample titles */}
              {data.sample_titles?.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    近期討論
                  </p>
                  {data.sample_titles.map((title, i) => (
                    <a
                      key={i}
                      href="https://www.ptt.cc/bbs/Stock"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {title.length > 40 ? title.slice(0, 40) + '…' : title}
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
