'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Badge }    from '@/components/ui/Badge';
import { Card }     from '@/components/ui/Card';
import { Button }   from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface ETFRow {
  symbol:           string;
  name_zh:          string;
  full_name:        string | null;
  etf_type:         string | null;
  expense_ratio:    number | null;
  aum:              number | null;
  dividend_freq:    string | null;
  inception_date:   string | null;
  description_zh:   string | null;
  close:            number | null;
  change_pct:       number | null;
  latest_yield_pct: number | null;
  dividend_frequency: string | null;
  next_ex_date:     string | null;
  last_cash_dividend: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAum(v: number | null): string {
  if (!v) return '—';
  return `NT$${(v / 100_000_000).toFixed(0)}億`;
}

function fmtFreq(freq: string | null): string {
  if (!freq) return '—';
  if (freq === 'monthly')   return '月配';
  if (freq === 'quarterly') return '季配';
  if (freq === 'semi-annual') return '半年配';
  return '年配';
}

function etfTypeLabel(type: string | null): string {
  if (!type) return '其他';
  if (type.includes('esg')) return 'ESG高息';
  if (type === 'dividend')  return '高息型';
  if (type === 'index')     return '指數型';
  return type;
}

function etfTypeBadge(type: string | null): 'green' | 'gold' | 'blue' | 'grey' {
  if (!type) return 'grey';
  if (type.includes('esg')) return 'green';
  if (type === 'dividend')  return 'gold';
  if (type === 'index')     return 'blue';
  return 'grey';
}

// ── Investor profiles ─────────────────────────────────────────────────────────
const PROFILES = [
  {
    key:     'newbie',
    label:   '新手求穩',
    symbols: ['0050'],
    reason:  '0050 追蹤台灣50大企業，分散風險、長期績效穩健，是入門首選。費用率極低，適合定期定額。',
  },
  {
    key:     'dividend',
    label:   '存股領息',
    symbols: ['00878', '00929'],
    reason:  '00878 為ESG高息ETF，季配息穩定；00929 科技股為主，月月配息現金流穩定。兩者搭配可平衡成長與收益。',
  },
  {
    key:     'growth',
    label:   '積極成長',
    symbols: ['0050', '006208'],
    reason:  '0050 與 006208 同樣追蹤台灣50，006208 費用率更低（0.23%），兩者皆適合長期持有等待資本增值。',
  },
  {
    key:     'monthly',
    label:   '月月領息',
    symbols: ['00929', '00919'],
    reason:  '00929 與 00919 均為月配息ETF，可每月提供穩定現金流，適合退休族或需要定期現金收入的投資人。',
  },
];

// ── ETF card ──────────────────────────────────────────────────────────────────
function ETFCard({
  etf,
  selected,
  onToggle,
  disabled,
}: {
  etf: ETFRow;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl p-4 transition-all duration-150"
      style={{
        backgroundColor: selected ? 'rgba(0,212,170,0.06)' : 'var(--bg-card)',
        border: selected ? '2px solid var(--accent-green)' : '1px solid var(--border)',
        cursor: 'default',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="num text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {etf.symbol}
            </span>
            <Badge variant={etfTypeBadge(etf.etf_type)}>{etfTypeLabel(etf.etf_type)}</Badge>
          </div>
          <div className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {etf.name_zh}
          </div>
        </div>
        {/* 加入比較 checkbox */}
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs"
          style={{ color: selected ? 'var(--accent-green)' : 'var(--text-muted)' }}>
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled && !selected}
            onChange={onToggle}
            style={{ accentColor: 'var(--accent-green)', cursor: disabled && !selected ? 'not-allowed' : 'pointer' }}
          />
          比較
        </label>
      </div>

      {/* Yield — hero number */}
      <div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>年化殖利率</div>
        <div className="num text-2xl font-bold"
          style={{ color: etf.latest_yield_pct ? 'var(--accent-green)' : 'var(--text-muted)' }}>
          {etf.latest_yield_pct != null ? `${Number(etf.latest_yield_pct).toFixed(2)}%` : '—'}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-xs">
        <div>
          <span style={{ color: 'var(--text-muted)' }}>費用率 </span>
          <span className="num font-medium" style={{ color: 'var(--text-secondary)' }}>
            {etf.expense_ratio != null ? `${(Number(etf.expense_ratio) * 100).toFixed(2)}%` : '—'}
          </span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>配息頻率 </span>
          <span style={{ color: 'var(--text-secondary)' }}>{fmtFreq(etf.dividend_freq)}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>規模 </span>
          <span className="num font-medium" style={{ color: 'var(--text-secondary)' }}>
            {fmtAum(etf.aum)}
          </span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>股價 </span>
          <span className="num font-medium" style={{ color: 'var(--text-primary)' }}>
            {etf.close != null ? `NT$${Number(etf.close).toFixed(2)}` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Comparison table ──────────────────────────────────────────────────────────
const COMPARE_ROWS: { label: string; key: keyof ETFRow; fmt: (v: unknown) => string }[] = [
  { label: '全名',   key: 'full_name',      fmt: v => String(v ?? '—') },
  { label: '類型',   key: 'etf_type',       fmt: v => etfTypeLabel(v as string) },
  { label: '總費用率', key: 'expense_ratio', fmt: v => v != null ? `${(Number(v) * 100).toFixed(2)}%` : '—' },
  { label: '殖利率', key: 'latest_yield_pct', fmt: v => v != null ? `${Number(v).toFixed(2)}%` : '—' },
  { label: '配息頻率', key: 'dividend_freq', fmt: v => fmtFreq(v as string) },
  { label: '規模(億)', key: 'aum',          fmt: v => v != null ? `${(Number(v) / 100_000_000).toFixed(0)}` : '—' },
  { label: '成立日期', key: 'inception_date', fmt: v => v ? String(v).slice(0, 10) : '—' },
  { label: '股價',   key: 'close',          fmt: v => v != null ? `NT$${Number(v).toFixed(2)}` : '—' },
];

// Rows where "higher is better" for green highlighting
const HIGHER_IS_BETTER = new Set(['latest_yield_pct', 'aum', 'close']);
// Rows where "lower is better"
const LOWER_IS_BETTER  = new Set(['expense_ratio']);

function ComparisonTable({ etfs, onReset }: { etfs: ETFRow[]; onReset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
          ETF 比較表
        </h2>
        <Button variant="outline" size="sm" onClick={onReset}>
          重新選擇
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full text-xs" style={{ minWidth: `${etfs.length * 130 + 100}px` }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
              <th className="px-4 py-3 text-left font-semibold w-24"
                style={{ color: 'var(--text-muted)' }}>項目</th>
              {etfs.map(e => (
                <th key={e.symbol} className="px-4 py-3 text-center font-bold"
                  style={{ color: 'var(--accent-green)' }}>
                  {e.symbol}<br />
                  <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>
                    {e.name_zh}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map(({ label, key, fmt }) => {
              const values = etfs.map(e => e[key]);
              const nums   = values.map(v => (v != null && !isNaN(Number(v))) ? Number(v) : null);
              const validNums = nums.filter(n => n !== null) as number[];

              const bestVal = validNums.length
                ? (HIGHER_IS_BETTER.has(key) ? Math.max(...validNums)
                  : LOWER_IS_BETTER.has(key)  ? Math.min(...validNums)
                  : null)
                : null;

              return (
                <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-4 py-2.5 font-semibold"
                    style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)' }}>
                    {label}
                  </td>
                  {etfs.map((e, idx) => {
                    const val    = e[key];
                    const num    = nums[idx];
                    const isBest = bestVal !== null && num === bestVal;
                    return (
                      <td key={e.symbol} className="num px-4 py-2.5 text-center"
                        style={{
                          color: isBest ? 'var(--accent-green)' : 'var(--text-primary)',
                          backgroundColor: isBest
                            ? 'rgba(0,212,170,0.08)'
                            : idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                          fontWeight: isBest ? 600 : 400,
                        }}>
                        {fmt(val)}
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
  );
}

// ── Recommendation widget ─────────────────────────────────────────────────────
function RecommendWidget({ allEtfs }: { allEtfs: ETFRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const profile = PROFILES.find(p => p.key === selected);
  const recommended = allEtfs.filter(e => profile?.symbols.includes(e.symbol));

  return (
    <Card>
      <h3 className="mb-4 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
        🤔 我是哪種投資人？
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PROFILES.map(p => (
          <button
            key={p.key}
            onClick={() => setSelected(selected === p.key ? null : p.key)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-100"
            style={{
              backgroundColor: selected === p.key ? 'var(--accent-green)' : 'var(--bg-secondary)',
              color: selected === p.key ? 'var(--bg-primary)' : 'var(--text-secondary)',
              border: `1px solid ${selected === p.key ? 'var(--accent-green)' : 'var(--border)'}`,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {profile && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-lg px-4 py-3 text-xs"
            style={{ backgroundColor: 'rgba(61,142,248,0.08)', border: '1px solid rgba(61,142,248,0.2)', color: 'var(--text-secondary)' }}>
            {profile.reason}
          </div>
          <div className="flex flex-wrap gap-3">
            {recommended.map(e => (
              <div key={e.symbol} className="flex flex-col rounded-lg px-4 py-3 gap-1"
                style={{ backgroundColor: 'rgba(0,212,170,0.06)', border: '1px solid rgba(0,212,170,0.2)' }}>
                <span className="num font-bold" style={{ color: 'var(--accent-green)' }}>{e.symbol}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{e.name_zh}</span>
                {e.latest_yield_pct != null && (
                  <span className="num text-xs font-semibold" style={{ color: 'var(--accent-gold)' }}>
                    殖利率 {Number(e.latest_yield_pct).toFixed(2)}%
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ETFPage() {
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  const { data: res, isLoading } = useSWR('/api/etf', fetcher);
  const allEtfs: ETFRow[] = res?.data?.etfs ?? [];

  const toggleSelect = (symbol: string) => {
    setSelectedSymbols(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : prev.length < 4 ? [...prev, symbol] : prev,
    );
  };

  const selectedEtfs = allEtfs.filter(e => selectedSymbols.includes(e.symbol));

  const handleCompare = () => setComparing(true);
  const handleReset   = () => { setComparing(false); setSelectedSymbols([]); };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            ETF 比較
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            勾選最多4支ETF進行比較，或使用投資人類型推薦功能
          </p>
        </div>

        {/* ── Comparison table (view 2) ───────────────────────────────────── */}
        {comparing && selectedEtfs.length > 0 && (
          <ComparisonTable etfs={selectedEtfs} onReset={handleReset} />
        )}

        {/* ── ETF browser grid (view 1) ───────────────────────────────────── */}
        {!comparing && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {allEtfs.map(etf => (
              <ETFCard
                key={etf.symbol}
                etf={etf}
                selected={selectedSymbols.includes(etf.symbol)}
                onToggle={() => toggleSelect(etf.symbol)}
                disabled={selectedSymbols.length >= 4}
              />
            ))}
            {allEtfs.length === 0 && (
              <div className="col-span-3 py-12 text-center text-sm"
                style={{ color: 'var(--text-muted)' }}>
                暫無ETF資料。請先執行 POST /api/etf 種子資料。
              </div>
            )}
          </div>
        )}

        {/* ── Recommendation widget ───────────────────────────────────────── */}
        <RecommendWidget allEtfs={allEtfs} />

      </div>

      {/* ── Floating compare button ─────────────────────────────────────── */}
      {selectedSymbols.length > 0 && !comparing && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <button
            onClick={handleCompare}
            className="flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-xl transition-transform duration-100 hover:scale-105"
            style={{
              backgroundColor: 'var(--accent-green)',
              color: 'var(--bg-primary)',
            }}
          >
            開始比較 ({selectedSymbols.length})
            <span className="flex gap-1">
              {selectedSymbols.map(s => (
                <span key={s} className="rounded bg-white/20 px-1.5 py-0.5 text-xs">{s}</span>
              ))}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
