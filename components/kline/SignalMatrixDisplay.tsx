'use client';

import { useState } from 'react';

interface SignalItem {
  nameZH:      string;
  fired:       boolean;
  value?:      string;
  description: string;
  category:    'strength' | 'volume';
}

interface SignalMatrix {
  strengthCount: number;
  volumeCount:   number;
  items:         SignalItem[];
}

interface Props {
  matrix:    SignalMatrix;
  expanded?: boolean;
}

const BORDER   = '#1E2235';
const UP_COLOR = '#00D4AA';

export function SignalMatrixDisplay({ matrix, expanded: defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const strengthItems = matrix.items?.filter(i => i.category === 'strength') ?? [];
  const volumeItems   = matrix.items?.filter(i => i.category === 'volume')   ?? [];

  const scoreTotal  = matrix.strengthCount + matrix.volumeCount;
  const scoreMax    = 15; // 9 + 6
  const scorePct    = Math.round((scoreTotal / scoreMax) * 100);
  const barColor    = scorePct >= 66 ? UP_COLOR : scorePct >= 40 ? '#F5B700' : '#FF4D6D';

  return (
    <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>

      {/* Compact view */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>

        {/* Strength dots (9) */}
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 80 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} style={{
              width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
              background: i < matrix.strengthCount ? UP_COLOR : BORDER,
            }} />
          ))}
        </div>

        <span style={{ fontSize: 10, color: '#8B8FA8' }}>強勢</span>

        {/* Volume dots (6) */}
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', maxWidth: 56 }}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} style={{
              width: 8, height: 8, borderRadius: '50%', display: 'inline-block',
              background: i < matrix.volumeCount ? '#F5B700' : BORDER,
            }} />
          ))}
        </div>

        <span style={{ fontSize: 10, color: '#8B8FA8' }}>量能</span>

        {/* Summary text */}
        <span style={{ fontSize: 11, color: '#fff', fontWeight: 700, marginLeft: 4 }}>
          {matrix.strengthCount}/9 · {matrix.volumeCount}/6
        </span>
      </div>

      {/* Score bar */}
      <div style={{ height: 4, background: BORDER, borderRadius: 2, marginBottom: 10 }}>
        <div style={{
          height: '100%', width: `${scorePct}%`,
          background: barColor, borderRadius: 2,
          transition: 'width 0.5s ease',
        }} />
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          fontSize: 11, color: UP_COLOR, background: 'transparent',
          border: 'none', cursor: 'pointer', padding: 0, marginBottom: expanded ? 10 : 0,
        }}
      >
        {expanded ? '收起 ▴' : '展開 ▾'}
      </button>

      {/* Expanded list */}
      {expanded && (
        <div>
          {/* Strength signals */}
          {strengthItems.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: '#8B8FA8', marginBottom: 4, fontWeight: 600 }}>
                強勢訊號
              </div>
              {strengthItems.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '5px 0',
                  borderBottom: i < strengthItems.length - 1 ? `1px solid ${BORDER}` : 'none',
                }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                    {item.fired ? '✓' : '✗'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: item.fired ? '#fff' : '#8B8FA8',
                      }}>
                        {item.nameZH}
                      </span>
                      {item.value && (
                        <span style={{
                          fontSize: 10, color: item.fired ? UP_COLOR : '#8B8FA8',
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}>
                          {item.value}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#8B8FA8', lineHeight: 1.4 }}>
                      {item.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Volume signals */}
          {volumeItems.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#8B8FA8', marginBottom: 4, fontWeight: 600 }}>
                量能訊號
              </div>
              {volumeItems.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '5px 0',
                  borderBottom: i < volumeItems.length - 1 ? `1px solid ${BORDER}` : 'none',
                }}>
                  <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                    {item.fired ? '✓' : '✗'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600,
                        color: item.fired ? '#fff' : '#8B8FA8',
                      }}>
                        {item.nameZH}
                      </span>
                      {item.value && (
                        <span style={{
                          fontSize: 10, color: item.fired ? '#F5B700' : '#8B8FA8',
                          fontFamily: "'IBM Plex Mono', monospace",
                        }}>
                          {item.value}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#8B8FA8', lineHeight: 1.4 }}>
                      {item.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {matrix.items?.length === 0 && (
            <div style={{ fontSize: 12, color: '#8B8FA8', textAlign: 'center', padding: 12 }}>
              暫無訊號資料
            </div>
          )}
        </div>
      )}
    </div>
  );
}
