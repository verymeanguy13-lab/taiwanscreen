'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { PTTWidget } from '@/components/stock/PTTWidget';

// ── Fetcher ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-9 rounded"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            opacity: 1 - i * 0.12,
            animation: 'pulse 1.6s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  );
}

// ── Feature cards data ────────────────────────────────────────────────────────

const FEATURES = [
  { icon: '🔍', title: '選股器',  desc: '20+ 技術、籌碼條件快速篩選個股',       href: '/screener'     },
  { icon: '🗺️', title: '熱力圖',  desc: '一眼看出全市場資金流向與板塊輪動',     href: '/heatmap'      },
  { icon: '🏦', title: '法人動向', desc: '外資、投信、自營商即時買超排行',        href: '/institutional' },
  { icon: '🔗', title: '供應鏈圖', desc: '台積電、鴻海等主要企業供應鏈全覽',     href: '/supply-chain' },
  { icon: '📊', title: 'ETF比較', desc: '0050、0056 等熱門 ETF 成分股比較',    href: '/etf'          },
  { icon: '💰', title: '存股篩選', desc: '高殖利率優質定存股一鍵篩選',           href: '/dividend'     },
];

const BREAKOUT_CONFIG: Record<string, { color: string; bg: string }> = {
  '上漲趨勢突破': { color: '#3D8EF8', bg: '#0D1B3B' },
  '箱型整理突破': { color: '#F5B700', bg: '#3B2D00' },
  '下跌V轉突破':  { color: '#FF4D6D', bg: '#3B0D0D' },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveMarketBar() {
  const { data, error } = useSWR('/api/heatmap', fetcher, {
    refreshInterval: 0, shouldRetryOnError: false,
  });

  const summary = data?.marketSummary ?? data?.data?.marketSummary;

  if (error || !summary) {
    return (
      <div className="w-full py-2 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
        {error ? '市場資料載入失敗' : '載入中…'}
      </div>
    );
  }

  const items = [
    { label: '上漲',   value: `${summary.up_count}家`,   color: 'var(--accent-red)'     },
    { label: '下跌',   value: `${summary.down_count}家`, color: 'var(--accent-green)'   },
    { label: '平盤',   value: `${summary.flat_count}家`, color: 'var(--text-secondary)' },
    { label: '成交量', value: `${(summary.total_volume / 10_000).toFixed(1)}萬張`, color: 'var(--accent-blue)' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 py-2 text-sm"
      style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      {items.map(({ label, value, color }, i) => (
        <span key={i} className="flex items-center gap-1">
          <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
          <span className="font-semibold tabular-nums" style={{ color }}>{value}</span>
        </span>
      ))}
    </div>
  );
}

function FeatureCard({ icon, title, desc, href }: { icon: string; title: string; desc: string; href: string }) {
  return (
    <Link href={href} className="group flex flex-col gap-2 rounded-lg p-4 transition-all duration-150"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-green)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
      <span className="text-2xl">{icon}</span>
      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
      <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
    </Link>
  );
}

function TopForeignBuyColumn() {
  const { data: res, error } = useSWR('/api/institutional?mode=top_foreign_buy&limit=5', fetcher, { shouldRetryOnError: false });
  const items = Array.isArray(res?.data) ? res.data : [];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>📈 外資買超前5名</h3>
      {!res && !error ? <Skeleton rows={5} /> : error ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>資料載入失敗</p>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>暫無資料</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item: any, i: number) => (
            <li key={item.symbol} className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <span style={{ color: 'var(--text-secondary)' }} className="w-4 shrink-0">{i + 1}</span>
              <Link href={`/stock/${item.symbol}`} className="flex-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                {item.symbol} {item.name_zh}
              </Link>
              <span className="tabular-nums font-semibold" style={{ color: 'var(--accent-red)' }}>
                +{(item.foreign_net / 100_000_000).toFixed(1)}億
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TripleBuyColumn() {
  const { data: res, error } = useSWR('/api/institutional?mode=triple_buy', fetcher, { shouldRetryOnError: false });
  const items = Array.isArray(res?.data) ? res.data : [];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>🔥 三買訊號今日</h3>
      {!res && !error ? <Skeleton rows={5} /> : error ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>資料載入失敗</p>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>暫無資料</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, 5).map((item: any) => (
            <li key={item.symbol} className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <Link href={`/stock/${item.symbol}`} className="flex-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                {item.symbol} {item.name_zh}
              </Link>
              <span className="tabular-nums font-semibold" style={{ color: 'var(--accent-red)' }}>
                {item.total_net != null ? `+${(item.total_net / 100_000_000).toFixed(1)}億` : '三買'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpcomingDividendColumn() {
  const { data: res, error } = useSWR('/api/dividend?mode=upcoming', fetcher, { shouldRetryOnError: false });
  const items = Array.isArray(res?.data?.rows) ? res.data.rows : Array.isArray(res?.data) ? res.data : [];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>💰 近期除息股</h3>
      {!res && !error ? <Skeleton rows={5} /> : error ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>資料載入失敗</p>
      ) : items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>暫無資料</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, 5).map((item: any) => {
            const exDate = item.ex_dividend_date
              ? String(item.ex_dividend_date).slice(0, 10)
              : item.exDate ?? '—';
            const dividend = item.cash_dividend ?? item.yield ?? 0;
            return (
              <li key={item.symbol} className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <Link href={`/stock/${item.symbol}`} className="flex-1 font-medium" style={{ color: 'var(--text-primary)' }}>
                  {item.symbol} {item.name_zh ?? item.name}
                </Link>
                <div className="flex flex-col items-end gap-0.5">
                  <span style={{ color: 'var(--text-secondary)' }}>{exDate}</span>
                  <span className="tabular-nums font-semibold" style={{ color: 'var(--accent-blue)' }}>
                    ${Number(dividend).toFixed(2)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Scanner Section ───────────────────────────────────────────────────────────

function ScannerSection() {
  const { data, isLoading } = useSWR('/api/kline/scanner', fetcher, {
    revalidateOnFocus: false, shouldRetryOnError: false,
  });

  const results: any[] = data?.results?.slice(0, 6) ?? [];

  if (!isLoading && results.length === 0) return null;

  return (
    <section className="border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-12">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: '#F5B700' }}>
              ⚡ 今日起漲訊號
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              系統自動掃描全市場，找出具有突破潛力的股票
            </p>
          </div>
          <Link href="/rankings" className="text-xs font-medium" style={{ color: 'var(--accent-green)' }}>
            查看全部起漲訊號 →
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--bg-secondary)' }} />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {results.map(r => {
              const cfg = BREAKOUT_CONFIG[r.breakoutType] ?? { color: '#8B8FA8', bg: '#1E2235' };
              // Taiwan convention: red = up, green = down
              const changeColor = r.changePercent >= 0 ? 'var(--accent-red)' : 'var(--accent-green)';
              const score = r.confidence ?? r.matrixScore ?? 0;
              return (
                <Link key={r.symbol} href={`/stock/${r.symbol}`}
                  className="flex flex-col gap-2 rounded-lg p-3 transition-all duration-150"
                  style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#F5B700'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {r.symbol}
                      </div>
                      <div style={{ fontSize: 11, color: '#8B8FA8' }}>{r.name_zh}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'IBM Plex Mono', monospace" }}>
                        {r.price?.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 11, color: changeColor, fontWeight: 700 }}>
                        {r.changePercent >= 0 ? '+' : ''}{r.changePercent?.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                  {r.breakoutType && (
                    <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, fontWeight: 600, alignSelf: 'flex-start',
                      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44` }}>
                      {r.breakoutType}
                    </span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 3, background: '#1E2235', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${score}%`, background: '#F5B700', borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 10, color: '#F5B700', fontWeight: 700 }}>{score}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Accuracy Teaser Section ───────────────────────────────────────────────────

function AccuracyTeaserSection() {
  const { data, isLoading } = useSWR('/api/kline/accuracy?period=5d&limit=3', fetcher, {
    revalidateOnFocus: false, shouldRetryOnError: false,
  });

  const summary = data?.summary;
  const topSignals: any[] = (data?.recentSignals ?? [])
    .filter((s: any) => s.price_up_10d === true)
    .slice(0, 3);

  if (!isLoading && (!summary || summary.totalSignals === 0)) return null;

  const priceUpRate = summary?.priceUpRate ?? 0;
  const avgReturn   = summary?.avgReturn   ?? 0;
  const total       = summary?.totalSignals ?? 0;

  return (
    <section className="border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-12">

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)', marginBottom: 12 }}>
              📊 訊號準不準？看數字。
            </h2>
            {isLoading ? (
              <div style={{ display: 'flex', gap: 24 }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{ width: 80, height: 36, borderRadius: 6, backgroundColor: 'var(--bg-secondary)', animation: 'pulse 1.6s infinite' }} />
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                {[
                  { label: '條件後上漲比例', value: `${priceUpRate}%`, color: priceUpRate >= 50 ? 'var(--accent-red)' : 'var(--accent-green)' },
                  { label: '平均5日報酬',   value: `${avgReturn >= 0 ? '+' : ''}${avgReturn}%`, color: avgReturn >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' },
                  { label: '累計訊號次數',   value: total.toLocaleString(), color: 'var(--text-primary)' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link href="/accuracy"
            style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}>
            查看完整型態統計 →
          </Link>
        </div>

        {!isLoading && topSignals.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topSignals.map((s: any) => {
              const ret = s.return_10d;
              // Taiwan convention: red = up, green = down
              const retColor = ret === null ? 'var(--text-muted)' : ret >= 0 ? 'var(--accent-red)' : 'var(--accent-green)';
              return (
                <Link key={s.id} href={`/stock/${s.symbol}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 10,
                    border: '1px solid var(--border)', backgroundColor: 'var(--bg-card)',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 72 }}>
                    {String(s.signal_date).slice(0, 10)}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 4,
                    color: 'var(--accent-green)', backgroundColor: 'rgba(0,212,170,0.12)',
                    border: '1px solid rgba(0,212,170,0.3)', whiteSpace: 'nowrap',
                  }}>
                    {s.signal_type}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {s.symbol}
                  </span>
                  {s.industry && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)', padding: '1px 5px', borderRadius: 4 }}>
                      {s.industry}
                    </span>
                  )}
                  <span style={{ fontSize: 16, fontWeight: 800, color: retColor }}>
                    {ret === null ? '—' : `${ret >= 0 ? '+' : ''}${ret.toFixed(2)}%`}
                  </span>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 4,
                    color: 'var(--accent-red)', backgroundColor: 'rgba(255,77,109,0.12)',
                    border: '1px solid rgba(255,77,109,0.3)',
                  }}>
                    ▲ 上漲
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <main style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>

      <LiveMarketBar />

      {/* Hero */}
      <section className="mx-auto max-w-screen-xl px-4 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl" style={{ color: 'var(--text-primary)' }}>
          台股雷達
        </h1>
        <p className="mt-3 text-lg font-medium" style={{ color: 'var(--accent-green)' }}>
          台灣最完整的免費股票研究平台
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          三大法人、券商分點、供應鏈圖 — 全部免費，不需下載App
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/screener"
            className="inline-flex h-10 items-center justify-center rounded px-5 text-sm font-semibold transition-colors duration-150"
            style={{ backgroundColor: 'var(--accent-green)', color: 'var(--bg-primary)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.88'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}>
            開始選股 →
          </Link>
          <Link href="/heatmap"
            className="inline-flex h-10 items-center justify-center rounded px-5 text-sm font-semibold transition-colors duration-150"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-green)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
            查看熱力圖
          </Link>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="mx-auto max-w-screen-xl px-4 pb-14">
        <h2 className="mb-5 text-base font-semibold" style={{ color: 'var(--text-secondary)' }}>功能總覽</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.map(f => <FeatureCard key={f.href} {...f} />)}
        </div>
      </section>

      {/* Today's Highlights */}
      <section className="border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-screen-xl px-4 py-12">
          <h2 className="mb-6 text-base font-semibold" style={{ color: 'var(--text-secondary)' }}>今日重點</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <TopForeignBuyColumn />
            <TripleBuyColumn />
            <UpcomingDividendColumn />
          </div>
        </div>
      </section>

      {/* Scanner Section */}
      <ScannerSection />

      {/* Accuracy Teaser */}
      {/* <AccuracyTeaserSection /> */}

      {/* Why Us */}
      <section className="border-t" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="mx-auto max-w-screen-xl px-4 py-12 text-center">
          <h2 className="mb-4 text-lg font-bold" style={{ color: 'var(--text-primary)' }}>為什麼選台股雷達？</h2>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            {['免費提供籌碼K線的付費功能', '完整券商分點資料', '台灣首個供應鏈圖'].map((item, i) => (
              <span key={i} className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                {i > 0 && <span style={{ color: 'var(--border)' }}>|</span>}
                <span style={{ color: 'var(--accent-green)' }} className="font-medium">{item}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}
