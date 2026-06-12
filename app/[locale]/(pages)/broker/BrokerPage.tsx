'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Card }     from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button }   from '@/components/ui/Button';
import { formatChange } from '@/lib/utils';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface BrokerRow {
  broker_id:   string;
  broker_name: string;
  buy_volume:  number;
  sell_volume: number;
  net_volume:  number;
}

interface ScrapeResult {
  symbol: string;
  date:   string;
  rows:   BrokerRow[];
  count:  number;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtVol(v: number): string {
  if (v === 0) return '—';
  const abs = Math.abs(v).toLocaleString('en-US');
  return v > 0 ? `+${abs}` : `-${abs}`;
}

function NetBar({ net, max }: { net: number; max: number }) {
  if (max === 0) return null;
  const pct = Math.min(Math.abs(net) / max * 100, 100);
  const color = net >= 0 ? 'var(--accent-red)' : 'var(--accent-green)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 6, backgroundColor: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span className="num font-semibold" style={{ color, minWidth: 60, fontSize: 11 }}>
        {fmtVol(net)} 張
      </span>
    </div>
  );
}

// ── Broker table ──────────────────────────────────────────────────────────────
function BrokerTable({ rows, isLoading }: { rows: BrokerRow[]; isLoading: boolean }) {
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (rows.length === 0) return (
    <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
      查無券商分點資料
    </div>
  );

  const maxNet = Math.max(...rows.map(r => Math.abs(r.net_volume)));

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ minWidth: 480 }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
            {['#', '券商', '買進(張)', '賣出(張)', '買賣超'].map(h => (
              <th key={h} className="px-3 py-2 text-left font-semibold"
                style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.broker_id}
              style={{
                backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                borderBottom: '1px solid var(--border)',
              }}>
              <td className="num px-3 py-2"
                style={{ color: idx < 3 ? 'var(--accent-gold)' : 'var(--text-muted)' }}>
                {idx + 1}
              </td>
              <td className="px-3 py-2">
                <span className="num" style={{ color: 'var(--text-muted)', fontSize: 10 }}>{row.broker_id}</span>
                <span className="ml-1.5" style={{ color: 'var(--text-primary)' }}>{row.broker_name}</span>
              </td>
              <td className="num px-3 py-2" style={{ color: 'var(--accent-red)' }}>
                {row.buy_volume > 0 ? row.buy_volume.toLocaleString('en-US') : '—'}
              </td>
              <td className="num px-3 py-2" style={{ color: 'var(--accent-green)' }}>
                {row.sell_volume > 0 ? row.sell_volume.toLocaleString('en-US') : '—'}
              </td>
              <td className="px-3 py-2">
                <NetBar net={row.net_volume} max={maxNet} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BrokerPage() {
  const router = useRouter();
  const [input,         setInput]         = useState('');
  const [searchSymbol,  setSearchSymbol]  = useState('');

  const apiUrl = searchSymbol
    ? `/api/broker/scrape?symbol=${searchSymbol}`
    : null;

  const { data, isLoading, error } = useSWR<ScrapeResult>(apiUrl, fetcher, {
    revalidateOnFocus: false,
  });

  const handleSearch = () => {
    const sym = input.trim().toUpperCase();
    if (!sym) return;
    setSearchSymbol(sym);
  };

  const rows = data?.rows ?? [];

  // Summary stats
  const totalBuy  = rows.reduce((s, r) => s + r.buy_volume,  0);
  const totalSell = rows.reduce((s, r) => s + r.sell_volume, 0);
  const totalNet  = totalBuy - totalSell;
  const topBuyers  = [...rows].sort((a, b) => b.buy_volume  - a.buy_volume).slice(0, 5);
  const topSellers = [...rows].sort((a, b) => b.sell_volume - a.sell_volume).slice(0, 5);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            券商分點查詢
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            輸入股票代號，查詢各券商分點當日買賣動向
          </p>
        </div>

        {/* ── Search ─────────────────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="輸入股票代號，例：2330"
              className="rounded px-3 py-2 text-sm w-48"
              style={{
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            />
            <Button variant="primary" size="sm" onClick={handleSearch}>
              查詢
            </Button>
            {data?.symbol && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                資料日期：{data.date.slice(0,4)}/{data.date.slice(4,6)}/{data.date.slice(6,8)}
              </span>
            )}
          </div>
        </Card>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {(error || data?.error) && (
          <div className="rounded-lg px-4 py-3 text-xs"
            style={{ backgroundColor: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.25)', color: 'var(--accent-red)' }}>
            無法取得資料，請稍後再試。TWSE 分點資料每交易日 16:00 後更新。
          </div>
        )}

        {/* ── Summary stats ──────────────────────────────────────────────── */}
        {!isLoading && rows.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '總買進', value: totalBuy.toLocaleString('en-US'),  color: 'var(--accent-red)'   },
              { label: '總賣出', value: totalSell.toLocaleString('en-US'), color: 'var(--accent-green)' },
              { label: '買賣超', value: (totalNet >= 0 ? '+' : '') + totalNet.toLocaleString('en-US'),
                color: totalNet >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl py-3 flex flex-col items-center gap-1"
                style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
                <span className="num font-bold text-sm" style={{ color }}>{value} 張</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Top buyers / sellers ───────────────────────────────────────── */}
        {!isLoading && rows.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-red)' }}>
                ▲ 買超前5名
              </p>
              <BrokerTable rows={topBuyers} isLoading={false} />
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--accent-green)' }}>
                ▼ 賣超前5名
              </p>
              <BrokerTable rows={topSellers} isLoading={false} />
            </div>
          </div>
        )}

        {/* ── Full broker list ────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {searchSymbol
                ? `${searchSymbol} 所有分點 (${rows.length} 筆)`
                : '請輸入股票代號查詢'}
            </p>
            {searchSymbol && (
              <button
                onClick={() => router.push(`/stock/${searchSymbol}`)}
                className="text-xs"
                style={{ color: 'var(--accent-blue)', cursor: 'pointer' }}>
                前往個股頁面 →
              </button>
            )}
          </div>
          <div className="px-4 pb-4">
            <BrokerTable rows={rows} isLoading={isLoading} />
          </div>
        </Card>

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {!searchSymbol && !isLoading && (
          <div className="flex flex-col items-center gap-3 py-12">
            <div className="text-4xl">🔍</div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              輸入股票代號開始查詢
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              支援上市股票券商分點查詢，資料來源：台灣證券交易所
            </p>
            <div className="flex gap-2 mt-2">
              {['2330', '2454', '2317', '3008', '2412'].map(sym => (
                <button key={sym}
                  onClick={() => { setInput(sym); setSearchSymbol(sym); }}
                  className="rounded px-3 py-1.5 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}>
                  {sym}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
