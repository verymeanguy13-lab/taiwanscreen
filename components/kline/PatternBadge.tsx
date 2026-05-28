'use client';

import { useState } from 'react';
import type { DetectedPattern } from '@/lib/patterns';

interface PatternBadgeProps {
  pattern: DetectedPattern;
  x:       number;
  y:       number;
}

const READING_COLOR: Record<string, string> = {
  '強勢突破': '#FF4D6D',
  '偏多格局': '#FF8FA3',
  '盤整觀察': '#8B8FA8',
  '偏空格局': '#4DFFB8',
  '弱勢整理': '#00D4AA',
};

export function PatternBadge({ pattern, x, y }: PatternBadgeProps) {
  const [open, setOpen] = useState(false);

  const isBull = pattern.type === 'bullish';
  const bg     = isBull ? '#0D3B2E' : pattern.type === 'bearish' ? '#3B0D0D' : '#1E2235';
  const border = isBull ? '#00D4AA33' : pattern.type === 'bearish' ? '#FF4D6D33' : '#8B8FA833';

  return (
    <>
      {/* Pill badge — absolutely positioned over chart canvas */}
      <div
        onClick={() => setOpen(true)}
        style={{
          position:      'absolute',
          left:          x,
          top:           y - 28,
          transform:     'translateX(-50%)',
          background:    bg,
          border:        `1px solid ${border}`,
          borderRadius:  '4px',
          padding:       '2px 6px',
          fontSize:      '10px',
          color:         '#fff',
          whiteSpace:    'nowrap',
          cursor:        'pointer',
          zIndex:        10,
          display:       'flex',
          alignItems:    'center',
          gap:           '3px',
          userSelect:    'none',
          pointerEvents: 'all',
        }}
      >
        {pattern.name}
        <span style={{ opacity: 0.7, fontSize: '9px' }}>ⓘ</span>
      </div>

      {/* Bottom sheet */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position:   'fixed',
              inset:      0,
              background: 'rgba(0,0,0,0.6)',
              zIndex:     50,
            }}
          />

          {/* Sheet */}
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
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
                  {pattern.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {pattern.nameEN}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: '#8B8FA8', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Description */}
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
              {pattern.description}
            </p>

            {/* Technical reading chip */}
            <div style={{ marginBottom: 16 }}>
              <span
                style={{
                  display:      'inline-block',
                  padding:      '3px 10px',
                  borderRadius: '12px',
                  fontSize:     11,
                  fontWeight:   600,
                  color:        '#fff',
                  background:   READING_COLOR[pattern.technicalReading] ?? '#8B8FA8',
                }}
              >
                {pattern.technicalReading}
              </span>
            </div>

            {/* Win rate bar */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>歷史勝率</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{pattern.historicalWinRate}%</span>
              </div>
              <div style={{ height: 6, background: '#1E2235', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height:     '100%',
                    width:      `${pattern.historicalWinRate}%`,
                    background: isBull ? '#00D4AA' : '#FF4D6D',
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>

            {/* Confidence */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>訊號強度</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{pattern.confidence}%</span>
              </div>
              <div style={{ height: 6, background: '#1E2235', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height:     '100%',
                    width:      `${pattern.confidence}%`,
                    background: '#3D8EF8',
                    borderRadius: 3,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
