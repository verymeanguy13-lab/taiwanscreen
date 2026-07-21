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
import { HealthScore } from '@/components/stock/HealthScore';
import { PTTWidget } from '@/components/stock/PTTWidget';
import WatchlistButton from '@/components/stock/WatchlistButton';
import AdSlot from '@/components/ads/AdSlot';
import { CandlestickChart } from '@/components/kline/CandlestickChart';
import { ScoreCard }        from '@/components/kline/ScoreCard';
import { BullBearPanel }    from '@/components/kline/BullBearPanel';
import { ScoringPanel }     from '@/components/kline/ScoringPanel';
import LargeOrdersTab       from '@/components/stock/LargeOrdersTab';
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

// ── Client component ──────────────────────────────────────────────────────────
export default function StockClient({ initialData }: { initialData?: any }) {
  const { symbol } = useParams<{ symbol: string }>();
  const [activeTab, setActiveTab] = useState('fundamentals');

  const { data: klineData } = useSWR(
    activeTab === 'kline' ? `/api/kline/${symbol}` : null,
    (url: string) => fetch(url).then(r => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }),
    { revalidateOnFocus: false },
  );

  const { data: res, isLoading, error } = useSWR(
    symbol ? `/api/stock/${symbol}` : null,
    fetcher,
    { fallbackData: initialData },
  );

  // Live quote — refreshes every 15 seconds
  const { data: liveQuote } = useSWR(
  symbol ? `/api/quote/${symbol}` : null,
  fetcher,
  { refreshInterval: 30_000 }
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

  const closes  = priceHistory.map(p => p.close).filter(Boolean) as number[];
  const high52w = closes.length ? Math.max(...closes) : null;
  const low52w  = closes.length ? Math.min(...closes) : null;

  // Use live quote if available, fall back to daily_prices
  const displayQuote = liveQuote?.close ? liveQuote : quote;
  const change = formatChange(displayQuote?.change_pct ?? 0);

  // Merge all periods — newest first, first non-null value for each field wins
  // fundamentals arrives newest-first (ORDER BY period DESC). Reduce over a
  // REVERSED copy (oldest → newest) so that when multiple periods have the
  // same field populated, the most recent one overwrites last and wins —
  // otherwise an older quarter silently overwrote newer data for every
  // field here (this previously made eps/roe/margins/etc. randomly stale
  // by however many periods back the field was last populated).
  const fund = [...fundamentals].reverse().reduce((acc, f) => ({
    ...acc,
    ...(f.roe          != null && { roe:          f.roe }),
    ...(f.market_cap   != null && { market_cap:   f.market_cap }),
    ...(f.eps          != null && { eps:          f.eps }),
    ...(f.gross_margin != null && { gross_margin: f.gross_margin }),
    ...(f.net_margin   != null && { net_margin:   f.net_margin }),
    ...(f.debt_ratio   != null && { debt_ratio:   f.debt_ratio }),
    ...(f.pe_ratio     != null && { pe_ratio:     f.pe_ratio }),
    ...(f.pb_ratio     != null && { pb_ratio:     f.pb_ratio }),
    ...(f.revenue      != null && { revenue:      f.revenue }),
    ...(f.net_income   != null && { net_income:   f.net_income }),
  }), {} as Record<string, number>);

  // Compute ROE from available data: eps × pb_ratio / close × 100
  // (ROE = eps/book_value × 100, book_value = price/pb_ratio)
  const computedRoe = (fund?.eps && fund?.pb_ratio && displayQuote?.close && displayQuote.close > 0)
    ? Math.round(fund.eps * fund.pb_ratio / displayQuote.close * 10000) / 100
    : null;
  const displayRoe = fund?.roe ?? computedRoe;

  // Compute market_cap from shares_outstanding × close price (in 億 NTD)
  const computedMarketCap = (info?.shares_outstanding && displayQuote?.close)
    ? displayQuote.close * info.shares_outstanding
    : null;
  const displayMarketCap = fund?.market_cap ?? computedMarketCap;

  const TABS = [
    { label: '基本面',   value: 'fundamentals' },
    { label: '起漲分析', value: 'kline'        },
    { label: '多空趨勢', value: 'bullbear'     },
    { label: '起漲評分', value: 'scoring'      },
    { label: '配息紀錄', value: 'dividends'    },
    { label: '供應鏈',   value: 'supply'       },
    // 大股東 tab temporarily removed — MOPS blocks automated requests for
    // 董監持股/大股東持股 data (confirmed: "因為安全性考量" security wall,
    // not a code bug). Re-add once this is fed by a non-cloud data pipeline
    // instead of a live Vercel-side fetch. See lib/mops.ts for details.
    { label: '大單追蹤', value: 'large-orders' },
  ];

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>

      {/* ── Outer flex: main content + sidebar ad ──────────────────────── */}
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex gap-6 items-start">

        {/* ── LEFT: all stock content ─────────────────────────────────── */}
        <div className="flex flex-1 flex-col gap-5 min-w-0">

          {/* ── HEADER ───────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">

            {/* Row 1: symbol + name + watchlist button */}
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="num text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {info.symbol}
              </span>
              <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {info.name_zh}
              </span>
              <WatchlistButton symbol={symbol} />
            </div>

            {/* Row 2: price + change */}
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="num text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                NT${fmt(displayQuote?.close)}
              </span>
              {displayQuote?.change_amt != null && (
                <span className="num text-lg font-semibold" style={{ color: change.color }}>
                  {(displayQuote.change_amt ?? 0) >= 0 ? '+' : ''}{fmt(displayQuote.change_amt)}&nbsp;
                  ({change.value})
                  {(displayQuote.change_pct ?? 0) > 0 ? '▲' : (displayQuote.change_pct ?? 0) < 0 ? '▼' : ''}
                </span>
              )}
              {liveQuote?.isLive && liveQuote?.time && (
  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
    即時 {liveQuote.time}
  </span>
)}
            </div>

            {/* Row 3: stats */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <span>成交量：<span className="num">{displayQuote?.volume?.toLocaleString('en-US') ?? '—'}</span> 張</span>
              <span>52週高：<span className="num" style={{ color: 'var(--accent-red)' }}>{high52w ? fmt(high52w) : '—'}</span></span>
              <span>52週低：<span className="num" style={{ color: 'var(--accent-green)' }}>{low52w ? fmt(low52w) : '—'}</span></span>
              <span>市值：<span className="num">{displayMarketCap ? formatNTD(displayMarketCap) : '—'}</span></span>
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

          {/* ── HEALTH SCORE ─────────────────────────────────────────── */}
          <HealthScore symbol={symbol} />

          
          {/* ── PRICE CHART ──────────────────────────────────────────── */}
<PriceChart data={priceHistory as any} />

{/* ── CHIP FLOW ────────────────────────────────────────────── */}
{/* Removed — Fugle's intraday/trades endpoint only returns roughly the
    most recent minute of trades, not a full session's worth (confirmed via
    server logs: 37 minutes into a live session, only 1 minute-bucket of
    data came back). No amount of classification-method tuning can fix a
    feature built on a data source that can't supply the history it needs.
    Underlying code (lib/chipFlow.ts, /api/chip-flow, ChipFlowPanel.tsx) is
    left in place in case a full-session tick source becomes available. */}

          {/* ── KEY METRICS ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="本益比"     value={fmt(fund?.pe_ratio, 1)} />
            <Metric label="股價淨值比" value={fmt(fund?.pb_ratio, 2)} />
            <Metric label="殖利率"     value={dividendSummary?.latest_yield_pct != null ? `${fmt(dividendSummary.latest_yield_pct)}%` : '—'} />
            <Metric label="ROE"        value={displayRoe != null ? `${fmt(displayRoe, 1)}%` : '—'} />
            <Metric label="EPS"        value={fund?.eps != null ? `NT$${fmt(fund.eps)}` : '—'} />
            <Metric label="毛利率"     value={fund?.gross_margin != null ? `${fmt(fund.gross_margin, 1)}%` : '—'} />
            <Metric label="負債比"     value={fund?.debt_ratio != null ? `${fmt(fund.debt_ratio, 1)}%` : '—'} />
            <Metric label="市值"       value={displayMarketCap ? formatNTD(displayMarketCap) : '—'} />
          </div>

          {/* ── PTT WIDGET ───────────────────────────────────────────── */}
          <PTTWidget symbol={symbol} name_zh={info.name_zh} />

          {/* ── TABS ─────────────────────────────────────────────────── */}
          <Card className="p-0">
            <div className="px-4 pt-4">
              <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
            </div>

            <div className="px-4 py-4">

              {activeTab === 'fundamentals' && (
                <div className="flex flex-col gap-6">
                  <RevenueChart
                    data={fundamentals.slice(0, 8).reverse().map(f => ({
                      period:     f.period,
                      revenue:    f.revenue ?? 0,
                     // Only show growth_yoy when real quarterly revenue is
                      // also available for this period. TWSE's fast monthly
                      // revenue feed can populate revenue_growth_yoy for a
                      // quarter weeks before the official quarterly revenue
                      // figure is filed — without this guard, the chart
                      // shows a "floating" growth spike with no revenue bar
                      // underneath it, since the two come from different,
                      // differently-timed data sources sharing one period key.
                      growth_yoy: f.revenue != null ? (f.revenue_growth_yoy ?? null) : null,
                    }))}
                  />
                  <EPSChart
                    data={fundamentals.slice(0, 8).reverse().map(f => ({
                      period: f.period,
                      eps:    f.eps ?? 0,
                    }))}
                  />
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
                            <td className="num py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>{f.period}</td>
                            <td className="num py-2 pr-4" style={{ color: marginColor(f.gross_margin) }}>
                              {f.gross_margin != null ? `${fmt(f.gross_margin, 1)}%` : '—'}
                            </td>
                            <td className="num py-2 pr-4" style={{ color: marginColor(f.operating_margin) }}>
                              {f.operating_margin != null ? `${fmt(f.operating_margin, 1)}%` : '—'}
                            </td>
                            <td className="num py-2" style={{ color: marginColor(f.net_margin) }}>
                              {f.net_margin != null ? `${fmt(f.net_margin, 1)}%` : '—'}
                            </td>
                          </tr>
                        ))}
                        {fundamentals.length === 0 && (
                          <tr><td colSpan={4} className="py-6 text-center" style={{ color: 'var(--text-muted)' }}>暫無資料</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

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
                        <tr key={`${d.year}-${d.period}`} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td className="num py-2 pr-4" style={{ color: 'var(--text-secondary)' }}>{d.year} {d.period}</td>
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
                        <tr><td colSpan={5} className="py-6 text-center" style={{ color: 'var(--text-muted)' }}>暫無配息紀錄</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'supply' && (
                <div className="flex flex-col gap-5">
                  {supplyChain.as_parent.length === 0 && supplyChain.as_child.length === 0 && (
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      供應鏈圖目前僅涵蓋台積電、蘋果、輝達等生態系（約 39 檔相關個股），此股票尚未收錄在內。
                    </p>
                  )}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
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
                              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                            >
                              <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{sc.child_symbol}</span>
                              <span>{(sc as any).name_zh}</span>
                              <Badge variant="grey">{(sc as any).sector ?? sc.category}</Badge>
                            </Link>
                          ))}
                        </div>
                      )
                    }
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
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
                              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                            >
                              <span className="num font-semibold" style={{ color: 'var(--accent-blue)' }}>{sc.parent_symbol}</span>
                              <span>{(sc as any).name_zh}</span>
                              <Badge variant="grey">{(sc as any).sector ?? sc.category}</Badge>
                            </Link>
                          ))}
                        </div>
                      )
                    }
                  </div>
                  <Link href="/supply-chain" className="self-start text-xs transition-colors duration-100" style={{ color: 'var(--accent-blue)' }}>
                    查看完整供應鏈圖 →
                  </Link>
                </div>
              )}

              {activeTab === 'kline' && (
                <div style={{ paddingTop: 8 }}>
                  <CandlestickChart symbol={symbol} />
                  {klineData?.score && (
                    <ScoreCard score={klineData.score} />
                  )}
                </div>
              )}

              {activeTab === 'bullbear' && (
                <div style={{ paddingTop: 8 }}>
                  <BullBearPanel symbol={symbol} />
                </div>
              )}

              {activeTab === 'scoring' && (
                <div style={{ paddingTop: 8 }}>
                  <ScoringPanel symbol={symbol} />
                </div>
              )}

              {activeTab === 'large-orders' && (
                <LargeOrdersTab symbol={symbol} />
              )}

            </div>
          </Card>
        </div>

        {/* ── RIGHT: sidebar ad — desktop only ────────────────────────── */}
        <div className="hidden lg:block flex-shrink-0 sticky top-6">
          <AdSlot size="rectangle" slotId="stock-sidebar" />
        </div>

      </div>
    </div>
  );
}