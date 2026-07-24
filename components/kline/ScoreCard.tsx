'use client';

import type { ScoreResult } from '@/lib/scoring';
import type { BreakoutSignal } from '@/lib/breakouts';

interface ScoreCardProps {
  score: ScoreResult;
}

const READING_CONFIG = {
  '技術面強勢': { color: '#FF4D6D', bg: '#3B0D1A' },
  '技術面轉強': { color: '#FF8FA3', bg: '#2D1020' },
  '中性':       { color: '#8B8FA8', bg: '#1A1D2E' },
  '技術面轉弱': { color: '#4DFFB8', bg: '#0D2420' },
  '技術面弱勢': { color: '#00D4AA', bg: '#0D2E28' },
} as const;

const BREAKOUT_CONFIG = {
  '上漲趨勢突破': { color: '#3D8EF8', bg: '#0D1B3B' },
  '箱型整理突破': { color: '#F5B700', bg: '#3B2D00' },
  '下跌V轉突破':  { color: '#FF4D6D', bg: '#3B0D0D' },
} as const;

const DIMENSIONS = [
  { key: 'trend',     label: '趨勢' },
  { key: 'momentum',  label: '動能' },
  { key: 'volume',    label: '量能' },
  { key: 'chips',     label: '籌碼' },
  { key: 'pattern',   label: '型態' },
  { key: 'sentiment', label: '情緒' },
] as const;

function DimBar({ label, dim }: { label: string; dim: { score: number; reason: string } }) {
  const color = dim.score > 65 ? '#00D4AA' : dim.score > 40 ? '#F5B700' : '#FF4D6D';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700 }}>
          {dim.score}
        </span>
      </div>
      <div style={{ height: 4, background: '#1E2235', borderRadius: 2, overflow: 'hidden', marginBottom: 3 }}>
        <div
          style={{
            height:     '100%',
            width:      `${dim.score}%`,
            background: color,
            borderRadius: 2,
            transition: 'width 0.5s ease',
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>{dim.reason}</div>
    </div>
  );
}

export function ScoreCard({ score }: ScoreCardProps) {
  const reading = READING_CONFIG[score.technicalReading] ?? READING_CONFIG['中性'];

  return (
    <div
      style={{
        background:   '#0F1117',
        border:       '1px solid #1E2235',
        borderRadius: 8,
        padding:      16,
        marginTop:    8,
      }}
    >
      {/* ── Header: score + reading ──────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        {/* Score circle */}
        <div
          style={{
            width:        64,
            height:       64,
            borderRadius: '50%',
            border:       `3px solid ${reading.color}`,
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            flexShrink:   0,
            background:   reading.bg,
          }}
        >
          <span
            style={{
              fontSize:   22,
              fontWeight: 800,
              color:      reading.color,
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {score.overall}
          </span>
        </div>

        <div>
          {/* Reading chip */}
          <span
            style={{
              display:      'inline-block',
              padding:      '3px 10px',
              borderRadius: '12px',
              fontSize:     12,
              fontWeight:   700,
              color:        reading.color,
              background:   reading.bg,
              border:       `1px solid ${reading.color}44`,
              marginBottom: 6,
            }}
          >
            {score.technicalReading}
          </span>

          {/* Signal matrix summary */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            強勢{' '}
            <span style={{ color: '#fff', fontWeight: 700 }}>{score.matrix.strengthCount}</span>
            /9　量能{' '}
            <span style={{ color: '#fff', fontWeight: 700 }}>{score.matrix.volumeCount}</span>
            /6
          </div>
        </div>
      </div>

      {/* ── Breakout chips ────────────────────────────────────────────────── */}
      {score.breakouts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {score.breakouts.map((b: BreakoutSignal, i: number) => {
            const cfg = BREAKOUT_CONFIG[b.type];
            return (
              <span
                key={i}
                style={{
                  padding:      '2px 8px',
                  borderRadius: '4px',
                  fontSize:     10,
                  fontWeight:   700,
                  color:        cfg.color,
                  background:   cfg.bg,
                  border:       `1px solid ${cfg.color}44`,
                  letterSpacing: '0.03em',
                }}
              >
                {b.type} {b.confidence}%
              </span>
            );
          })}
        </div>
      )}

      {/* ── 6 dimension bars — 2 columns ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
        {DIMENSIONS.map(({ key, label }) => {
          const dim = score.dimensions[key];
          if (!dim) return null;
          return (
            <DimBar
              key={key}
              label={label}
              dim={dim}
            />
          );
        })}
      </div>
    </div>
  );
}
