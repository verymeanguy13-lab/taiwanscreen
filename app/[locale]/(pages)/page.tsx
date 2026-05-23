'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';

// ── Types ────────────────────────────────────────────────────────────────────

interface MarketSummary {
  up: number;
  down: number;
  flat: number;
  volume: number; // in 張
}

interface TopForeignBuy {
  symbol: string;
  name: string;
  net: number; // 億
}

interface TripleBuy {
  symbol: string;
  name: string;
  score: number;
}

interface UpcomingDividend {
  symbol: string;
  name: string;
  exDate: string;
  yield: number;
}

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
  {
    icon: '🔍',
    title: '選股器',
    desc: '20+ 技術、籌碼條件快速篩選個股',
    href: '/screener',
  },
  {
    icon: '🗺️',
    title: '熱力圖',
    desc: '一眼看出全市場資金流向與板塊輪動',
    href: '/heatmap',
  },
  {
    icon: '🏦',
    title: '法人動向',
    desc: '外資、投信、自營商即時買超排行',
    href: '/institutional',
  },
  {
    icon: '🔗',
    title: '供應鏈圖',
    desc: '台積電、鴻海等主要企業供應鏈全覽',
    href: '/supply-chain',
  },
  {
    icon: '📊',
    title: 'ETF比較',
    desc: '0050、0056 等熱門 ETF 成分股比較',
    href: '/etf',
  },
  {
    icon: '💰',
    title: '存股篩選',
    desc: '高殖利率優質定存股一鍵篩選',
    href: '/dividend',
  },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveMarketBar() {
  const { data, error } = useSWR(
    '/api/heatmap',
    fetcher,
    { refreshInterval: 0,
      shouldRetryOnError: false
    }
  );

  const summary = data?.data?.marketSummary;

  if (error || !summary) {
    return (
      <div className="w-full py-2 text-center text-xs"
        style={{ color: 'var(--text-secondary)' }}>
        {error ? '市場資料載入失敗' : '載入中…'}
      </div>
    );
  }

  const items = [
    { label: '上漲', value: `${summary.up_count}家`,   color: 'var(--accent-green)' },
    { label: '下跌', value: `${summary.down_count}家`, color: 'var(--accent-red)'   },
    { label: '平盤', value: `${summary.flat_count}家`, color: 'var(--text-secondary)' },
    { label: '成交量', value: `${(summary.total_volume / 10_000).toFixed(1)}萬張`, color: 'var(--accent-blue)' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 py-2 text-sm"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
      }}>
      {items.map(({ label, value, color }, i) => (
        <span key={i} className="flex items-center gap-1">
          <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
          <span className="font-semibold tabular-nums" style={{ color }}>{value}</span>
        </span>
      ))}
    </div>
  );
}
function FeatureCard({
  icon,
  title,
  desc,
  href,
}: {
  icon: string;
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg p-4 transition-all duration-150"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-green)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
      }}
    >
      <span className="text-2xl">{icon}</span>
      <span
        className="text-sm font-semibold"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </span>
      <span
        className="text-xs leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        {desc}
      </span>
    </Link>
  );
}

