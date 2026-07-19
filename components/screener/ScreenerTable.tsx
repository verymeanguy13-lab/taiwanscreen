'use client';

import { useRouter } from 'next/navigation';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatChange } from '@/lib/utils';
import type { ScreenerRow } from '@/types';

interface ScreenerTableProps {
  data: ScreenerRow[];
  sortBy: string;
  sortDir: string;
  onSort: (col: string) => void;
}

const COLUMNS: { label: string; key: string; align: 'left' | 'right' }[] = [
  { label: '代號',     key: 'symbol',                align: 'left'  },
  { label: '股名',     key: 'name_zh',               align: 'left'  },
  { label: '收盤',     key: 'close',                 align: 'right' },
  { label: '漲跌%',   key: 'change_pct',             align: 'right' },
  { label: '成交量',  key: 'volume',                 align: 'right' },
  { label: '本益比',  key: 'pe_ratio',               align: 'right' },
  { label: '殖利率',  key: 'latest_yield_pct',       align: 'right' },
  { label: 'ROE',     key: 'roe',                    align: 'right' },
  { label: '外資(張)', key: 'foreign_net',            align: 'right' },
  { label: '投信(張)', key: 'trust_net',              align: 'right' },
  { label: '三買',    key: 'triple_buy',             align: 'right' },
];

function fmt(val: number | undefined | null, decimals = 2): string {
  if (val == null) return '—';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(val: number | undefined | null): string {
  if (val == null) return '—';
  return Math.round(val).toLocaleString('en-US');
}

export function ScreenerTable({ data, sortBy, sortDir, onSort }: ScreenerTableProps) {
  const router = useRouter();

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg py-20 text-sm"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        找不到符合條件的股票
      </div>
    );
  }

  return (
    <div
      className="w-full overflow-x-auto rounded-lg"
      style={{ border: '1px solid var(--border)' }}
    >
      <table className="w-full border-collapse text-sm" style={{ minWidth: '860px' }}>
        {/* ── Header ── */}
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-secondary)' }}>
            {COLUMNS.map(col => {
              const isActive = sortBy === col.key;
              const canSort  = col.key !== 'triple_buy' && col.key !== 'name_zh';
              return (
                <th
                  key={col.key}
                  onClick={canSort ? () => onSort(col.key) : undefined}
                  className={`px-3 py-2.5 text-xs font-semibold select-none ${canSort ? 'cursor-pointer' : ''}`}
                  style={{
                    color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)',
                    textAlign: col.align,
                    borderBottom: '1px solid var(--border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {canSort && isActive && (
                      sortDir === 'asc'
                        ? <ChevronUp size={12} />
                        : <ChevronDown size={12} />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>

        {/* ── Body ── */}
        <tbody>
          {data.map((row, idx) => {
            const change  = formatChange(row.change_pct ?? 0);
            const isGold  = row.triple_buy === true;

            return (
              <tr
                key={row.symbol}
                onClick={() => router.push(`/stock/${row.symbol}`)}
                className="cursor-pointer transition-colors duration-100"
                style={{
                  backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                  borderLeft: isGold ? '3px solid var(--accent-gold)' : '3px solid transparent',
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)';
                }}
              >
                {/* 代號 */}
                <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
                  {row.symbol}
                </td>
                {/* 股名 */}
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {row.name_zh}
                </td>
                {/* 收盤 */}
                <td className="num px-3 py-2 text-right" style={{ color: 'var(--text-primary)' }}>
                  {fmt(row.close)}
                </td>
                {/* 漲跌% */}
                <td className="num px-3 py-2 text-right font-semibold" style={{ color: change.color }}>
                  {change.value}
                </td>
                {/* 成交量 */}
                <td className="num px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                  {fmtInt(row.volume)}
                </td>
                {/* 本益比 */}
                <td className="num px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                  {fmt(row.pe_ratio, 1)}
                </td>
                {/* 殖利率 */}
                <td className="num px-3 py-2 text-right" style={{ color: 'var(--accent-gold)' }}>
                  {row.latest_yield_pct != null ? `${fmt(row.latest_yield_pct, 2)}%` : '—'}
                </td>
                {/* ROE */}
                <td className="num px-3 py-2 text-right" style={{ color: 'var(--text-secondary)' }}>
                  {row.roe != null ? `${fmt(row.roe, 1)}%` : '—'}
                </td>
                {/* 外資 */}
                <td
                  className="num px-3 py-2 text-right"
                  style={{
                    color: (row.foreign_net ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}
                >
                  {row.foreign_net != null
                    ? `${(row.foreign_net ?? 0) >= 0 ? '+' : ''}${fmtInt(row.foreign_net / 1000)}`
                    : '—'}
                </td>
                {/* 投信 */}
                <td
                  className="num px-3 py-2 text-right"
                  style={{
                    color: (row.trust_net ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)',
                  }}
                >
                  {row.trust_net != null
                    ? `${(row.trust_net ?? 0) >= 0 ? '+' : ''}${fmtInt(row.trust_net / 1000)}`
                    : '—'}
                </td>
                {/* 三買 */}
                <td className="px-3 py-2 text-right">
                  {isGold ? (
                    <span style={{ color: 'var(--accent-gold)' }}>★</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
