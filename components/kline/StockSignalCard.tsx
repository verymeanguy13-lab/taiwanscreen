'use client';

import Link from 'next/link';
import type { ScanResult } from './IntradayScanner';

interface Props {
  result: ScanResult;
  mode:   'intraday' | 'afterhours';
  side:   'bull' | 'bear';
  score?: number;
}

const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';
const CARD_BG    = '#0F1117';
const BORDER     = '#1E2235';

const strengthDots = (n: 1 | 2 | 3) =>
  Array.from({ length: 3 }, (_, i) => (
    <span
      key={i}
      style={{
        display: 'inline-block', width: 5, height: 5,
        borderRadius: '50%', marginRight: 2,
        background: i < n ? '#F5B700' : '#1E2235',
      }}
    />
  ));

function ScoreBadge({ score, side }: { score: number; side: 'bull' | 'bear' }) {
  const accentColor = side === 'bull' ? UP_COLOR : DOWN_COLOR;
  const pct = Math.min(100, Math.max(0, score));

  // label
  let label = '中性';
  let labelColor = '#8B8FA8';
  if (score >= 70) { label = side === 'bull' ? '強烈看多' : '強烈看空'; labelColor = accentColor; }
  else if (score >= 55) { label = side === 'bull' ? '偏多' : '偏空'; labelColor = accentColor; }
  else if (score <= 35) { label = '偏弱'; labelColor = '#8B8FA8'; }

  return (
    <div style={{ marginTop: 8 }}>
      {/* bar + label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          flex: 1, height: 4, borderRadius: 2,
          background: '#1E2235', overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 2,
            background: accentColor,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#fff',
          fontFamily: "'IBM Plex Mono', monospace", minWidth: 24, textAlign: 'right',
        }}>
          {score}
        </span>
        <span style={{
          fontSize: 10, color: labelColor,
          background: `${labelColor}18`,
          border: `1px solid ${labelColor}33`,
          borderRadius: 4, padding: '1px 6px',
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export function StockSignalCard({ result, mode, side, score }: Props) {
  const accentColor = side === 'bull' ? UP_COLOR : DOWN_COLOR;
  const changeColor = result.changePercent >= 0 ? UP_COLOR : DOWN_COLOR;

  return (
    <Link href={`/stock/${result.symbol}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: CARD_BG, border: `1px solid ${BORDER}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 8, padding: '10px 12px', marginBottom: 8,
        cursor: 'pointer', transition: 'border-color 0.15s',
      }}>
        {/* Row 1: symbol + name + price + change */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'IBM Plex Mono', monospace", marginRight: 6 }}>
              {result.symbol}
            </span>
            <span style={{ fontSize: 12, color: '#8B8FA8' }}>{result.name_zh}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>
              {result.price.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: changeColor, fontFamily: "'IBM Plex Mono', monospace" }}>
              {result.changePercent >= 0 ? '+' : ''}{result.changePercent.toFixed(2)}%
            </div>
          </div>
        </div>

        {/* Row 2: sector tag + dominant chip */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          {result.sector && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4,
              color: '#8B8FA8', background: '#1E2235', border: '1px solid #2A2D3E',
            }}>
              {result.sector}
            </span>
          )}
          {result.yesterdayTrend !== '中性' && (
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
              color: result.yesterdayTrend.includes('強') ? UP_COLOR : DOWN_COLOR,
              background: result.yesterdayTrend.includes('強') ? `${UP_COLOR}18` : `${DOWN_COLOR}18`,
              border: `1px solid ${result.yesterdayTrend.includes('強') ? UP_COLOR : DOWN_COLOR}44`,
            }}>
              {result.yesterdayTrend}
            </span>
          )}
        </div>

        {/* Row 3: signal badges (intraday) or strategy chips (afterhours) */}
        {mode === 'intraday' ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {result.signals.filter(s => s.side === side).map((sig, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                color: accentColor,
                background: `${accentColor}18`,
                border: `1px solid ${accentColor}44`,
              }}>
                {sig.type}
                <span>{strengthDots(sig.strength)}</span>
              </span>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {(side === 'bull'
              ? result.trendStrength.dominantSide === 'bull'
              : result.trendStrength.dominantSide === 'bear'
            ) && (
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                color: accentColor, background: `${accentColor}18`,
                border: `1px solid ${accentColor}44`,
              }}>
                {side === 'bull' ? `多方 ${result.trendStrength.bullScore}` : `空方 ${result.trendStrength.bearScore}`}
              </span>
            )}
            {result.signals.slice(0, 3).map((sig, i) => (
              <span key={i} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4,
                color: '#8B8FA8', background: '#1E2235', border: '1px solid #2A2D3E',
              }}>
                {sig.type}
              </span>
            ))}
          </div>
        )}

        {/* Row 4: composite score bar */}
        {score !== undefined && (
          <ScoreBadge score={score} side={side} />
        )}
      </div>
    </Link>
  );
}
