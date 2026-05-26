'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import useSWR, { mutate } from 'swr';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface Watchlist {
  id:     number;
  name:   string;
  stocks: { symbol: string }[];
}

interface WatchlistButtonProps {
  symbol: string;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WatchlistButton({ symbol }: WatchlistButtonProps) {
  const { data: session, status } = useSession();
  const [open,        setOpen]        = useState(false);
  const [creating,    setCreating]    = useState(false);
  const [newName,     setNewName]     = useState('');
  const [loading,     setLoading]     = useState<number | null>(null);
  const [tooltip,     setTooltip]     = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: res } = useSWR(
    status === 'authenticated' && open ? '/api/watchlist' : null,
    fetcher,
  );

  const watchlists: Watchlist[] = res?.data ?? [];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setNewName('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // ── Is stock in a given watchlist ──────────────────────────────────────────
  const isInWatchlist = (wl: Watchlist) =>
    wl.stocks.some(s => s.symbol === symbol);

  // ── Is stock in ANY watchlist ──────────────────────────────────────────────
  const inAny = watchlists.some(isInWatchlist);

  // ── Toggle stock in watchlist ──────────────────────────────────────────────
  const handleToggle = async (wl: Watchlist) => {
    setLoading(wl.id);
    const action = isInWatchlist(wl) ? 'remove' : 'add';
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: wl.id, action, symbol }),
    });
    mutate('/api/watchlist');
    setLoading(null);
  };

  // ── Create new watchlist and add stock ─────────────────────────────────────
  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(-1);
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const json = await res.json();
    if (res.ok && json.data?.id) {
      // Add stock to new watchlist immediately
      await fetch('/api/watchlist', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: json.data.id, action: 'add', symbol }),
      });
      mutate('/api/watchlist');
    }
    setCreating(false);
    setNewName('');
    setLoading(null);
  };

  // ── Not logged in: show tooltip ────────────────────────────────────────────
  const handleClick = () => {
    if (status === 'unauthenticated') {
      setTooltip(true);
      setTimeout(() => setTooltip(false), 2000);
      return;
    }
    setOpen(prev => !prev);
  };

  return (
    <div className="relative" ref={dropdownRef}>

      {/* ── Star button ───────────────────────────────────────────────── */}
      <button
        onClick={handleClick}
        title={status === 'authenticated' ? '加入自選股' : '請先登入'}
        className="flex items-center justify-center rounded-full w-8 h-8 transition-colors duration-100"
        style={{
          backgroundColor: inAny ? 'rgba(245,183,0,0.15)' : 'var(--bg-secondary)',
          border: `1px solid ${inAny ? 'rgba(245,183,0,0.4)' : 'var(--border)'}`,
          color: inAny ? 'var(--accent-gold)' : 'var(--text-muted)',
          fontSize: 16,
        }}
        onMouseEnter={e => {
          if (!inAny) (e.currentTarget as HTMLElement).style.color = 'var(--accent-gold)';
        }}
        onMouseLeave={e => {
          if (!inAny) (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
        }}
      >
        {inAny ? '★' : '☆'}
      </button>

      {/* ── Not logged in tooltip ─────────────────────────────────────── */}
      {tooltip && (
        <div
          className="absolute left-1/2 -translate-x-1/2 top-10 z-50 rounded px-3 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        >
          請先登入
          <button
            onClick={() => signIn('google')}
            className="ml-2 font-semibold"
            style={{ color: 'var(--accent-green)' }}
          >
            登入
          </button>
        </div>
      )}

      {/* ── Dropdown ──────────────────────────────────────────────────── */}
      {open && status === 'authenticated' && (
        <div
          className="absolute left-0 top-10 z-50 rounded-lg shadow-xl"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            minWidth: 200,
          }}
        >
          <div className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            加入自選股
          </div>

          {watchlists.length === 0 && !creating && (
            <div className="px-3 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              尚無清單
            </div>
          )}

          {/* Watchlist items */}
          {watchlists.map(wl => {
            const checked = isInWatchlist(wl);
            const busy    = loading === wl.id;
            return (
              <button
                key={wl.id}
                onClick={() => handleToggle(wl)}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors duration-100"
                style={{
                  color: 'var(--text-primary)',
                  backgroundColor: 'transparent',
                  opacity: busy ? 0.5 : 1,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.06)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                <span style={{ color: checked ? 'var(--accent-green)' : 'var(--text-muted)', fontSize: 14 }}>
                  {checked ? '☑' : '☐'}
                </span>
                <span className="flex-1 text-left">{wl.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>({wl.stocks.length})</span>
              </button>
            );
          })}

          {/* Create new watchlist */}
          {creating ? (
            <div className="px-3 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
                placeholder="清單名稱"
                className="w-full rounded px-2 py-1 text-xs"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  marginBottom: 6,
                }}
              />
              <div className="flex gap-1">
                <button
                  onClick={handleCreate}
                  disabled={loading === -1}
                  className="flex-1 rounded py-1 text-xs font-semibold transition-colors duration-100"
                  style={{ backgroundColor: 'var(--accent-green)', color: 'var(--bg-primary)' }}
                >
                  {loading === -1 ? '建立中…' : '建立'}
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName(''); }}
                  className="rounded px-2 py-1 text-xs"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              disabled={watchlists.length >= 5}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors duration-100"
              style={{
                color: watchlists.length >= 5 ? 'var(--text-muted)' : 'var(--accent-green)',
                borderTop: '1px solid var(--border)',
              }}
              onMouseEnter={e => { if (watchlists.length < 5) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(0,212,170,0.06)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              + 建立新清單
              {watchlists.length >= 5 && (
                <span style={{ color: 'var(--text-muted)' }}>(已達上限)</span>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
