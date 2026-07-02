'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ETFRow {
  symbol:             string;
  name_zh:            string;
  full_name:          string | null;
  etf_type:           string | null;
  expense_ratio:      number | null;
  aum:                number | null;
  dividend_freq:      string | null;
  inception_date:     string | null;
  description_zh:     string | null;
  close:              number | null;
  change_pct:         number | null;
  latest_yield_pct:   number | null;
  consecutive_years:  number | null;
  dividend_frequency: string | null;
  next_ex_date:       string | null;
  last_cash_dividend: number | null;
}

type SortKey = 'aum' | 'latest_yield_pct' | 'expense_ratio' | 'close' | 'change_pct';
type SortDir = 'asc' | 'desc';

// ── Constants ─────────────────────────────────────────────────────────────────
const BG       = '#08090E';
const CARD     = '#0F1117';
const BORDER   = '#1E2235';
const MUTED    = '#8B8FA8';
const TEXT     = '#E8EAF0';
const TEXT2    = '#B0B4C8';
const GREEN    = '#00D4AA';
const RED      = '#FF4D6D';
const GOLD     = '#F5B700';
const BLUE     = '#3D8EF8';

const TYPE_FILTERS = [
  { key: 'all',      label: '全部' },
  { key: 'index',    label: '指數型' },
  { key: 'dividend', label: '高息型' },
  { key: 'esg',      label: 'ESG' },
  { key: 'tech',     label: '科技型' },
  { key: 'bond',     label: '債券型' },
];

const FREQ_FILTERS = [
  { key: 'all',        label: '全部頻率' },
  { key: 'monthly',    label: '月配' },
  { key: 'quarterly',  label: '季配' },
  { key: 'annual',     label: '年配' },
];

