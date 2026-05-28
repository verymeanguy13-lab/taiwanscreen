'use client';

import type { Candle } from '@/types';

interface OHLCBarProps {
  candle:  Candle | null;
  sma5:    number | null;
  sma20:   number | null;
  sma60:   number | null;
}

function Num({ v, color }: { v: number | null | undefined; color?: string }) {
  if (v == null) return <span className="num" style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span className="num" style={{ color: color ?? 'var(--text-primary)', fontFamily: "'IBM Plex Mono', monospace" }}>
      {v.toFixed(2)}
    </span>
  );
}

export function OHLCBar({ candle, sma5, sma20, sma60 }: OHLCBarProps) {
  const isUp   = candle ? candle.close >= candle.open : true;
  const chgAmt = candle ? (candle.close - candle.open) : null;
  const chgPct = candle && candle.open !== 0
    ? ((candle.close - candle.open) / candle.open) * 100
    : null;

  const priceColor = isUp ? '#FF4D6D' : '#00D4AA';

  return (
    <div
      style={{
        display:         'flex',
        flexWrap:        'wrap',
        alignItems:      'center',
        gap:             '0 20px',
        padding:         '6px 12px',
        background:      '#0F1117',
        borderBottom:    '1px solid #1E2235',
        fontSize:        '11px',
        color:           'var(--text-secondary)',
        fontFamily:      "'IBM Plex Mono', monospace",
        letterSpacing:   '0.02em',
        minHeight:       '32px',
      }}
    >
      {/* OHLC */}
      <span>開 <Num v={candle?.open} /></span>
      <span>高 <Num v={candle?.high} /></span>
      <span>低 <Num v={candle?.low}  /></span>
      <span>收 <Num v={candle?.close} color={priceColor} /></span>

      {/* Change */}
      <span>
        漲跌{' '}
        {chgAmt != null && chgPct != null ? (
          <span style={{ color: priceColor, fontFamily: "'IBM Plex Mono', monospace" }}>
            {chgAmt >= 0 ? '+' : ''}{chgAmt.toFixed(2)}
            {' '}({chgPct >= 0 ? '+' : ''}{chgPct.toFixed(2)}%)
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>—</span>
        )}
      </span>

      {/* Divider */}
      <span style={{ color: '#1E2235', userSelect: 'none' }}>│</span>

      {/* MA values */}
      <span>5MA <Num v={sma5}  color="#3D8EF8" /></span>
      <span>20MA <Num v={sma20} color="#F5B700" /></span>
      <span>60MA <Num v={sma60} color="#9B59B6" /></span>
    </div>
  );
}
