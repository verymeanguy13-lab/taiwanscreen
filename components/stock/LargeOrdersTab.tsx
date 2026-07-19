'use client';

// =============================================================================
// components/stock/LargeOrdersTab.tsx
// Tab: 大單追蹤 — Large block trade orders for a stock.
// Two sections:
//   A) Large orders table (date, broker, direction, volume, price)
//   B) Consecutive buyers/sellers panel (3+ consecutive days)
// =============================================================================

import { useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import type { LargeOrder, ConsecutiveBuyer } from '@/lib/largeOrders';

// ─── fetcher ─────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ─── types ───────────────────────────────────────────────────────────────────
type DirectionFilter = 'all' | 'buy' | 'sell';
type ConsecutiveSortKey = 'days' | 'volume';

interface Props {
  symbol: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function DirectionBadge({ direction }: { direction: 'BUY' | 'SELL' }) {
  const isBuy = direction === 'BUY';
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${
        isBuy
          ? 'bg-green-500/15 text-green-400'
          : 'bg-red-500/15 text-red-400'
      }`}
    >
      {isBuy ? '買超' : '賣超'}
    </span>
  );
}

function StreakBadge({
  direction,
  days,
}: {
  direction: 'BUY' | 'SELL';
  days: number;
}) {
  const isBuy = direction === 'BUY';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
        isBuy
          ? 'bg-green-500/20 text-green-300'
          : 'bg-red-500/20 text-red-300'
      }`}
    >
      {isBuy ? `連買${days}日` : `連賣${days}日`}
    </span>
  );
}

// ─── main component ───────────────────────────────────────────────────────────
export default function LargeOrdersTab({ symbol }: Props) {
  const t = useTranslations('stock');

  const [days, setDays] = useState(5);
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('all');
  const [sortKey, setSortKey] = useState<ConsecutiveSortKey>('days');

  const { data, isLoading, error } = useSWR<{
    largeOrders: LargeOrder[];
    consecutiveBuyers: ConsecutiveBuyer[];
  }>(`/api/large-orders/${symbol}?days=${days}`, fetcher, {
    refreshInterval: 5 * 60 * 1000, // 5 min
  });

  // ── filter + sort ──────────────────────────────────────────────────────────
  const filteredOrders = (data?.largeOrders ?? []).filter((o) => {
    if (dirFilter === 'buy')  return o.direction === 'BUY';
    if (dirFilter === 'sell') return o.direction === 'SELL';
    return true;
  });

  const sortedBuyers = [...(data?.consecutiveBuyers ?? [])].sort((a, b) =>
    sortKey === 'days'
      ? b.consecutiveDays - a.consecutiveDays
      : b.totalVolume - a.totalVolume,
  );

  // ── skeleton ───────────────────────────────────────────────────────────────
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
      <div className="rounded-lg bg-white/5 p-6 text-center text-sm text-gray-400">
        無法載入大單資料，請稍後再試。
      </div>
    );
  }

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

      {/* ── Section A: Large Orders Table ────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            大單明細
            <span className="ml-2 text-xs font-normal text-gray-500">
              (≥100張 / 日)
            </span>
          </h3>

          {/* Direction filter */}
          <div className="flex gap-1">
            {(['all', 'buy', 'sell'] as DirectionFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setDirFilter(f)}
                className={`rounded px-2.5 py-0.5 text-xs transition-colors ${
                  dirFilter === f
                    ? f === 'buy'
                      ? 'bg-green-600 text-white'
                      : f === 'sell'
                      ? 'bg-red-600 text-white'
                      : 'bg-white/20 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {f === 'all' ? '全部' : f === 'buy' ? '買超' : '賣超'}
              </button>
            ))}
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <div className="rounded-lg bg-white/5 py-8 text-center text-sm text-gray-500">
            今日尚無大單紀錄
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-gray-500">
                  <th className="px-3 py-2 text-left">日期</th>
                  <th className="px-3 py-2 text-left">券商</th>
                  <th className="px-3 py-2 text-center">方向</th>
                  <th className="px-3 py-2 text-right">成交量(張)</th>
                  <th className="px-3 py-2 text-right">均價</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order, i) => (
                  <tr
                    key={`${order.date}-${order.brokerCode}-${order.direction}-${i}`}
                    className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                      order.direction === 'BUY'
                        ? 'border-l-2 border-l-green-500'
                        : 'border-l-2 border-l-red-500'
                    }`}
                  >
                    <td className="px-3 py-2 text-gray-400">{order.date}</td>
                    <td className="px-3 py-2 font-medium text-gray-200">
                      <span className="text-xs text-gray-500 mr-1">
                        {order.brokerCode}
                      </span>
                      {order.brokerName}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <DirectionBadge direction={order.direction} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-gray-100">
                      {order.volume.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-400">
                      {order.price > 0 ? `$${order.price.toFixed(1)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section B: Consecutive Buyers/Sellers ─────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200">
            連續大單追蹤
            <span className="ml-2 text-xs font-normal text-gray-500">
              (連續≥3日)
            </span>
          </h3>

          {/* Sort toggle */}
          <div className="flex gap-1">
            {(['days', 'volume'] as ConsecutiveSortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`rounded px-2.5 py-0.5 text-xs transition-colors ${
                  sortKey === key
                    ? 'bg-white/20 text-white'
                    : 'bg-white/5 text-gray-400 hover:bg-white/10'
                }`}
              >
                {key === 'days' ? '依天數' : '依張數'}
              </button>
            ))}
          </div>
        </div>

        {sortedBuyers.length === 0 ? (
          <div className="rounded-lg bg-white/5 py-8 text-center text-sm text-gray-500">
            近{days}日內無連續大單券商
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sortedBuyers.map((buyer, i) => (
              <div
                key={`${buyer.brokerCode}-${buyer.direction}-${i}`}
                className={`rounded-lg border p-4 transition-colors ${
                  buyer.direction === 'BUY'
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
              >
                {/* Header */}
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-gray-500">{buyer.brokerCode}</p>
                    <p className="text-sm font-semibold text-gray-100 leading-tight">
                      {buyer.brokerName}
                    </p>
                  </div>
                  <StreakBadge
                    direction={buyer.direction}
                    days={buyer.consecutiveDays}
                  />
                </div>

                {/* Stats */}
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-gray-500">合計張數</p>
                    <p className="font-mono font-bold text-gray-100">
                      {buyer.totalVolume.toLocaleString()} 張
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">均價</p>
                    <p className="font-mono font-bold text-gray-100">
                      {buyer.avgPrice > 0
                        ? `$${buyer.avgPrice.toFixed(1)}`
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Data source note ─────────────────────────────────────────────── */}
      <p className="text-xs text-gray-600 text-right">
        資料來源：TWSE TWT38U · 每日收盤後更新 · 大單門檻：≥100張
      </p>
    </div>
  );
}