const SORT_OPTIONS: { key: SortKey; label: string; dir: SortDir }[] = [
  { key: 'aum',             label: '規模↓',   dir: 'desc' },
  { key: 'latest_yield_pct',label: '殖利率↓', dir: 'desc' },
  { key: 'expense_ratio',   label: '費用率↑', dir: 'asc'  },
  { key: 'change_pct',      label: '漲跌幅↓', dir: 'desc' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAum(v: number | null): string {
  if (!v) return '—';
  const b = v / 100_000_000;
  return b >= 1000 ? `${(b / 1000).toFixed(1)}兆` : `${b.toFixed(0)}億`;
}

function fmtFreq(freq: string | null): string {
  if (!freq) return '—';
  if (freq === 'monthly')     return '月配';
  if (freq === 'quarterly')   return '季配';
  if (freq === 'semi-annual') return '半年配';
  return '年配';
}

function etfTypeLabel(type: string | null): string {
  if (!type) return '其他';
  if (type.includes('esg'))  return 'ESG';
  if (type === 'dividend')   return '高息';
  if (type === 'index')      return '指數';
  if (type === 'tech')       return '科技';
  if (type === 'bond')       return '債券';
  return type;
}

function etfTypeColor(type: string | null): string {
  if (!type) return MUTED;
  if (type.includes('esg')) return GREEN;
  if (type === 'dividend')  return GOLD;
  if (type === 'index')     return BLUE;
  if (type === 'tech')      return '#A78BFA';
  if (type === 'bond')      return '#FB923C';
  return MUTED;
}

function matchesType(etf: ETFRow, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'esg') return !!(etf.etf_type?.includes('esg'));
  return etf.etf_type === filter;
}

function matchesFreq(etf: ETFRow, filter: string): boolean {
  if (filter === 'all') return true;
  return (etf.dividend_freq ?? etf.dividend_frequency) === filter;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ETFClient() {
  const [etfs, setEtfs]         = useState<ETFRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [typeFilter, setType]   = useState('all');
  const [freqFilter, setFreq]   = useState('all');
  const [sortKey, setSortKey]   = useState<SortKey>('aum');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');
  const [search, setSearch]     = useState('');
  const [pinned, setPinned]     = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    fetch('/api/etf')
      .then(r => r.json())
      .then(d => { setEtfs(d?.data?.etfs ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const togglePin = useCallback((symbol: string) => {
    setPinned(prev =>
      prev.includes(symbol) ? prev.filter(s => s !== symbol)
        : prev.length < 4 ? [...prev, symbol] : prev
    );
  }, []);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else {
      setSortKey(key);
      setSortDir(SORT_OPTIONS.find(o => o.key === key)?.dir ?? 'desc');
    }
  };

  const filtered = useMemo(() => {
    let list = etfs.filter(e =>
      matchesType(e, typeFilter) &&
      matchesFreq(e, freqFilter) &&
      (search === '' ||
        e.symbol.includes(search.toUpperCase()) ||
        e.name_zh.includes(search))
    );
    list = [...list].sort((a, b) => {
      const av = a[sortKey] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const bv = b[sortKey] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return sortDir === 'desc' ? Number(bv) - Number(av) : Number(av) - Number(bv);
    });
    return list;
  }, [etfs, typeFilter, freqFilter, search, sortKey, sortDir]);

  const pinnedEtfs = etfs.filter(e => pinned.includes(e.symbol));

  // ── Compare view ────────────────────────────────────────────────────────────
  if (comparing && pinnedEtfs.length >= 2) {
    const ROWS: { label: string; render: (e: ETFRow) => { display: string; num: number | null } }[] = [
      { label: '股價',     render: e => ({ display: e.close != null ? `NT$${Number(e.close).toFixed(2)}` : '—', num: e.close }) },
      { label: '殖利率',   render: e => ({ display: e.latest_yield_pct != null ? `${Number(e.latest_yield_pct).toFixed(2)}%` : '—', num: e.latest_yield_pct }) },
      { label: '費用率',   render: e => ({ display: e.expense_ratio != null ? `${(Number(e.expense_ratio) * 100).toFixed(2)}%` : '—', num: e.expense_ratio }) },
      { label: '規模',     render: e => ({ display: fmtAum(e.aum), num: e.aum }) },
      { label: '配息頻率', render: e => ({ display: fmtFreq(e.dividend_freq), num: null }) },
      { label: '類型',     render: e => ({ display: etfTypeLabel(e.etf_type), num: null }) },
      { label: '成立日期', render: e => ({ display: e.inception_date ? String(e.inception_date).slice(0, 10) : '—', num: null }) },
    ];
    const HIGHER = new Set(['latest_yield_pct', 'aum', 'close']);
    const LOWER  = new Set(['expense_ratio']);

    return (
      <div style={{ minHeight: '100vh', background: BG, padding: '24px 16px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <h1 style={{ color: TEXT, fontSize: 18, fontWeight: 700 }}>ETF 比較</h1>
            <button onClick={() => setComparing(false)}
              style={{ fontSize: 12, padding: '6px 14px', borderRadius: 6, border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED, cursor: 'pointer' }}>
              ← 返回列表
            </button>
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 10, border: `1px solid ${BORDER}` }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#0C0E18', borderBottom: `1px solid ${BORDER}` }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', color: MUTED, fontWeight: 600, width: 100 }}>項目</th>
                  {pinnedEtfs.map(e => (
                    <th key={e.symbol} style={{ padding: '12px 16px', textAlign: 'center', color: GREEN, fontWeight: 700 }}>
                      <div>{e.symbol}</div>
                      <div style={{ fontSize: 11, color: TEXT2, fontWeight: 400 }}>{e.name_zh}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(({ label, render }) => {
                  const cells = pinnedEtfs.map(e => render(e));
                  const nums = cells.map(c => c.num);
                  const validNums = nums.filter(n => n !== null) as number[];
                  const rowKey = label === '殖利率' ? 'latest_yield_pct' : label === '費用率' ? 'expense_ratio' : label === '規模' ? 'aum' : '';
                  const bestNum = validNums.length
                    ? HIGHER.has(rowKey) ? Math.max(...validNums)
                      : LOWER.has(rowKey) ? Math.min(...validNums) : null
                    : null;
                  return (
                    <tr key={label} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '10px 16px', color: MUTED, background: '#0C0E18', fontWeight: 600, fontSize: 12 }}>{label}</td>
                      {cells.map((cell, i) => {
                        const isBest = bestNum !== null && cell.num === bestNum;
                        return (
                          <td key={i} style={{
                            padding: '10px 16px', textAlign: 'center',
                            color: isBest ? GREEN : TEXT,
                            background: isBest ? 'rgba(0,212,170,0.07)' : i % 2 === 0 ? CARD : '#0C0E18',
                            fontWeight: isBest ? 700 : 400,
                            fontFamily: "'IBM Plex Mono', monospace",
                          }}>
                            {cell.display}
                            {isBest && <span style={{ marginLeft: 4, fontSize: 10, color: GREEN }}>★</span>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Main list view ──────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: BG, paddingBottom: 80 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: TEXT, margin: 0 }}>台灣 ETF 篩選器</h1>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
            {loading ? '載入中...' : `共 ${etfs.length} 檔 ETF · 顯示 ${filtered.length} 檔`}
          </p>
        </div>

        {/* Search + Sort bar */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜尋代號或名稱..."
            style={{
              flex: 1, minWidth: 160, padding: '7px 12px', fontSize: 13,
              background: CARD, border: `1px solid ${BORDER}`, borderRadius: 7,
              color: TEXT, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SORT_OPTIONS.map(opt => (
              <button key={opt.key} onClick={() => handleSort(opt.key)}
                style={{
                  padding: '7px 12px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
                  border: `1px solid ${sortKey === opt.key ? GREEN : BORDER}`,
                  background: sortKey === opt.key ? 'rgba(0,212,170,0.1)' : 'transparent',
                  color: sortKey === opt.key ? GREEN : MUTED,
                  fontWeight: sortKey === opt.key ? 700 : 400,
                }}>
                {opt.label}{sortKey === opt.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Type filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map(f => (
            <button key={f.key} onClick={() => setType(f.key)}
              style={{
                padding: '5px 14px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${typeFilter === f.key ? BLUE : BORDER}`,
                background: typeFilter === f.key ? 'rgba(61,142,248,0.12)' : 'transparent',
                color: typeFilter === f.key ? BLUE : MUTED,
                fontWeight: typeFilter === f.key ? 700 : 400,
              }}>
              {f.label}
            </button>
          ))}
          <div style={{ width: 1, background: BORDER, margin: '0 4px' }} />
          {FREQ_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFreq(f.key)}
              style={{
                padding: '5px 14px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
                border: `1px solid ${freqFilter === f.key ? GOLD : BORDER}`,
                background: freqFilter === f.key ? 'rgba(245,183,0,0.1)' : 'transparent',
                color: freqFilter === f.key ? GOLD : MUTED,
                fontWeight: freqFilter === f.key ? 700 : 400,
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Compare banner */}
        {pinned.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderRadius: 8, marginBottom: 14,
            background: 'rgba(0,212,170,0.06)', border: `1px solid rgba(0,212,170,0.25)`,
          }}>
            <span style={{ fontSize: 13, color: GREEN }}>
              已選 {pinned.length}/4：{pinned.join('、')}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPinned([])}
                style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${BORDER}`, background: 'transparent', color: MUTED }}>
                清除
              </button>
              <button onClick={() => setComparing(true)} disabled={pinned.length < 2}
                style={{
                  fontSize: 12, padding: '4px 12px', borderRadius: 6, cursor: pinned.length < 2 ? 'not-allowed' : 'pointer',
                  background: pinned.length >= 2 ? GREEN : BORDER, color: pinned.length >= 2 ? BG : MUTED,
                  border: 'none', fontWeight: 700, opacity: pinned.length < 2 ? 0.5 : 1,
                }}>
                開始比較 →
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: MUTED, fontSize: 13 }}>載入中...</div>
        ) : (
          <div style={{ borderRadius: 10, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '200px 64px 90px 80px 70px 72px 60px 72px',
              background: '#0C0E18', borderBottom: `1px solid ${BORDER}`,
              padding: '10px 16px', gap: 8,
            }}>
              {[
                { label: 'ETF', sortable: false },
                { label: '類型', sortable: false },
                { label: '殖利率', key: 'latest_yield_pct' },
                { label: '費用率', key: 'expense_ratio' },
                { label: '配息', sortable: false },
                { label: '規模', key: 'aum' },
                { label: '股價', key: 'close' },
                { label: '漲跌', key: 'change_pct' },
              ].map((col, i) => (
                <div key={i}
                  onClick={() => col.key && handleSort(col.key as SortKey)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: col.key && sortKey === col.key ? GREEN : MUTED,
                    cursor: col.key ? 'pointer' : 'default',
                    textAlign: i >= 2 ? 'right' : 'left',
                    userSelect: 'none',
                  }}>
                  {col.label}
                  {col.key && sortKey === col.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </div>
              ))}
            </div>

            {/* Rows */}
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: MUTED, fontSize: 13 }}>
                沒有符合條件的 ETF
              </div>
            ) : (
              filtered.map((etf, idx) => {
                const isPinned = pinned.includes(etf.symbol);
                const disabled = pinned.length >= 4 && !isPinned;
                const typeColor = etfTypeColor(etf.etf_type);
                const chg = etf.change_pct;
                const chgColor = chg == null ? MUTED : chg >= 0 ? RED : GREEN;

                return (
                  <div key={etf.symbol}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '200px 64px 90px 80px 70px 72px 60px 72px',
                      padding: '11px 16px', gap: 8, alignItems: 'center',
                      background: isPinned ? 'rgba(0,212,170,0.05)' : idx % 2 === 0 ? CARD : '#0B0D13',
                      borderBottom: `1px solid ${BORDER}`,
                      borderLeft: isPinned ? `3px solid ${GREEN}` : '3px solid transparent',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.45 : 1,
                      transition: 'background 0.1s',
                    }}
                    onClick={() => !disabled && togglePin(etf.symbol)}
                  >
                    {/* ETF name col */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, border: `1.5px solid ${isPinned ? GREEN : BORDER}`,
                        background: isPinned ? GREEN : 'transparent', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isPinned && <span style={{ fontSize: 9, color: BG, fontWeight: 900 }}>✓</span>}
                      </div>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, fontFamily: "'IBM Plex Mono', monospace" }}>
                          {etf.symbol}
                        </div>
                        <div style={{ fontSize: 11, color: TEXT2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {etf.name_zh}
                        </div>
                      </div>
                    </div>

                    {/* Type badge */}
                    <div>
                      <span style={{
                        fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                        color: typeColor, background: `${typeColor}18`, border: `1px solid ${typeColor}44`,
                        whiteSpace: 'nowrap',
                      }}>
                        {etfTypeLabel(etf.etf_type)}
                      </span>
                    </div>

                    {/* Yield */}
                    <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: etf.latest_yield_pct ? GOLD : MUTED }}>
                        {etf.latest_yield_pct != null ? `${Number(etf.latest_yield_pct).toFixed(2)}%` : '—'}
                      </span>
                    </div>

                    {/* Expense ratio */}
                    <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ fontSize: 12, color: TEXT2 }}>
                        {etf.expense_ratio != null ? `${(Number(etf.expense_ratio) * 100).toFixed(2)}%` : '—'}
                      </span>
                    </div>

                    {/* Freq */}
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 11, color: MUTED }}>
                        {fmtFreq(etf.dividend_freq ?? etf.dividend_frequency)}
                      </span>
                    </div>

                    {/* AUM */}
                    <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ fontSize: 12, color: TEXT2 }}>{fmtAum(etf.aum)}</span>
                    </div>

                    {/* Price */}
                    <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ fontSize: 12, color: TEXT }}>
                        {etf.close != null ? `${Number(etf.close).toFixed(0)}` : '—'}
                      </span>
                    </div>

                    {/* Change */}
                    <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ fontSize: 12, color: chgColor }}>
                        {chg != null ? `${chg >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%` : '—'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Footer note */}
        <p style={{ fontSize: 11, color: MUTED, marginTop: 16, textAlign: 'center' }}>
          資料來源：台灣證券交易所 · 殖利率為近12個月年化計算 · 點擊列可加入比較（最多4檔）
        </p>
      </div>
    </div>
  );
}
