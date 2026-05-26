'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import useSWR, { mutate } from 'swr';
import { useRouter } from 'next/navigation';
import { Card }     from '@/components/ui/Card';
import { Button }   from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange } from '@/lib/utils';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface StockRow {
  symbol:      string;
  name_zh:     string;
  close:       number | null;
  change_pct:  number | null;
  volume:      number | null;
  foreign_net: number | null;
}

interface Watchlist {
  id:     number;
  name:   string;
  stocks: StockRow[];
}

// ── Helper ────────────────────────────────────────────────────────────────────
function fmt(v: number | null, decimals = 2): string {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtVol(v: number | null): string {
  if (v == null) return '—';
  if (v >= 10000) return `${(v / 10000).toFixed(1)}萬`;
  return v.toLocaleString('en-US');
}

function fmtNet(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US');
  return `${v >= 0 ? '+' : '-'}${abs}`;
}

// ── Watchlist table ───────────────────────────────────────────────────────────
function WatchlistTable({
  stocks,
  watchlistId,
  onRemove,
}: {
  stocks: StockRow[];
  watchlistId: number;
  onRemove: (symbol: string) => void;
}) {
  const router = useRouter();

  if (stocks.length === 0) {
    return (
      <p className="py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        尚未加入任何股票。在股票頁面點擊 ★ 加入自選股。
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
      <table className="w-full text-xs" style={{ minWidth: 500 }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
            {['代號', '股名', '股價', '漲跌%', '成交量', '外資', ''].map(h => (
              <th key={h} className="px-3 py-2 text-left font-semibold"
                style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.map((row, idx) => {
            const change = formatChange(row.change_pct ?? 0);
            return (
              <tr
                key={row.symbol}
                className="cursor-pointer transition-colors duration-100"
                onClick={() => router.push(`/stock/${row.symbol}`)}
                style={{
                  backgroundColor: idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.04)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)'; }}
              >
                <td className="num px-3 py-2 font-semibold" style={{ color: 'var(--accent-blue)' }}>
                  {row.symbol}
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {row.name_zh}
                </td>
                <td className="num px-3 py-2" style={{ color: 'var(--text-primary)' }}>
                  {row.close != null ? `NT$${fmt(row.close)}` : '—'}
                </td>
                <td className="num px-3 py-2 font-semibold" style={{ color: change.color }}>
                  {row.change_pct != null ? change.value : '—'}
                </td>
                <td className="num px-3 py-2" style={{ color: 'var(--text-secondary)' }}>
                  {fmtVol(row.volume)}
                </td>
                <td className="num px-3 py-2"
                  style={{ color: (row.foreign_net ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                  {fmtNet(row.foreign_net)}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={e => { e.stopPropagation(); onRemove(row.symbol); }}
                    className="rounded px-2 py-0.5 text-xs transition-colors duration-100"
                    style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
                  >
                    移除
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function WatchlistPage() {
  const { data: session, status } = useSession();
  const { data: res, isLoading }  = useSWR(
    status === 'authenticated' ? '/api/watchlist' : null,
    fetcher,
  );

  const [editingId,   setEditingId]   = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [creating,    setCreating]    = useState(false);
  const [newName,     setNewName]     = useState('');
  const [error,       setError]       = useState('');

  const watchlists: Watchlist[] = res?.data ?? [];

  // ── Create watchlist ───────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError('');
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? '建立失敗');
      return;
    }
    setCreating(false);
    setNewName('');
    mutate('/api/watchlist');
  };

  // ── Delete watchlist ───────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    if (!confirm('確定要刪除這個清單嗎？')) return;
    await fetch('/api/watchlist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    mutate('/api/watchlist');
  };

  // ── Remove stock from watchlist ────────────────────────────────────────────
  const handleRemove = async (watchlistId: number, symbol: string) => {
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: watchlistId, action: 'remove', symbol }),
    });
    mutate('/api/watchlist');
  };

  // ── Rename watchlist ───────────────────────────────────────────────────────
  const handleRename = async (id: number) => {
    if (!editingName.trim()) return;
    await fetch('/api/watchlist/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: editingName.trim() }),
    });
    setEditingId(null);
    mutate('/api/watchlist');
  };

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (status === 'unauthenticated') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          請先登入以使用自選股功能
        </p>
        <Button variant="primary" onClick={() => signIn('google')}>
          使用 Google 登入
        </Button>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (status === 'loading' || isLoading) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              我的自選股
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              最多建立 5 個清單
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setCreating(true); setError(''); }}
            disabled={watchlists.length >= 5}
          >
            + 新增清單
          </Button>
        </div>

        {/* ── Create new watchlist form ───────────────────────────────────── */}
        {creating && (
          <Card>
            <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              新增自選股清單
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
                placeholder="清單名稱（例：科技股、存股名單）"
                className="flex-1 rounded px-3 py-1.5 text-sm"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <Button variant="primary" size="sm" onClick={handleCreate}>建立</Button>
              <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setNewName(''); setError(''); }}>取消</Button>
            </div>
            {error && (
              <p className="mt-2 text-xs" style={{ color: 'var(--accent-red)' }}>{error}</p>
            )}
          </Card>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {watchlists.length === 0 && !creating && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              點擊 <strong>+ 新增清單</strong> 開始建立自選股
            </p>
          </div>
        )}

        {/* ── Watchlist sections ──────────────────────────────────────────── */}
        {watchlists.map(wl => (
          <div key={wl.id} className="flex flex-col gap-3">

            {/* Section header */}
            <div className="flex items-center justify-between">
              {editingId === wl.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={editingName}
                    onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(wl.id); if (e.key === 'Escape') setEditingId(null); }}
                    className="rounded px-2 py-1 text-sm font-semibold"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--accent-green)',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                  <Button variant="primary" size="sm" onClick={() => handleRename(wl.id)}>儲存</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>取消</Button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingId(wl.id); setEditingName(wl.name); }}
                  className="text-base font-bold transition-colors duration-100"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-green)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
                  title="點擊重新命名"
                >
                  {wl.name}
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>
                    ({wl.stocks.length} 檔)
                  </span>
                </button>
              )}

              <button
                onClick={() => handleDelete(wl.id)}
                className="text-xs transition-colors duration-100"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--accent-red)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
              >
                刪除清單
              </button>
            </div>

            {/* Stock table */}
            <WatchlistTable
              stocks={wl.stocks}
              watchlistId={wl.id}
              onRemove={(symbol) => handleRemove(wl.id, symbol)}
            />
          </div>
        ))}

      </div>
    </div>
  );
}
