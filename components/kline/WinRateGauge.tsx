'use client';

// =============================================================================
// components/kline/WinRateGauge.tsx
// =============================================================================

interface WinRateGaugeProps {
  priceUpRate:  number;   // 0–100
  totalSignals: number;
  signalType:   string;
  isSelected?:  boolean;
  onClick?:     () => void;
}

export function WinRateGauge({
  priceUpRate,
  totalSignals,
  signalType,
  isSelected = false,
  onClick,
}: WinRateGaugeProps) {
  const SIZE   = 120;
  const STROKE = 10;
  const R      = (SIZE - STROKE) / 2;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;
  const CIRCUM = 2 * Math.PI * R;
  const arc    = (Math.min(priceUpRate, 100) / 100) * CIRCUM;

  // Taiwan convention: high win rate = bullish = red, low = bearish = green
  const color =
    priceUpRate >= 60 ? 'var(--accent-red)'   :
    priceUpRate >= 50 ? 'var(--accent-gold)'  :
                        'var(--accent-green)';

  return (
    <button
      onClick={onClick}
      style={{
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        gap:             8,
        padding:         '12px 8px',
        borderRadius:    12,
        border:          isSelected ? `2px solid ${color}` : '2px solid var(--border)',
        backgroundColor: isSelected ? 'rgba(0,212,170,0.06)' : 'var(--bg-card)',
        cursor:          'pointer',
        width:           '100%',
        transition:      'border-color 0.15s',
      }}
    >
      {/* SVG ring + overlay text */}
      <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          style={{ transform: 'rotate(-90deg)', position: 'absolute', top: 0, left: 0 }}
        >
          {/* Background track */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="var(--border)"
            strokeWidth={STROKE}
          />
          {/* Filled arc */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeDasharray={`${arc} ${CIRCUM}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>

        {/* Center text */}
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: SIZE, height: SIZE,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 2,
        }}>
          <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>
            {priceUpRate.toFixed(1)}%
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
            共 {totalSignals} 次
          </span>
        </div>
      </div>

      {/* Signal type label */}
      <span style={{
        fontSize: 11, fontWeight: 600,
        color: 'var(--text-primary)',
        textAlign: 'center',
        lineHeight: 1.3,
      }}>
        {signalType}
      </span>
    </button>
  );
}
