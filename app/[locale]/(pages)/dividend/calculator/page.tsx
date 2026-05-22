'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNTD(n: number): string {
  return `NT$${Math.round(n).toLocaleString('en-US')}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DividendCalculatorPage() {
  const [investment, setInvestment] = useState('1000000'); // NT$1,000,000
  const [yieldPct,   setYieldPct]   = useState('5.0');     // 5.0%
  const [stockPrice, setStockPrice] = useState('');        // optional: price per share
  const [parValue,   setParValue]   = useState('10');      // par value per share (NT$10 default)

  const inv   = parseFloat(investment.replace(/,/g, '')) || 0;
  const yld   = parseFloat(yieldPct) || 0;
  const price = parseFloat(stockPrice) || 0;
  const par   = parseFloat(parValue) || 10;

  const results = useMemo(() => {
    const annualIncome  = inv * (yld / 100);
    const monthlyIncome = annualIncome / 12;
    // 1 張 = 1000 shares; lots needed based on investment amount and price
    const lotsNeeded    = price > 0 ? inv / (price * 1000) : null;
    // Dividend per share = yield% × price (if price given), else yield% × par
    const dividendPerShare = price > 0 ? price * (yld / 100) : par * (yld / 100);
    const dividendPerLot   = dividendPerShare * 1000;

    return { annualIncome, monthlyIncome, lotsNeeded, dividendPerLot };
  }, [inv, yld, price, par]);

  // Format investment input with commas as user types
  const handleInvestmentChange = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    setInvestment(digits);
  };

  const displayInvestment = investment
    ? parseInt(investment || '0', 10).toLocaleString('en-US')
    : '';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-xl px-4 py-6 flex flex-col gap-5">

        {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
        <nav className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Link href="/dividend" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>殖利率篩選</Link>
          <span>›</span>
          <span style={{ color: 'var(--text-primary)' }}>存股計算機</span>
        </nav>

        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            存股計算機
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            輸入投入金額與目標殖利率，試算股利收入
          </p>
        </div>

        {/* ── Inputs ─────────────────────────────────────────────────────── */}
        <Card>
          <div className="flex flex-col gap-4">
            {/* Investment amount */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                投入金額
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>NT$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={displayInvestment}
                  onChange={e => handleInvestmentChange(e.target.value)}
                  placeholder="1,000,000"
                  className="flex-1 rounded-lg px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              {/* Quick amount buttons */}
              <div className="flex flex-wrap gap-1.5 mt-1">
                {[100000, 500000, 1000000, 3000000, 5000000].map(amt => (
                  <button key={amt} onClick={() => setInvestment(String(amt))}
                    className="rounded-full px-2.5 py-1 text-xs transition-colors"
                    style={{
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-secondary)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                    {amt >= 1000000 ? `${amt / 1000000}百萬` : `${amt / 10000}萬`}
                  </button>
                ))}
              </div>
            </div>

            {/* Target yield */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                目標殖利率
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="30"
                  value={yieldPct}
                  onChange={e => setYieldPct(e.target.value)}
                  className="w-24 rounded-lg px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>%</span>
              </div>
              {/* Quick yield buttons */}
              <div className="flex flex-wrap gap-1.5 mt-1">
                {['3.0', '4.0', '5.0', '6.0', '8.0'].map(y => (
                  <button key={y} onClick={() => setYieldPct(y)}
                    className="rounded-full px-2.5 py-1 text-xs transition-colors"
                    style={{
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-secondary)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}>
                    {y}%
                  </button>
                ))}
              </div>
            </div>

            {/* Optional: stock price for lot calculation */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                股票現價（選填，用於計算張數）
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>NT$</span>
                <input
                  type="number"
                  value={stockPrice}
                  onChange={e => setStockPrice(e.target.value)}
                  placeholder="例：50.5"
                  className="w-36 rounded-lg px-3 py-2 text-sm"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* ── Results ────────────────────────────────────────────────────── */}
        <Card>
          <h2 className="mb-4 text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
            試算結果
          </h2>
          <div className="flex flex-col gap-4">

            {/* Annual income */}
            <div className="flex flex-col gap-0.5">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>預計年領股利</span>
              <span className="num text-3xl font-bold" style={{ color: 'var(--accent-gold)' }}>
                {fmtNTD(results.annualIncome)}
              </span>
            </div>

            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Monthly income */}
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>每月平均領息</span>
              <span className="num text-xl font-bold" style={{ color: 'var(--accent-green)' }}>
                {fmtNTD(results.monthlyIncome)}
              </span>
            </div>

            {/* Lots needed */}
            {results.lotsNeeded !== null && (
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>需購買張數</span>
                <span className="num text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {results.lotsNeeded.toFixed(1)} 張
                </span>
              </div>
            )}

            {/* Dividend per lot */}
            {price > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>每張股利約</span>
                <span className="num text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {fmtNTD(results.dividendPerLot)}
                </span>
              </div>
            )}
          </div>

          {/* Assumptions note */}
          <div className="mt-5 rounded-lg px-3 py-2.5 text-xs"
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
            📌 試算假設：殖利率固定、不計股價波動及稅負（二代健保補充保費 2.11%）。實際配息依各公司政策而定，僅供參考。
          </div>
        </Card>

        {/* ── Back link ──────────────────────────────────────────────────── */}
        <Link href="/dividend" className="text-xs text-center"
          style={{ color: 'var(--text-muted)' }}>
          ← 回到殖利率篩選
        </Link>
      </div>
    </div>
  );
}
