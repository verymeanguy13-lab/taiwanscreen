'use client';

import type { ScanState } from './IntradayScanner';

interface Props {
  scanState: ScanState;
}

const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';
const BORDER     = '#1E2235';

const strengthDots = (n: 1 | 2 | 3) =>
  Array.from({ length: 3 }, (_, i) => (
    <span
      key={i}
      style={{
        display: 'inline-block', width: 4, height: 4,
        borderRadius: '50%', marginRight: 1,
        background: i < n ? '#F5B700' : '#1E2235',
      }}
    />
  ));

export function IntradaySignalFeed({ scanState }: Props) {
  const { status, progress, scannedCount, totalCount, bull, bear } = scanState;

  // Flatten all signals across all stocks, sorted by time
  const allEvents = [
    ...bull.flatMap(r =>
      r.signals
        .filter(s => s.side === 'bull')
        .map(s => ({ ...s, symbol: r.symbol, name_zh: r.name_zh }))
    ),
    ...bear.flatMap(r =>
      r.signals
        .filter(s => s.side === 'bear')
        .map(s => ({ ...s, symbol: r.symbol, name_zh: r.name_zh }))
    ),
  ].sort((a, b) => a.time.localeCompare(b.time));

  if (status === 'idle') {
    return (
      <div style={{
        padding: '24px', textAlign: 'center',
        color: '#8B8FA8', fontSize: 13,
        background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`,
      }}>
        開盤後將自動開始掃描訊號
      </div>
    );
  }

  return (
    <div style={{ background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px', borderBottom: `1px solid ${BORDER}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>即時訊號流</span>
        {status === 'scanning' && (
          <span style={{ fontSize: 11, color: '#8B8FA8' }}>
            掃描中 {scannedCount}/{totalCount}...
          </span>
        )}
        {status === 'done' && (
          <span style={{ fontSize: 11, color: DOWN_COLOR }}>
            {allEvents.length} 個訊號
          </span>
        )}
      </div>

      {/* Progress bar */}
      {status === 'scanning' && (
        <div style={{ height: 2, background: BORDER }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: DOWN_COLOR, transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {/* Signal list */}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {allEvents.length === 0 && status === 'done' && (
          <div style={{ padding: 24, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>
            本次掃描未偵測到訊號
          </div>
        )}
        {allEvents.map((event, i) => {
          const color = event.side === 'bull' ? UP_COLOR : DOWN_COLOR;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '8px 16px',
              borderBottom: i < allEvents.length - 1 ? `1px solid ${BORDER}` : 'none',
            }}>
              {/* Time */}
              <span style={{
                fontSize: 11, color: '#8B8FA8', flexShrink: 0,
                fontFamily: "'IBM Plex Mono', monospace", minWidth: 40,
              }}>
                {event.time}
              </span>

              {/* Symbol */}
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
                fontFamily: "'IBM Plex Mono', monospace", minWidth: 40,
              }}>
                {event.symbol}
              </span>

              {/* Signal type chip */}
              <span style={{
                fontSize: 10, padding: '1px 7px', borderRadius: 4, fontWeight: 600,
                color, background: `${color}18`, border: `1px solid ${color}44`,
                flexShrink: 0,
              }}>
                {event.type}
              </span>

              {/* Description */}
              <span style={{ fontSize: 11, color: '#8B8FA8', flex: 1, lineHeight: 1.4 }}>
                {event.description}
              </span>

              {/* Strength dots */}
              <span style={{ flexShrink: 0 }}>{strengthDots(event.strength)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
