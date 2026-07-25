'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Card }    from '@/components/ui/Card';
import { Button }  from '@/components/ui/Button';
import { Badge }   from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ScreenerFilter } from '@/types';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────
interface Preset {
  id:          string;
  name_zh:     string;
  description: string;
  filters:     ScreenerFilter;
}

interface BacktestResult {
  period:       string;
  startDate:    string;
  sample_count: number;
  win_rate:     number;
  avg_return:   number;
  top5: { symbol: string; name_zh: string; return_pct: number }[];
  bottom5: { symbol: string; name_zh: string; return_pct: number }[];
}

// ── Period buttons ────────────────────────────────────────────────────────────
type Period = '1M' | '3M' | '6M' | '1Y';
const PERIODS: { label: string; value: Period }[] = [
  { label: '1月', value: '1M' },
  { label: '3月', value: '3M' },
  { label: '6月', value: '6M' },
  { label: '1年', value: '1Y' },
];

function PeriodPicker({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  return (
    <div className="flex gap-1">
      {PERIODS.map(p => (
        <button key={p.value} onClick={() => onChange(p.value)}
          className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
          style={{
            backgroundColor: value === p.value ? 'var(--accent-green)' : 'transparent',
            color: value === p.value ? 'var(--bg-primary)' : 'var(--text-secondary)',
            border: `1px solid ${value === p.value ? 'var(--accent-green)' : 'var(--border)'}`,
          }}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ result }: { result: BacktestResult }) {
  const winColor = result.avg_return >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
  return (
    <div className="mt-2 rounded-lg px-4 py-3 text-xs flex flex-col gap-2"
      style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap gap-4">
        <span style={{ color: 'var(--text-secondary)' }}>
          勝率：<span className="num font-bold" style={{ color: result.win_rate >= 50 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
            {result.win_rate}%
          </span>
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          平均報酬：<span className="num font-bold" style={{ color: winColor }}>
            {result.avg_return >= 0 ? '+' : ''}{result.avg_return.toFixed(2)}%
          </span>
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>
          樣本：<span className="num font-bold" style={{ color: 'var(--text-primary)' }}>
            {result.sample_count} 檔
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          回測起點：{result.startDate}
        </span>
      </div>
      {result.top5.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span style={{ color: 'var(--text-muted)' }}>前3名：</span>
          {result.top5.slice(0, 3).map(r => (
            <span key={r.symbol}
              className="num inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: 'rgba(0,212,170,0.1)', color: 'var(--accent-green)', border: '1px solid rgba(0,212,170,0.25)' }}>
              {r.symbol} +{r.return_pct.toFixed(1)}%
            </span>
          ))}
        </div>
      )}
      {result.bottom5.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span style={{ color: 'var(--text-muted)' }}>後3名：</span>
          {result.bottom5.slice(0, 3).map(r => (
            <span key={r.symbol}
              className="num inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
              style={{ backgroundColor: 'rgba(255,77,109,0.08)', color: 'var(--accent-red)', border: '1px solid rgba(255,77,109,0.2)' }}>
              {r.symbol} {r.return_pct.toFixed(1)}%
            </span>
          ))}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
        以上為歷史回測結果，不代表未來績效，不構成投資建議。
      </div>
    </div>
  );
}

// ── Number input ──────────────────────────────────────────────────────────────
function NumInput({ label, value, onChange, placeholder }: {
  label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-24 rounded px-2 py-1.5 text-sm"
        style={{
          backgroundColor: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function BacktestPage() {
  // Presets
  const { data: presetsRes } = useSWR('/api/backtest', fetcher);
  const presets: Preset[] = presetsRes?.data ?? [];

  // Per-preset state: period + result
  const [presetPeriods,  setPresetPeriods]  = useState<Record<string, Period>>({});
  const [presetResults,  setPresetResults]  = useState<Record<string, BacktestResult | null>>({});
  const [presetLoading,  setPresetLoading]  = useState<Record<string, boolean>>({});

  // Custom form
  const [peMax,       setPeMax]       = useState('');
  const [roeMin,      setRoeMin]      = useState('');
  const [yieldMin,    setYieldMin]    = useState('');
  const [consecMin,   setConsecMin]   = useState('');
  const [customPeriod, setCustomPeriod] = useState<Period>('3M');
  const [customResult, setCustomResult] = useState<BacktestResult | null>(null);
  const [customLoading, setCustomLoading] = useState(false);

  // Run preset backtest
  const runPreset = async (preset: Preset) => {
    const period = presetPeriods[preset.id] ?? '3M';
    setPresetLoading(prev => ({ ...prev, [preset.id]: true }));
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: preset.filters, period }),
      });
      const json = await res.json();
      setPresetResults(prev => ({ ...prev, [preset.id]: json.data }));
    } catch {
      setPresetResults(prev => ({ ...prev, [preset.id]: null }));
    } finally {
      setPresetLoading(prev => ({ ...prev, [preset.id]: false }));
    }
  };

  // Run custom backtest
  const runCustom = async () => {
    const filters: ScreenerFilter = {};
    if (peMax)     filters.pe_max                 = parseFloat(peMax);
    if (roeMin)    filters.roe_min                = parseFloat(roeMin);
    if (yieldMin)  filters.yield_min              = parseFloat(yieldMin);
    if (consecMin) filters.foreign_consecutive_min = parseInt(consecMin, 10);

    setCustomLoading(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, period: customPeriod }),
      });
      const json = await res.json();
      setCustomResult(json.data);
    } catch {
      setCustomResult(null);
    } finally {
      setCustomLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-xl px-4 py-6 flex flex-col gap-8">

        {/* ── Title ──────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            策略回測
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            測試選股條件在過去一段時間的表現
          </p>
        </div>

        {/* ══ SECTION 1 — PRESET LEADERBOARD ══════════════════════════════ */}
        <Card>
          <h2 className="mb-4 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            📊 預設策略回測
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['策略名稱', '篩選條件', '回測期間', '操作'].map(h => (
                    <th key={h} className="pb-2 text-left font-semibold px-2"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {presets.length === 0 && (
                  <tr><td colSpan={4}><Skeleton className="h-48 w-full mt-2" /></td></tr>
                )}
                {presets.map(preset => {
                  const period  = presetPeriods[preset.id]  ?? '3M';
                  const result  = presetResults[preset.id]  ?? null;
                  const loading = presetLoading[preset.id]  ?? false;
                  return (
                    <>
                      <tr key={preset.id}
                        style={{ borderBottom: result ? 'none' : '1px solid var(--border)' }}>
                        <td className="px-2 py-2.5 font-semibold" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          {preset.name_zh}
                        </td>
                        <td className="px-2 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                          {preset.description}
                        </td>
                        <td className="px-2 py-2.5">
                          <PeriodPicker value={period}
                            onChange={v => setPresetPeriods(prev => ({ ...prev, [preset.id]: v }))} />
                        </td>
                        <td className="px-2 py-2.5">
                          <Button variant="outline" size="sm"
                            disabled={loading}
                            onClick={() => runPreset(preset)}>
                            {loading ? '回測中…' : '回測'}
                          </Button>
                        </td>
                      </tr>
                      {result && (
                        <tr key={`${preset.id}-result`}
                          style={{ borderBottom: '1px solid var(--border)' }}>
                          <td colSpan={4} className="px-2 pb-3">
                            <ResultCard result={result} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ══ SECTION 2 — CUSTOM BACKTEST ══════════════════════════════════ */}
        <Card>
          <h2 className="mb-4 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            🔧 自訂策略回測
          </h2>
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <NumInput label="本益比上限"       value={peMax}     onChange={setPeMax}     placeholder="例：20" />
            <NumInput label="ROE 下限 (%)"     value={roeMin}    onChange={setRoeMin}    placeholder="例：15" />
            <NumInput label="殖利率下限 (%)"   value={yieldMin}  onChange={setYieldMin}  placeholder="例：4"  />
            <NumInput label="外資連買天數下限"  value={consecMin} onChange={setConsecMin} placeholder="例：3"  />
            <div className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>回測期間</span>
              <PeriodPicker value={customPeriod} onChange={setCustomPeriod} />
            </div>
            <Button variant="primary" size="md"
              disabled={customLoading}
              onClick={runCustom}>
              {customLoading ? '回測中…' : '開始回測'}
            </Button>
          </div>

          {customResult && <ResultCard result={customResult} />}

          {!customResult && !customLoading && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
              設定篩選條件後點擊「開始回測」
            </p>
          )}
          {customLoading && <Skeleton className="h-20 w-full mt-2" />}
        </Card>

        {/* ── Disclaimer ─────────────────────────────────────────────────── */}
        <div className="rounded-lg px-4 py-3 text-xs text-center"
          style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          ⚠️ 回測結果僅供參考，不代表未來績效。歷史績效不保證未來收益。投資有風險，請謹慎評估個人財務狀況。
        </div>
      </div>
    </div>
  );
}
