'use client';

// =============================================================================
// components/stock/LargeOrdersTab.tsx
// Tab: 大單追蹤 — REBUILT as an institutional-flow view.
//
// Why the redesign: the original spec (per-broker large block trades) turned
// out to need data TWSE doesn't expose for free (分點進出). This reuses the
// already-correct institutional_flows table instead:
//   A) This stock's own daily 外資/投信/自營商 net buy-sell + streak badges
//   B) Where it ranks today among ALL stocks by foreign net buying
//
// Color convention: Taiwan style (red = buy/net-positive, green = sell/
// net-negative), matching InstitutionalClient.tsx and the candlestick chart.
// Uses --accent-red / --accent-green / --bg-card CSS vars per design system.
// =============================================================================

import { useState } from 'react';
import useSWR from 'swr';
import type { DailyFlow, MarketRank } from '@/lib/largeOrders';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  symbol: string;
}

function formatNet(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString()}`;
}

function NetCell({ value }: { value: number }) {
  const color =
    value > 0
      ? 'text-[var(--accent-red)]'
      : value < 0
      ? 'text-[var(--accent-green)]'
      : 'text-gray-400';
  return (
    <span className={`font-mono font-semibold ${color}`}>
      {formatNet(value)}
    </span>
  );
}

function StreakBadge({ label, days }: { label: string; days: number }) {
  if (days < 3) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--accent-red)]/15 px-2 py-0.5 text-xs font-bold text-[var(--accent-red)]">
      {label}連買{days}日
    </span>
  );
}

export default function LargeOrdersTab({ symbol }: Props) {
  const [days, setDays] = useState(5);

  const { data, isLoading, error } = useSWR<{
    flows: DailyFlow[];
    rank: MarketRank | null;
  }>(`/api/large-orders/${symbol}?days=${days}`, fetcher, {
    refreshInterval: 5 * 60 * 1000, // 5 min
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 rounded-lg bg-white/5" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-[var(--bg-card)] p-6 text-center text-sm text-gray-400">
        無法載入籌碼資料，請稍後再試。
      </div>
    );
  }

  const flows = data?.flows ?? [];
  const rank = data?.rank ?? null;
  const latest = flows[0];

  return (
    <div className="space-y-8">
      {/* ── Days selector ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-400">查詢區間：</span>
        {[3, 5, 10, 20].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded px-3 py-1 text-sm transition-colors ${
              days === d
                ? 'bg-[var(--accent-green)] text-black font-semibold'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            {d}日
          </button>
        ))}
      </div>

      {/* ── Section B (shown first): Market rank leaderboard ───────────────── */}
      <section className="rounded-lg border border-white/10 bg-[var(--bg-card)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          外資買超排名
          <span className="ml-2 text-xs font-normal text-gray-500">
            (今日全市場)
          </span>
        </h3>
        {rank ? (
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono text-3xl font-bold text-gray-100">
                #{rank.rank}
                <span className="ml-1 text-base font-normal text-gray-500">
                  / {rank.totalStocks}
                </span>
              </p>
              <p className="mt-1 text-xs text-gray-500">{rank.date}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">外資買超</p>
              <NetCell value={rank.foreignNet} />
              <p className="mt-1 text-xs text-gray-500">
                贏過 {rank.percentile}% 個股
              </p>
            </div>
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-gray-500">
            尚無排名資料
          </p>
        )}
        {latest && (
          <div className="mt-3 flex flex-wrap gap-2">
            <StreakBadge label="外資" days={latest.foreignConsecutiveDays} />
            <StreakBadge label="投信" days={latest.trustConsecutiveDays} />
            {latest.tripleBuy && (
              <span className="inline-flex items-center rounded-full bg-[var(--accent-red)]/25 px-2 py-0.5 text-xs font-bold text-[var(--accent-red)]">
                三大法人同步買超
              </span>
            )}
          </div>
        )}
      </section>

      {/* ── Section A: Daily flow table ──────────────────────────────────── */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          法人買賣超明細
          <span className="ml-2 text-xs font-normal text-gray-500">
            (張)
          </span>
        </h3>

        {flows.length === 0 ? (
          <div className="rounded-lg bg-white/5 py-8 text-center text-sm text-gray-500">
            近{days}日內無法人買賣超紀錄
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500">
                  <th className="px-3 py-2 text-left">日期</th>
                  <th className="px-3 py-2 text-right">外資</th>
                  <th className="px-3 py-2 text-right">投信</th>
                  <th className="px-3 py-2 text-right">自營商</th>
                  <th className="px-3 py-2 text-right">合計</th>
                </tr>
              </thead>
              <tbody>
                {flows.map((f) => (
                  <tr
                    key={f.date}
                    className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                      f.totalNet > 0
                        ? 'border-l-2 border-l-[var(--accent-red)]'
                        : f.totalNet < 0
                        ? 'border-l-2 border-l-[var(--accent-green)]'
                        : ''
                    }`}
                  >
                    <td className="px-3 py-2 text-gray-400">{f.date}</td>
                    <td className="px-3 py-2 text-right"><NetCell value={f.foreignNet} /></td>
                    <td className="px-3 py-2 text-right"><NetCell value={f.trustNet} /></td>
                    <td className="px-3 py-2 text-right"><NetCell value={f.dealerNet} /></td>
                    <td className="px-3 py-2 text-right"><NetCell value={f.totalNet} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Data source note ─────────────────────────────────────────────── */}
      <p className="text-xs text-gray-600 text-right">
        資料來源：TWSE 三大法人買賣超 · 每日收盤後更新
      </p>
    </div>
  );
}
