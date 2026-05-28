'use client';

import { useIntradayScanner, isMarketOpen } from '@/components/kline/IntradayScanner';
import { IntradaySignalFeed }  from '@/components/kline/IntradaySignalFeed';
import { DualScreener }        from '@/components/kline/DualScreener';
import { AfterHoursScreener }  from '@/components/kline/AfterHoursScreener';
import { TrendStrengthChart }  from '@/components/kline/TrendStrengthChart';

const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';
const BORDER     = '#1E2235';

function StatusBadge({ open }: { open: boolean }) {
  const color = open ? DOWN_COLOR : '#8B8FA8';
  return (
    <span style={{
      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700,
      color, background: `${color}22`, border: `1px solid ${color}44`,
    }}>
      {open ? '● 開盤中' : '○ 已收盤'}
    </span>
  );
}

export default function DazhangPage() {
  const open    = isMarketOpen();
  const scanner = useIntradayScanner(open);

  const allSignals = [
    ...scanner.bull.flatMap(r => r.signals),
    ...scanner.bear.flatMap(r => r.signals),
  ];

  const lastUpdated = scanner.lastScanAt
    ? scanner.lastScanAt.toLocaleTimeString('zh-TW', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei',
      })
    : null;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`,
          padding: '16px 20px',
          display: 'flex', flexWrap: 'wrap', gap: 12,
          alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>
              AI 盯盤
            </h1>
            <StatusBadge open={open} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastUpdated && (
              <span style={{ fontSize: 11, color: '#8B8FA8' }}>
                上次更新 {lastUpdated}
              </span>
            )}
            {open && (
              <button
                onClick={scanner.rescan}
                disabled={scanner.status === 'scanning'}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  color: DOWN_COLOR, background: `${DOWN_COLOR}18`,
                  border: `1px solid ${DOWN_COLOR}44`, cursor: 'pointer',
                  opacity: scanner.status === 'scanning' ? 0.5 : 1,
                }}
              >
                {scanner.status === 'scanning' ? '掃描中...' : '立即重掃'}
              </button>
            )}
          </div>
        </div>

        {/* ── Market open: intraday view ──────────────────────────────────── */}
        {open && (
          <>
            {/* Progress bar (hide when done) */}
            {scanner.status === 'scanning' && (
              <div style={{ background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`, padding: '10px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#8B8FA8' }}>
                    掃描中 {scanner.scannedCount}/{scanner.totalCount} 檔
                  </span>
                  <span style={{ fontSize: 12, color: DOWN_COLOR }}>{scanner.progress}%</span>
                </div>
                <div style={{ height: 4, background: BORDER, borderRadius: 2 }}>
                  <div style={{
                    height: '100%', width: `${scanner.progress}%`,
                    background: DOWN_COLOR, borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            )}

            {/* Trend strength chart */}
            {allSignals.length > 0 && (
              <TrendStrengthChart
                signals={allSignals}
                isLoading={scanner.status === 'scanning'}
              />
            )}

            {/* Signal feed */}
            <IntradaySignalFeed scanState={scanner} />

            {/* Dual screener */}
            <DualScreener scanState={scanner} />
          </>
        )}

        {/* ── Market closed: after-hours view ────────────────────────────── */}
        {!open && (
          <>
            {/* After-hours banner */}
            <div style={{
              background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`,
              padding: '16px 20px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: '#1E2235', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: 18,
              }}>
                🌙
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                  盤後技術分析模式
                </div>
                <div style={{ fontSize: 12, color: '#8B8FA8' }}>
                  台股交易時間為週一至週五 09:00–13:30。
                  以下為今日收盤後技術面掃描結果，供明日開盤參考。
                </div>
              </div>
            </div>

            {/* After-hours screener */}
            <AfterHoursScreener />
          </>
        )}

        {/* Error state */}
        {scanner.status === 'error' && (
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: `${UP_COLOR}18`, border: `1px solid ${UP_COLOR}44`,
            fontSize: 12, color: UP_COLOR,
          }}>
            掃描時發生錯誤，部分資料可能不完整。請點擊「立即重掃」重試。
          </div>
        )}

      </div>
    </div>
  );
}
