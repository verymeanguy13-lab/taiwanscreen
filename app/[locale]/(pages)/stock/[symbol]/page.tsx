'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { PriceChart } from '@/components/charts/PriceChart';
import { RevenueChart } from '@/components/charts/RevenueChart';
import { EPSChart } from '@/components/charts/EPSChart';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange, formatNTD } from '@/lib/utils';
import type { StockDetailPayload } from '@/types';
import { ShareholdersTab } from '@/components/ShareholdersTab';
import { HealthScore } from '@/components/stock/HealthScore';

const fetcher = (url: string) =>
  fetch(url).then(r => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

// ── Metric card ───────────────────────────────────────────────────────────────
function Metric({ label, value }: { label: string; value: string | React.ReactNode }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg p-3"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="num text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function fmt(v: number | undefined | null, decimals = 2) {
  if (v == null) return '—';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function marginColor(v: number | undefined | null): string {
  if (v == null) return 'var(--text-secondary)';
  if (v > 30)   return 'var(--accent-green)';
  if (v > 15)   return 'var(--accent-gold)';
  return 'var(--accent-red)';
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function StockPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const [activeTab, setActiveTab] = useState('fundamentals');

  const { data: res, isLoading, error } = useSWR(
    symbol ? `/api/stock/${symbol}` : null,
    fetcher,
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      </div>
    );
  }

  // ── 404 ────────────────────────────────────────────────────────────────────
  if (error?.message === '404' || (!isLoading && !res?.data)) {
    return (
      <div className="flex h-64 items-center justify-center text-sm"
        style={{ color: 'var(--text-muted)' }}>
        找不到股票資料：{symbol}
      </div>
    );
  }

  const payload = res?.data as StockDetailPayload;
  const { info, quote, fundamentals, priceHistory, dividendHistory, dividendSummary, supplyChain } = payload;

  // Compute 52-week high/low from price history
  const closes  = priceHistory.map(p => p.close).filter(Boolean) as number[];
  const high52w = closes.length ? Math.max(...closes) : null;
  const low52w  = closes.length ? Math.min(...closes) : null;

  const change = formatChange(quote?.change_pct ?? 0);
  const fund   = fundamentals[0]; // latest period

  const TABS = [
    { label: '基本面',   value: 'fundamentals' },
    { label: '配息紀錄', value: 'dividends'    },
    { label: '供應鏈',   value: 'supply'       },
    { label: '大股東',   value: 'shareholders' },
  ];

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-5">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          {/* Row 1: symbol + name */}
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="num text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {info.symbol}
            </span>
            <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {info.name_zh}
            </span>
          </div>

          {/* Row 2: price + change */}
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="num text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              NT${fmt(quote?.close)}
            </span>
            {quote?.change_amt != null && (
              <span className="num text-lg font-semibold" style={{ color: change.color }}>
                {(quote.change_amt ?? 0) >= 0 ? '+' : ''}{fmt(quote.change_amt)}&nbsp;
                ({change.value})
                {(quote.change_pct ?? 0) > 0 ? '▲' : (quote.change_pct ?? 0) < 0 ? '▼' : ''}
              </span>
            )}
          </div>

          {/* Row 3: stats */}
          <div
            className="flex flex-wrap gap-x-4 gap-y-1 text-xs"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span>成交量：<span className="num">{quote?.volume?.toLocaleString('en-US') ?? '—'}</span> 張</span>
            <span>52週高：<span className="num" style={{ color: 'var(--accent-green)' }}>{high52w ? fmt(high52w) : '—'}</span></span>
            <span>52週低：<span className="num" style={{ color: 'var(--accent-red)' }}>{low52w ? fmt(low52w) : '—'}</span></span>
            <span>市值：<span className="num">{fund?.market_cap ? formatNTD(fund.market_cap) : '—'}</span></span>
          </div>

          {/* Row 4: badges + compare link */}
          <div className="flex flex-wrap items-center gap-2">
            {info.sector && <Badge variant="blue">{info.sector}</Badge>}
            <Badge variant={info.market === 'TWSE' ? 'green' : 'gold'}>{info.market}</Badge>
            <Link
              href={`/compare?symbols=${symbol}`}
              className="rounded-full px-3 py-0.5 text-xs font-medium transition-colors duration-150"
              style={{
                backgroundColor: 'rgba(0,212,170,0.08)',
                color: 'var(--accent-green)',
                border: '1px solid rgba(0,212,170,0.3)',
              }}
            >
              + 加入比較
            </Link>
          </div>
        </div>

        {/* ── HEALTH SCORE ───────────────────────────────────────────────── */}
        <HealthScore symbol={symbol} />

        {/* ── PRICE CHART ────────────────────────────────────────────────── */}
        <PriceChart data={priceHistory as any} />

        {/* ── KEY METRICS ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="本益比"    value={fmt(fund?.pe_ratio, 1)} />
          <Metric label="股價淨值比" value={fmt(fund?.pb_ratio, 2)} />
          <Metric label="殖利率"    value={dividendSummary?.latest_yield_pct != null ? `${fmt(dividendSummary.latest_yield_pct)}%` : '—'} />
          <Metric label="ROE"       value={fund?.roe != null ? `${fmt(fund.roe, 1)}%` : '—'} />
          <Metric label="EPS"       value={fund?.eps != null ? `NT$${fmt(fund.eps)}` : '—'} />
          <Metric label="毛利率"    value={fund?.gross_margin != null ? `${fmt(fund.gross_margin, 1)}%` : '—'} />
          <Metric label="負債比"    value={fund?.debt_ratio != null ? `${fmt(fund.debt_ratio, 1)}%` : '—'} />
          <Metric label="市值"      value={fund?.market_cap ? formatNTD(fund.market_cap) : '—'} />
        </div>

        {/* ── TABS ───────────────────────────────────────────────────────── */}
        <Card className="p-0">
          <div className="px-4 pt-4">
            <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
          </div>

          <div className="px-4 py-4">

            {/* ── 基本面 ──────────────────────────────────────────────── */}
            {activeTab === 'fundamentals' && (
              <div className="flex flex-col gap-6">

                {/* Revenue Chart */}
                <RevenueChart
                  data={fundamentals.slice(0, 8).reverse().map(f => ({
                    period:     f.period,
                    revenue:    f.revenue ?? 0,
                    growth_yoy: f.revenue_growth_yoy ?? 0,
                  }))}
                />

                {/* EPS Chart */}
                <EPSChart
                  data={fundamentals.slice(0, 8).reverse().map(f => ({
                    period: f.period,
                    eps:    f.eps ?? 0,
                  }))}
                />

                {/* Margins Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: 400 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['期間', '毛利率', '營業利益率', '淨利率'].map(h => (
                          <th key={h} className="pb-2 text-left font-semibold"
                            style={{ color: 'var(--text-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fundamentals.slice(0, 8).map(f => (
                        <tr key={f.period} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="num py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>
                            {f.period}
                          </td>
                          <td className="num py-2 pr-4" style={{ color: marginColor(f.gross_margin) }}>
                            {f.gross_margin != null ? `${fmt(f.gross_margin, 1)}%` : '—'}
                          </td>
                          <td className="num py-2 pr-4" style={{ color: marginColor((f as any).operating_margin) }}>
                            {(f as any).operating_margin != null ? `${fmt((f as any).operating_margin, 1)}%` : '—'}
                          </td>
                          <td className="num py-2" style={{ color: marginColor(f.net_margin) }}>
                            {f.net_margin != null ? `${fmt(f.net_margin, 1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                      {fundamentals.length === 0 && (
                        <tr><td colSpan={4} className="py-6 text-center"
                          style={{ color: 'var(--text-muted)' }}>暫無資料</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── 配息紀錄 ─────────────────────────────────────────────── */}
            {activeTab === 'dividends' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs" style={{ minWidth: 420 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['年度', '現金股利', '股票股利', '殖利率', '除息日'].map(h => (
                        <th key={h} className="pb-2 text-left font-semibold"
                          style={{ color: 'var(--text-muted)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dividendHistory.map(d => (
                      <tr key={`${d.year}-${d.period}`}
                        style={{ borderBottom: '1px solid var(--border)' }}>
                        <td className="num py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>
                          {d.year} {d.period}
                        </td>
                        <td className="num py-2 pr-4" style={{ color: 'var(--accent-gold)' }}>
                          {d.cash_dividend != null ? `NT$${fmt(d.cash_dividend, 4)}` : '—'}
                        </td>
                        <td className="num py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>
                          {d.stock_dividend != null ? `${fmt(d.stock_dividend, 4)}` : '—'}
                        </td>
                        <td className="num py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>
                          {d.yield_pct != null ? `${fmt(d.yield_pct)}%` : '—'}
                        </td>
                        <td className="num py-2" style={{ color: 'var(--text-muted)' }}>
                          {d.ex_dividend_date ?? '—'}
                        </td>
                      </tr>
                    ))}
                    {dividendHistory.length === 0 && (
                      <tr><td colSpan={5} className="py-6 text-center"
                        style={{ color: 'var(--text-muted)' }}>暫無配息紀錄</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── 供應鏈 ───────────────────────────────────────────────── */}
            {activeTab === 'supply' && (
              <div className="flex flex-col gap-5">
                {/* As supplier */}
                <div>
                  <h3 className="mb-3 text-sm font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>
                    作為供應商（供貨給）
                  </h3>
                  {supplyChain.as_parent.length === 0
                    ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>無資料</p>
                    : (
                      <div className="flex flex-wrap gap-2">
                        {supplyChain.as_parent.map(sc => (
                          <Link
                            key={`${sc.child_symbol}-${sc.ecosystem}`}
                            href={`/stock/${sc.child_symbol}`}
                            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors duration-100"
                            style={{
                              backgroundColor: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>
                              {sc.child_symbol}
                            </span>
                            <span>{(sc as any).name_zh}</span>
                            <Badge variant="grey">{(sc as any).sector ?? sc.category}</Badge>
                          </Link>
                        ))}
                      </div>
                    )
                  }
                </div>

                {/* As customer */}
                <div>
                  <h3 className="mb-3 text-sm font-semibold"
                    style={{ color: 'var(--text-secondary)' }}>
                    作為客戶（採購自）
                  </h3>
                  {supplyChain.as_child.length === 0
                    ? <p className="text-xs" style={{ color: 'var(--text-muted)' }}>無資料</p>
                    : (
                      <div className="flex flex-wrap gap-2">
                        {supplyChain.as_child.map(sc => (
                          <Link
                            key={`${sc.parent_symbol}-${sc.ecosystem}`}
                            href={`/stock/${sc.parent_symbol}`}
                            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors duration-100"
                            style={{
                              backgroundColor: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>
                              {sc.parent_symbol}
                            </span>
                            <span>{(sc as any).name_zh}</span>
                            <Badge variant="grey">{(sc as any).sector ?? sc.category}</Badge>
                          </Link>
                        ))}
                      </div>
                    )
                  }
                </div>

                {/* Link to full supply chain page */}
                <Link
                  href="/supply-chain"
                  className="self-start text-xs transition-colors duration-100"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  查看完整供應鏈圖 →
                </Link>
              </div>
            )}

            {/* ── 大股東 ───────────────────────────────────────────────── */}
            {activeTab === 'shareholders' && (
              <ShareholdersTab symbol={symbol} />
            )}

          </div>
        </Card>
      </div>
    </div>
  );
}