function TopForeignBuyColumn() {
  const { data, error } = useSWR<TopForeignBuy[]>(
    '/api/institutional?mode=top_foreign_buy&limit=5',
    fetcher,{
      shouldRetryOnError: false
    }
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        📈 外資買超前5名
      </h3>
      {!data && !error ? (
        <Skeleton rows={5} />
      ) : error ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          資料載入失敗
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(data ?? []).map((item, i) => (
            <li
              key={item.symbol}
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }} className="w-4 shrink-0">
                {i + 1}
              </span>
              <Link
                href={`/stock/${item.symbol}`}
                className="flex-1 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {item.symbol} {item.name}
              </Link>
              <span
                className="tabular-nums font-semibold"
                style={{ color: 'var(--accent-green)' }}
              >
                +{item.net.toFixed(1)}億
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TripleBuyColumn() {
  const { data, error } = useSWR<TripleBuy[]>(
    '/api/institutional?mode=triple_buy',
    fetcher,{
      shouldRetryOnError: false
    }
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        🔥 三買訊號今日
      </h3>
      {!data && !error ? (
        <Skeleton rows={5} />
      ) : error ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          資料載入失敗
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(data ?? []).map(item => (
            <li
              key={item.symbol}
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <Link
                href={`/stock/${item.symbol}`}
                className="flex-1 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {item.symbol} {item.name}
              </Link>
              <span
                className="tabular-nums font-semibold"
                style={{ color: 'var(--accent-green)' }}
              >
                ★{item.score}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UpcomingDividendColumn() {
  const { data, error } = useSWR<UpcomingDividend[]>(
    '/api/dividend?mode=upcoming',
    fetcher,{
      shouldRetryOnError: false
    }
  );

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        💰 近期除息股
      </h3>
      {!data && !error ? (
        <Skeleton rows={5} />
      ) : error ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          資料載入失敗
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(data ?? []).map(item => (
            <li
              key={item.symbol}
              className="flex items-center justify-between rounded px-2 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <Link
                href={`/stock/${item.symbol}`}
                className="flex-1 font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {item.symbol} {item.name}
              </Link>
              <div className="flex flex-col items-end gap-0.5">
                <span style={{ color: 'var(--text-secondary)' }}>{item.exDate}</span>
                <span
                  className="tabular-nums font-semibold"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  {item.yield.toFixed(2)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <main style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>

      {/* ── Live Market Bar ── */}
      <LiveMarketBar />

      {/* ── Hero ── */}
      <section className="mx-auto max-w-screen-xl px-4 py-16 text-center">
        <h1
          className="text-4xl font-bold tracking-tight md:text-5xl"
          style={{ color: 'var(--text-primary)' }}
        >
          台股雷達
        </h1>
        <p
          className="mt-3 text-lg font-medium"
          style={{ color: 'var(--accent-green)' }}
        >
          台灣最完整的免費股票研究平台
        </p>
        <p
          className="mt-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          三大法人、券商分點、供應鏈圖 — 全部免費，不需下載App
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/screener"
            className="inline-flex h-10 items-center justify-center rounded px-5 text-sm font-semibold transition-colors duration-150"
            style={{
              backgroundColor: 'var(--accent-green)',
              color: 'var(--bg-primary)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.opacity = '0.88';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.opacity = '1';
            }}
          >
            開始選股 →
          </Link>
          <Link
            href="/heatmap"
            className="inline-flex h-10 items-center justify-center rounded px-5 text-sm font-semibold transition-colors duration-150"
            style={{
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-green)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            查看熱力圖
          </Link>
        </div>
      </section>

      {/* ── Feature Grid ── */}
      <section className="mx-auto max-w-screen-xl px-4 pb-14">
        <h2
          className="mb-5 text-base font-semibold"
          style={{ color: 'var(--text-secondary)' }}
        >
          功能總覽
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.map(f => (
            <FeatureCard key={f.href} {...f} />
          ))}
        </div>
      </section>

      {/* ── Today's Highlights ── */}
      <section
        className="border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mx-auto max-w-screen-xl px-4 py-12">
          <h2
            className="mb-6 text-base font-semibold"
            style={{ color: 'var(--text-secondary)' }}
          >
            今日重點
          </h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <TopForeignBuyColumn />
            <TripleBuyColumn />
            <UpcomingDividendColumn />
          </div>
        </div>
      </section>

      {/* ── Why Us ── */}
      <section
        className="border-t"
        style={{
          borderColor: 'var(--border)',
          backgroundColor: 'var(--bg-secondary)',
        }}
      >
        <div className="mx-auto max-w-screen-xl px-4 py-12 text-center">
          <h2
            className="mb-4 text-lg font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            為什麼選台股雷達？
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            {[
              '免費提供籌碼K線的付費功能',
              '完整券商分點資料',
              '台灣首個供應鏈圖',
            ].map((item, i) => (
              <span
                key={i}
                className="flex items-center gap-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {i > 0 && (
                  <span style={{ color: 'var(--border)' }}>|</span>
                )}
                <span
                  style={{ color: 'var(--accent-green)' }}
                  className="font-medium"
                >
                  {item}
                </span>
              </span>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}
