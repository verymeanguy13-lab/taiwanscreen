'use client';

import useSWR from 'swr';
import { useState, useEffect } from 'react';
import { ScoreRadar }            from './ScoreRadar';
import { SignalMatrixDisplay }   from './SignalMatrixDisplay';
import { Skeleton }              from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const BORDER   = '#1E2235';
const UP_COLOR = '#FF4D6D';
const DN_COLOR = '#00D4AA';

const BREAKOUT_CONFIG: Record<string, { color: string; bg: string }> = {
  '上漲趨勢突破': { color: '#3D8EF8', bg: '#0D1B3B' },
  '箱型整理突破': { color: '#F5B700', bg: '#3B2D00' },
  '下跌V轉突破':  { color: UP_COLOR,  bg: '#3B0D0D' },
};

// Animated SVG donut ring
function ScoreRing({ score, reading }: { score: number; reading: string }) {
  const [anim, setAnim] = useState(0);
  useEffect(() => { const t = setTimeout(() => setAnim(score), 80); return () => clearTimeout(t); }, [score]);

  const R           = 54;
  const CIRC        = 2 * Math.PI * R;
  const dashOffset  = CIRC - (anim / 100) * CIRC;
  const color       = score >= 75 ? DN_COLOR : score >= 50 ? '#7BCF72' : score >= 25 ? '#F5B700' : UP_COLOR;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
      <svg width={130} height={130} viewBox="0 0 130 130">
        <circle cx={65} cy={65} r={R} fill="none" stroke={BORDER} strokeWidth={10} />
        <circle
          cx={65} cy={65} r={R} fill="none"
          stroke={color} strokeWidth={10}
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 65 65)"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <text x={65} y={60} textAnchor="middle" fontSize={24} fontWeight={800} fill={color} fontFamily="'IBM Plex Mono', monospace">
          {score}
        </text>
        <text x={65} y={76} textAnchor="middle" fontSize={9} fill="#8B8FA8" fontFamily="system-ui, sans-serif">
          {reading}
        </text>
      </svg>
    </div>
  );
}

