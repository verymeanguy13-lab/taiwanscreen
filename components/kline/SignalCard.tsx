'use client';

// =============================================================================
// components/kline/SignalCard.tsx
// =============================================================================

import { useRouter } from 'next/navigation';
import type { SignalResult } from '@/app/api/kline/accuracy/route';

interface SignalCardProps {
  signal: SignalResult;
  period: '5d' | '10d' | '20d';
}

const SIGNAL_COLORS: Record<string, string> = {
  '上漲趨勢突破': 'var(--accent-green)',
  '箱型整理突破': 'var(--accent-blue)',
  '下跌V轉突破':  'var(--accent-gold)',
  '昨日強勢股':   'var(--accent-green)',
  '近五日強勢股': 'var(--accent-green)',
  '開布林':       '#A78BFA',
  '突破壓力':     'var(--accent-blue)',
  '剛轉多':       'var(--accent-gold)',
};

export function SignalCard({ signal, period }: SignalCardProps) {
  const router = useRouter();

  const ret =
    period === '5d'  ? signal.return_5d  :
    period === '10d' ? signal.return_10d :
                       signal.return_20d;

  const priceUp =
    period === '5d'  ? signal.price_up_5d  :
    period === '10d' ? signal.price_up_10d :
                       signal.price_up_20d;

  // Taiwan convention: red = up (bullish), green = down (bearish)
  const retColor  = ret === null ? 'var(--text-muted)' : ret >= 0 ? 'var(--accent-red)' : 'var(--accent-green)';
  const chipColor = SIGNAL_COLORS[signal.signal_type] ?? 'var(--text-secondary)';

  return (
    <div
      onClick={() => router.push(`/stock/${signal.symbol}`)}
      style={{
        display:         'flex',
        flexDirection:   'column',
        gap:             8,
        padding:         '12px 14px',
        borderRadius:    10,
        border:          '1px solid var(--border)',
        backgroundColor: 'var(--bg-card)',
        cursor:          'pointer',
        transition:      'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--text-muted)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

        {/* LEFT — date + signal type chip */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 72 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {String(signal.signal_date).slice(0, 10)}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: chipColor,
            backgroundColor: `${chipColor}20`,
            border: `1px solid ${chipColor}40`,
            borderRadius: 4, padding: '1px 6px',
            whiteSpace: 'nowrap', display: 'inline-block',
          }}>
            {signal.signal_type}
          </span>
        </div>

        {/* CENTER — symbol + industry */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              {signal.symbol}
            </span>
            {signal.industry && (
              <span style={{
                fontSize: 10, color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-secondary)',
                padding: '1px 5px', borderRadius: 4,
              }}>
                {signal.industry}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            進場價 {Number(signal.entry_price).toFixed(2)}
          </span>
        </div>

        {/* RIGHT — return % + badge */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: retColor, lineHeight: 1 }}>
            {ret === null ? '—' : `${ret >= 0 ? '+' : ''}${Number(ret).toFixed(2)}%`}
          </span>
          {priceUp !== null && (
            <span style={{
              fontSize: 11, fontWeight: 600,
              color:           priceUp ? 'var(--accent-red)'     : 'var(--accent-green)',
              backgroundColor: priceUp ? 'rgba(255,77,109,0.12)' : 'rgba(0,212,170,0.12)',
              border:          priceUp ? '1px solid rgba(255,77,109,0.3)' : '1px solid rgba(0,212,170,0.3)',
              borderRadius: 4, padding: '1px 8px',
            }}>
              {priceUp ? '▲ 上漲' : '▼ 下跌'}
            </span>
          )}
        </div>
      </div>

      {/* Confidence bar */}
      {signal.confidence !== null && signal.confidence > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>信心指數</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{signal.confidence}/100</span>
          </div>
          <div style={{ height: 3, borderRadius: 2, backgroundColor: 'var(--border)' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${signal.confidence}%`,
              backgroundColor:
                signal.confidence >= 70 ? 'var(--accent-red)'   :
                signal.confidence >= 50 ? 'var(--accent-gold)'  : 'var(--accent-green)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}
