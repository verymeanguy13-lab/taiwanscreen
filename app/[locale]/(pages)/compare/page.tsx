'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { formatNTD } from '@/lib/utils';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_STOCKS = 4;
const LINE_COLORS = [
  'var(--accent-green)',
  'var(--accent-blue)',
  'var(--accent-gold)',
  'var(--accent-red)',
];

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────

interface StockData {
  symbol:                   string;
  name_zh:                  string;
  sector?:                  string;
  market:                   string;
  close?:                   number | null;
  change_pct?:              number | null;
  volume?:                  number | null;
  high_52w?:                number | null;
  low_52w?:                 number | null;
  pe_ratio?:                number | null;
  pb_ratio?:                number | null;
  roe?:                     number | null;
  gross_margin?:            number | null;
  net_margin?:              number | null;
  revenue_growth_yoy?:      number | null;
  eps_growth_yoy?:          number | null;
  debt_ratio?:              number | null;
  market_cap?:              number | null;
  eps?:                     number | null;
  latest_yield_pct?:        number | null;
  consecutive_years?:       number | null;
  stability_score?:         number | null;
  foreign_net?:             number | null;
  trust_net?:               number | null;
  foreign_consecutive_days?: number | null;
  priceHistory:             { date: string; close: number }[];
}

interface SearchResult {
  symbol: string;
  name_zh: string;
  close?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function getBest(
  stocks: StockData[],
  key: keyof StockData,
  lowerIsBetter = false,
): string | null {
  const vals = stocks.map(s => s[key] as number | null);
  const valid = vals.filter((v): v is number => v != null);
  if (valid.length < 2) return null;
  const best = lowerIsBetter ? Math.min(...valid) : Math.max(...valid);
  return stocks.find(s => (s[key] as number | null) === best)?.symbol ?? null;
}

// ── Stock search input ────────────────────────────────────────────────────────

function StockSearchInput({
  onSelect,
}: {
  onSelect: (symbol: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query || query.length < 1) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/screener?search=${encodeURIComponent(query)}&per_page=8`);
        const json = await res.json();
        setResults((json?.data ?? []).slice(0, 8));
        setOpen(true);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="輸入股票代號或名稱…"
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg shadow-lg overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
          }}
        >
          {results.map(r => (
            <button
              key={r.symbol}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-secondary)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
              onMouseDown={() => {
                onSelect(r.symbol);
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="font-semibold" style={{ color: 'var(--accent-blue)' }}>{r.symbol}</span>
              <span className="ml-2 flex-1" style={{ color: 'var(--text-secondary)' }}>{r.name_zh}</span>
              {r.close != null && (
                <span className="num" style={{ color: 'var(--text-primary)' }}>NT${fmt(r.close)}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Performance chart ─────────────────────────────────────────────────────────

function PerformanceChart({ stocks }: { stocks: StockData[] }) {
  // Build normalized chart data — rebase all to 100 at earliest date
  const allDates = Array.from(
    new Set(stocks.flatMap(s => s.priceHistory.map(p => p.date)))
  ).sort();

  const chartData = allDates.map(date => {
    const point: Record<string, string | number> = { date };
    stocks.forEach(stock => {
      const history = stock.priceHistory;
      if (!history.length) return;
      const base = history[0].close;
      const entry = history.find(p => p.date === date);
      if (entry && base) {
        point[stock.symbol] = parseFloat(((entry.close / base) * 100).toFixed(2));
      }
    });
    return point;
  });

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
        近一年績效比較（基準 = 100）
      </h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.4} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={d => d.slice(5)} // show MM-DD
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v}`}
            width={36}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number) => [`${value.toFixed(1)}`, '']}
          />
          <Legend
            formatter={(value) => {
              const s = stocks.find(s => s.symbol === value);
              return s ? `${s.symbol} ${s.name_zh}` : value;
            }}
          />
          {stocks.map((stock, i) => (
            <Line
              key={stock.symbol}
              type="monotone"
              dataKey={stock.symbol}
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────

function CompareTable({ stocks }: { stocks: StockData[] }) {
  type Row = {
    label:         string;
    key:           keyof StockData;
    format:        (v: number | null | undefined, s: StockData) => string;
    lowerIsBetter?: boolean;
  };

  const SECTIONS: { title: string; rows: Row[] }[] = [
    {
      title: '價格資訊',
      rows: [
        { label: '股價',   key: 'close',      format: v => v != null ? `NT$${fmt(v)}` : '—' },
        { label: '漲跌%',  key: 'change_pct', format: v => v != null ? `${v >= 0 ? '+' : ''}${fmt(v)}%` : '—' },
        { label: '52週高', key: 'high_52w',   format: v => v != null ? `NT$${fmt(v)}` : '—' },
        { label: '52週低', key: 'low_52w',    format: v => v != null ? `NT$${fmt(v)}` : '—' },
        { label: '成交量', key: 'volume',     format: v => v != null ? `${(v / 1000).toFixed(0)}萬` : '—' },
      ],
    },
    {
      title: '估值',
      rows: [
        { label: '本益比',   key: 'pe_ratio', format: v => fmt(v, 1), lowerIsBetter: true },
        { label: '股價淨值比', key: 'pb_ratio', format: v => fmt(v, 2), lowerIsBetter: true },
      ],
    },
    {
      title: '獲利能力',
      rows: [
        { label: 'ROE',  key: 'roe',          format: v => v != null ? `${fmt(v, 1)}%` : '—' },
        { label: '毛利率', key: 'gross_margin', format: v => v != null ? `${fmt(v, 1)}%` : '—' },
        { label: '淨利率', key: 'net_margin',   format: v => v != null ? `${fmt(v, 1)}%` : '—' },
        { label: 'EPS',  key: 'eps',           format: v => v != null ? `NT$${fmt(v)}` : '—' },
      ],
    },
    {
      title: '成長性',
      rows: [
        { label: '營收年增率', key: 'revenue_growth_yoy', format: v => v != null ? `${fmt(v, 1)}%` : '—' },
        { label: 'EPS年增率', key: 'eps_growth_yoy',     format: v => v != null ? `${fmt(v, 1)}%` : '—' },
      ],
    },
    {
      title: '安全性',
      rows: [
        { label: '負債比', key: 'debt_ratio', format: v => v != null ? `${fmt(v, 1)}%` : '—', lowerIsBetter: true },
        { label: '市值',   key: 'market_cap', format: (v, s) => s.market_cap ? formatNTD(s.market_cap) : '—' },
      ],
    },
    {
      title: '配息',
      rows: [
        { label: '殖利率',     key: 'latest_yield_pct',  format: v => v != null ? `${fmt(v)}%` : '—' },
        { label: '連續配息年', key: 'consecutive_years',  format: v => v != null ? `${v}年` : '—' },
        { label: '配息穩定分數', key: 'stability_score', format: v => fmt(v, 0) },
      ],
    },
    {
      title: '籌碼',
      rows: [
        { label: '外資買超(張)',  key: 'foreign_net',              format: v => v != null ? v.toLocaleString() : '—' },
        { label: '外資連買天數', key: 'foreign_consecutive_days',  format: v => v != null ? `${v}天` : '—' },
      ],
    },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ minWidth: 480 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th className="pb-3 text-left font-semibold w-28"
              style={{ color: 'var(--text-muted)' }}>指標</th>
            {stocks.map((s, i) => (
              <th key={s.symbol} className="pb-3 text-right font-semibold"
                style={{ color: LINE_COLORS[i % LINE_COLORS.length] }}>
                {s.symbol}<br />
                <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>
                  {s.name_zh}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SECTIONS.map(section => (
            <>
              {/* Section header */}
              <tr key={`section-${section.title}`}>
                <td
                  colSpan={stocks.length + 1}
                  className="pt-4 pb-1 text-xs font-semibold"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {section.title}
                </td>
              </tr>
              {section.rows.map(row => {
                const bestSymbol = getBest(stocks, row.key, row.lowerIsBetter);
                return (
                  <tr key={row.key as string} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>
                      {row.label}
                    </td>
                    {stocks.map(stock => {
                      const val = stock[row.key] as number | null | undefined;
                      const isBest = bestSymbol === stock.symbol;
                      return (
                        <td
                          key={stock.symbol}
                          className="num py-2 text-right font-medium"
                          style={{
                            color: isBest ? 'var(--accent-green)' : 'var(--text-primary)',
                            fontWeight: isBest ? 700 : 400,
                          }}
                        >
                          {row.format(val, stock)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ComparePage() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [symbols, setSymbols] = useState<string[]>(() => {
    const raw = searchParams.get('symbols') ?? '';
    return raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, MAX_STOCKS);
  });

  // Update URL when symbols change
  useEffect(() => {
    const url = symbols.length > 0
      ? `/compare?symbols=${symbols.join(',')}`
      : '/compare';
    router.replace(url, { scroll: false });
  }, [symbols, router]);

  // Fetch comparison data
  const { data: stocks = [], isLoading } = useSWR<StockData[]>(
    symbols.length > 0 ? `/api/compare?symbols=${symbols.join(',')}` : null,
    fetcher,
  );

  const addSymbol = useCallback((symbol: string) => {
    setSymbols(prev => {
      if (prev.includes(symbol) || prev.length >= MAX_STOCKS) return prev;
      return [...prev, symbol];
    });
  }, []);

  const removeSymbol = useCallback((symbol: string) => {
    setSymbols(prev => prev.filter(s => s !== symbol));
  }, []);

  const emptySlots = MAX_STOCKS - symbols.length;

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              個股比較
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              最多同時比較 4 支股票
            </p>
          </div>
          <Link
            href="/screener"
            className="text-xs"
            style={{ color: 'var(--accent-blue)' }}
          >
            ← 回到選股器
          </Link>
        </div>

        {/* ── Stock selector ── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Selected stocks */}
          {symbols.map((symbol, i) => {
            const stock = stocks.find(s => s.symbol === symbol);
            return (
              <div
                key={symbol}
                className="flex flex-col gap-2 rounded-lg p-3"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  border: `1px solid ${LINE_COLORS[i % LINE_COLORS.length]}`,
                }}
              >
                {/* Stock card */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="num text-sm font-bold"
                      style={{ color: LINE_COLORS[i % LINE_COLORS.length] }}>
                      {symbol}
                    </p>
                    {stock && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {stock.name_zh}
                      </p>
                    )}
                    {stock?.close != null && (
                      <p className="num text-sm font-semibold mt-1"
                        style={{ color: 'var(--text-primary)' }}>
                        NT${fmt(stock.close)}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeSymbol(symbol)}
                    className="text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0"
                    style={{
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}

          {/* Empty slots */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="flex flex-col gap-2 rounded-lg p-3"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px dashed var(--border)',
              }}
            >
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                新增股票
              </p>
              <StockSearchInput onSelect={addSymbol} />
            </div>
          ))}
        </div>

        {/* ── Loading ── */}
        {isLoading && (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            載入中…
          </div>
        )}

        {/* ── Comparison table ── */}
        {!isLoading && stocks.length >= 2 && (
          <div
            className="rounded-lg p-4"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <CompareTable stocks={stocks} />
          </div>
        )}

        {/* ── Performance chart ── */}
        {!isLoading && stocks.length >= 2 && (
          <div
            className="rounded-lg p-4"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <PerformanceChart stocks={stocks} />
          </div>
        )}

        {/* ── Empty state ── */}
        {!isLoading && stocks.length < 2 && symbols.length < 2 && (
          <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
            <p className="text-4xl mb-3">📊</p>
            <p className="text-sm">請選擇至少 2 支股票以開始比較</p>
          </div>
        )}

      </div>
    </div>
  );
}