// Client-side backtest over candle history
function BacktestTable({ candles, breakouts }: { candles: any[]; breakouts: any[] }) {
  if (!breakouts || breakouts.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#8B8FA8', textAlign: 'center', padding: 16 }}>
        目前無起漲突破訊號
      </div>
    );
  }

  const rows = breakouts.map((b: any) => {
    const idx = candles.findIndex((c: any) => c.date === b.date);
    if (idx < 0) return null;
    const entryPrice = b.price ?? candles[idx]?.close;
    const exitCandle = candles[idx + 5];
    if (!exitCandle || !entryPrice) return null;
    const fwdReturn = ((exitCandle.close - entryPrice) / entryPrice) * 100;
    return {
      date:      b.date,
      type:      b.type,
      entry:     entryPrice,
      fwdReturn,
      win:       fwdReturn > 0,
    };
  }).filter(Boolean) as { date: string; type: string; entry: number; fwdReturn: number; win: boolean }[];

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#8B8FA8', textAlign: 'center', padding: 16 }}>
        歷史資料不足，無法回測
      </div>
    );
  }

  const winCount = rows.filter(r => r.win).length;
  const avgReturn = rows.reduce((s, r) => s + r.fwdReturn, 0) / rows.length;

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#8B8FA8' }}>
          共 <span style={{ color: '#fff', fontWeight: 700 }}>{rows.length}</span> 次型態
        </span>
        <span style={{ fontSize: 11, color: '#8B8FA8' }}>
          5日後上漲比例 <span style={{ color: DN_COLOR, fontWeight: 700 }}>{Math.round((winCount / rows.length) * 100)}%</span>
        </span>
        <span style={{ fontSize: 11, color: '#8B8FA8' }}>
          平均價格變動 <span style={{
            color: avgReturn >= 0 ? DN_COLOR : UP_COLOR, fontWeight: 700,
          }}>
            {avgReturn >= 0 ? '+' : ''}{avgReturn.toFixed(1)}%
          </span>
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {['日期', '訊號類型', '進場價', '5日後漲跌%', '結果'].map(h => (
                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', color: '#8B8FA8', fontWeight: 600 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const cfg = BREAKOUT_CONFIG[row.type] ?? { color: '#8B8FA8', bg: '#1E2235' };
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '5px 8px', color: '#8B8FA8', fontFamily: "'IBM Plex Mono', monospace" }}>
                    {row.date}
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 600,
                      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44`,
                    }}>
                      {row.type}
                    </span>
                  </td>
                  <td style={{ padding: '5px 8px', color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>
                    {row.entry.toFixed(2)}
                  </td>
                  <td style={{ padding: '5px 8px', color: row.fwdReturn >= 0 ? DN_COLOR : UP_COLOR, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700 }}>
                    {row.fwdReturn >= 0 ? '+' : ''}{row.fwdReturn.toFixed(2)}%
                  </td>
                  <td style={{ padding: '5px 8px' }}>
                    <span style={{ fontSize: 12 }}>{row.win ? '✅' : '❌'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ScoringPanel({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useSWR(`/api/kline/${symbol}`, fetcher, {
    revalidateOnFocus: false,
  });

  if (isLoading) return <Skeleton style={{ height: 500, borderRadius: 8 }} />;
  if (error || !data) return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B8FA8', fontSize: 13 }}>
      無法載入評分資料
    </div>
  );

  const score     = data.score;
  const candles   = data.candles   ?? [];
  const breakouts = data.breakouts ?? [];

  if (!score) return (
    <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B8FA8', fontSize: 13 }}>
      暫無評分資料
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* S1: Donut ring */}
      <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
        <ScoreRing score={score.overall ?? 0} reading={score.technicalReading ?? ''} />
      </div>

      {/* S2: Radar */}
      {score.dimensions && (
        <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>六維評分雷達</div>
          <ScoreRadar dimensions={score.dimensions} />
        </div>
      )}

      {/* S3: Signal matrix */}
      {score.matrix && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 8 }}>訊號矩陣</div>
          <SignalMatrixDisplay matrix={score.matrix} expanded={true} />
        </div>
      )}

      {/* S4: Breakout signals */}
      <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 10 }}>起漲突破訊號</div>
        {breakouts.length === 0 ? (
          <div style={{ fontSize: 12, color: '#8B8FA8', textAlign: 'center', padding: 8 }}>
            目前無起漲突破訊號
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {breakouts.map((b: any, i: number) => {
              const cfg = BREAKOUT_CONFIG[b.type] ?? { color: '#8B8FA8', bg: '#1E2235' };
              return (
                <div key={i} style={{
                  background: cfg.bg, border: `1px solid ${cfg.color}44`,
                  borderRadius: 6, padding: '8px 12px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 4,
                      color: cfg.color, background: `${cfg.color}22`, border: `1px solid ${cfg.color}44`,
                    }}>
                      {b.type}
                    </span>
                    <span style={{ fontSize: 11, color: cfg.color, fontWeight: 700 }}>
                      強度 {b.confidence}%
                    </span>
                  </div>
                  {b.triggerDescription && (
                    <div style={{ fontSize: 11, color: '#8B8FA8', marginBottom: 4 }}>{b.triggerDescription}</div>
                  )}
                  {b.keyLevels && (
                    <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#8B8FA8' }}>
                      {b.keyLevels.resistance && <span>壓力 <span style={{ color: UP_COLOR }}>{b.keyLevels.resistance}</span></span>}
                      {b.keyLevels.support    && <span>支撐 <span style={{ color: DN_COLOR }}>{b.keyLevels.support}</span></span>}
                      {b.keyLevels.boxUpper   && <span>箱頂 <span style={{ color: '#F5B700' }}>{b.keyLevels.boxUpper}</span></span>}
                      {b.keyLevels.boxLower   && <span>箱底 <span style={{ color: '#F5B700' }}>{b.keyLevels.boxLower}</span></span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* S5: Backtest table */}
      <div style={{ background: '#0F1117', border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 10 }}>歷史型態回測</div>
        <BacktestTable candles={candles} breakouts={breakouts} />
      </div>

    </div>
  );
}
