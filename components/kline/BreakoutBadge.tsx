'use client';

import { useState } from 'react';
import type { BreakoutSignal } from '@/lib/breakouts';

interface BreakoutBadgeProps {
  signal: BreakoutSignal;
  x:      number;
  y:      number;
}

const TYPE_CONFIG = {
  '上漲趨勢突破': { bg: '#0D1B3B', border: '#3D8EF833', label: '趨勢↑', color: '#3D8EF8' },
  '箱型整理突破': { bg: '#3B2D00', border: '#F5B70033', label: '箱型↑', color: '#F5B700' },
  '下跌V轉突破': { bg: '#3B0D0D', border: '#FF4D6D33', label: 'V轉↑',  color: '#FF4D6D' },
} as const;

function LevelRow({ label, value }: { label: string; value: number | undefined }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #1E2235' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>{value.toFixed(2)}</span>
    </div>
  );
}

export function BreakoutBadge({ signal, x, y }: BreakoutBadgeProps) {
  const [open, setOpen] = useState(false);
  const cfg = TYPE_CONFIG[signal.type];

  return (
    <>
      {/* Badge pill */}
      <div
        onClick={() => setOpen(true)}
        style={{
          position:      'absolute',
          left:          x,
          top:           y - 32,
          transform:     'translateX(-50%)',
          background:    cfg.bg,
          border:        `1px solid ${cfg.border}`,
          borderRadius:  '4px',
          padding:       '2px 7px',
          fontSize:      '10px',
          fontWeight:    700,
          color:         cfg.color,
          whiteSpace:    'nowrap',
          cursor:        'pointer',
          zIndex:        10,
          userSelect:    'none',
          pointerEvents: 'all',
          letterSpacing: '0.03em',
        }}
      >
        {cfg.label}
      </div>

      {/* Bottom sheet */}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50 }}
          />

          <div
            style={{
              position:     'fixed',
              bottom:       0,
              left:         0,
              right:        0,
              background:   '#0F1117',
              border:       '1px solid #1E2235',
              borderRadius: '16px 16px 0 0',
              padding:      '20px',
              zIndex:       51,
              maxHeight:    '70vh',
              overflowY:    'auto',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: cfg.color, display: 'inline-block',
                    }}
                  />
                  <span style={{ fontSize: 17, fontWeight: 700, color: '#fff' }}>{signal.type}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'IBM Plex Mono', monospace" }}>
                  {signal.date} · NT${signal.price.toFixed(2)}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: '#8B8FA8', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Trigger description */}
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6, background: '#1A1D2E', padding: '10px 12px', borderRadius: 8 }}>
              {signal.triggerDescription}
            </p>

            {/* Confidence */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>突破強度</span>
                <span style={{ color: cfg.color, fontWeight: 700 }}>{signal.confidence}%</span>
              </div>
              <div style={{ height: 6, background: '#1E2235', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%', width: `${signal.confidence}%`,
                    background: cfg.color, borderRadius: 3,
                  }}
                />
              </div>
            </div>

            {/* Volume confirmed */}
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span
                style={{
                  padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                  background: signal.volumeConfirmed ? '#0D3B2E' : '#3B0D0D',
                  color:      signal.volumeConfirmed ? '#00D4AA'  : '#FF4D6D',
                  border:     `1px solid ${signal.volumeConfirmed ? '#00D4AA44' : '#FF4D6D44'}`,
                }}
              >
                {signal.volumeConfirmed ? '✓ 量能確認' : '✗ 量能未確認'}
              </span>
            </div>

            {/* Key levels */}
            <div style={{ fontSize: 12, color: '#fff', fontWeight: 600, marginBottom: 8 }}>關鍵價位</div>
            <LevelRow label="支撐"    value={signal.keyLevels.support}     />
            <LevelRow label="壓力"    value={signal.keyLevels.resistance}  />
            <LevelRow label="箱頂"    value={signal.keyLevels.boxUpper}    />
            <LevelRow label="箱底"    value={signal.keyLevels.boxLower}    />
            <LevelRow label="V型低點" value={signal.keyLevels.vBottom}     />
          </div>
        </>
      )}
    </>
  );
}
