'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Skeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const BORDER   = '#1E2235';
const UP_COLOR = '#FF4D6D';
const DN_COLOR = '#00D4AA';

const BREAKOUT_TYPES = ['全部', '上漲趨勢突破', '箱型整理突破', '下跌V轉突破'];

const BREAKOUT_CONFIG: Record<string, { color: string; bg: string }> = {
  '上漲趨勢突破': { color: '#3D8EF8', bg: '#0D1B3B' },
  '箱型整理突破': { color: '#F5B700', bg: '#3B2D00' },
  '下跌V轉突破':  { color: UP_COLOR,  bg: '#3B0D0D' },
};

const SORT_OPTIONS = [
  { label: '評分',   value: 'confidence' },
  { label: '漲跌%',  value: 'changePercent' },
  { label: '成交量', value: 'volume' },
];

interface Props {
  mode:   'scanner' | 'afterhours';
  side?:  'bull' | 'bear';
}

export function ScannerResultsTable({ mode, side }: Props) {
  const [typeFilter,  setTypeFilter]  = useState('全部');
  const [sortBy,      setSortBy]      = useState('confidence');
  const [industryFilter, setIndustryFilter] = useState('全部');

  const { data, isLoading, error } = useSWR('/api/kline/scanner', fetcher, {
    revalidateOnFocus: false,
  });

  if (isLoading) return <Skeleton style={{ height: 400, borderRadius: 8 }} />;
  if (error) return (
    <div style={{ padding: 24, textAlign: 'center', color: '#8B8FA8', fontSize: 13 }}>
      無法載入資料
    </div>
  );

  const raw: any[] = data?.results ?? [];
  const totalScanned: number = data?.totalScanned ?? 0;

  // Filter by side for afterhours mode
  let filtered = mode === 'afterhours'
    ? raw.filter(r => side === 'bull' ? r.changePercent >= 0 : r.changePercent < 0)
    : raw;

  // Filter by breakout type
  if (typeFilter !== '全部') {
    filtered = filtered.filter(r => r.breakoutType === typeFilter);
  }

  // Filter by industry
  const industries = ['全部', ...Array.from(new Set(raw.map(r => r.sector).filter(Boolean))) as string[]];
  if (industryFilter !== '全部') {
    filtered = filtered.filter(r => r.sector === industryFilter);
  }

  // Sort
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'confidence')    return b.confidence - a.confidence;
    if (sortBy === 'changePercent') return b.changePercent - a.changePercent;
    if (sortBy === 'volume')        return (b.volume ?? 0) - (a.volume ?? 0);
    return 0;
  });

  const summaryText = mode === 'scanner'
    ? `共掃描 ${totalScanned} 檔，找到 ${filtered.length} 個起漲訊號`
    : `今日${side === 'bull' ? '多方' : '空方'}名單共 ${filtered.length} 檔`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Summary */}
      <div style={{ fontSize: 12, color: '#8B8FA8' }}>{summaryText}</div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {/* Type chips */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {BREAKOUT_TYPES.map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${typeFilter === t ? UP_COLOR : BORDER}`,
                background: typeFilter === t ? `${UP_COLOR}22` : 'transparent',
                color: typeFilter === t ? UP_COLOR : '#8B8FA8',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Industry dropdown */}
        {industries.length > 1 && (
          <select
            value={industryFilter}
            onChange={e => setIndustryFilter(e.target.value)}
            style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 4,
              background: '#0F1117', color: '#8B8FA8',
              border: `1px solid ${BORDER}`, cursor: 'pointer',
            }}
          >
            {industries.map(ind => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
        )}

        {/* Sort */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {SORT_OPTIONS.map(s => (
            <button
              key={s.value}
              onClick={() => setSortBy(s.value)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${sortBy === s.value ? DN_COLOR : BORDER}`,
                background: sortBy === s.value ? `${DN_COLOR}22` : 'transparent',
                color: sortBy === s.value ? DN_COLOR : '#8B8FA8',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#8B8FA8', fontSize: 13,
          background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}` }}>
          目前無訊號資料
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['排名', '代號', '股名', '現價', '漲跌%', '訊號類型', '強勢/量增', '評分'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#8B8FA8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const cfg = BREAKOUT_CONFIG[r.breakoutType] ?? { color: '#8B8FA8', bg: '#1E2235' };
                const changeColor = r.changePercent >= 0 ? UP_COLOR : DN_COLOR;
                const score = r.confidence ?? r.matrixScore ?? 0;
                const scoreColor = score >= 70 ? DN_COLOR : score >= 50 ? '#F5B700' : UP_COLOR;

                return (
                  <tr
                    key={r.symbol}
                    style={{ borderBottom: `1px solid ${BORDER}`, cursor: 'pointer' }}
                    onClick={() => window.location.href = `/stock/${r.symbol}`}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1E2235'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
                    <td style={{ padding: '8px 10px', color: '#8B8FA8' }}>{i + 1}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <Link href={`/stock/${r.symbol}`} style={{ color: '#3D8EF8', fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}
                        onClick={e => e.stopPropagation()}>
                        {r.symbol}
                      </Link>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#fff', whiteSpace: 'nowrap' }}>{r.name_zh}</td>
                    <td style={{ padding: '8px 10px', color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {r.price?.toFixed(2) ?? '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: changeColor, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700 }}>
                      {r.changePercent >= 0 ? '+' : ''}{r.changePercent?.toFixed(2)}%
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {r.breakoutType ? (
                        <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                          color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44` }}>
                          {r.breakoutType}
                        </span>
                      ) : (
                        <span style={{ color: '#8B8FA8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#8B8FA8', whiteSpace: 'nowrap' }}>
                      {r.matrixScore ? `${r.matrixScore}/100` : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', minWidth: 80 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ flex: 1, height: 4, background: BORDER, borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color: scoreColor, fontWeight: 700, minWidth: 24 }}>{score}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
