'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { StockSignalCard } from './StockSignalCard';
import type { ScanResult } from './IntradayScanner';

const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';
const BORDER     = '#1E2235';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const BULL_STRATEGY_FILTERS = [
  '昨日強勢股', '近五日強勢股', '近十日強勢股',
  '開布林', '突破均線', '突破壓力', '剛轉多', '突破趨勢線',
];

const BEAR_STRATEGY_FILTERS = [
  '昨日弱勢股', '近五日弱勢股', '近十日弱勢股',
  '跌破布林', '跌破均線', '空頭排列', '剛轉空', '綠柱放大',
];

const WORKFLOW_STEPS = [
  { step: 1, text: '盤後技術面篩選出符合條件的個股' },
  { step: 2, text: '明日 09:00 開盤，觀察是否出現盤中訊號' },
  { step: 3, text: '09:00–09:20 確認量能與突破位階' },
  { step: 4, text: '本清單僅供技術面觀察，不構成買賣建議' },
];

function WorkflowGuide({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      border: `1px solid ${BORDER}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '10px 16px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#0F1117', cursor: 'pointer', border: 'none',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
          盤後操作流程 — 共 {count} 檔符合條件
        </span>
        <span style={{ fontSize: 12, color: '#8B8FA8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ background: '#08090E', padding: '12px 16px' }}>
          {WORKFLOW_STEPS.map(({ step, text }) => (
            <div key={step} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8,
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                background: '#1E2235', color: DOWN_COLOR,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
              }}>
                {step}
              </span>
              <span style={{ fontSize: 12, color: '#8B8FA8', lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChips({
  filters, active, onSelect, color,
}: {
  filters: string[];
  active: string | null;
  onSelect: (f: string | null) => void;
  color: string;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
      <button
        onClick={() => onSelect(null)}
        style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          border: `1px solid ${active === null ? color : BORDER}`,
          background: active === null ? `${color}22` : 'transparent',
          color: active === null ? color : '#8B8FA8',
        }}
      >
        全部
      </button>
      {filters.map(f => (
        <button
          key={f}
          onClick={() => onSelect(active === f ? null : f)}
          style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${active === f ? color : BORDER}`,
            background: active === f ? `${color}22` : 'transparent',
            color: active === f ? color : '#8B8FA8',
          }}
        >
          {f}
        </button>
      ))}
    </div>
  );
}

export function AfterHoursScreener() {
  const { data, isLoading, error } = useSWR('/api/kline/scanner', fetcher, {
    revalidateOnFocus: false,
  });

  const [activeTab,   setActiveTab]   = useState<'bull' | 'bear'>('bull');
  const [bullFilter,  setBullFilter]  = useState<string | null>(null);
  const [bearFilter,  setBearFilter]  = useState<string | null>(null);

  const bullResults: ScanResult[] = (data?.bull ?? []).sort(
    (a: ScanResult, b: ScanResult) => b.trendStrength.bullScore - a.trendStrength.bullScore,
  );
  const bearResults: ScanResult[] = (data?.bear ?? []).sort(
    (a: ScanResult, b: ScanResult) => b.trendStrength.bearScore - a.trendStrength.bearScore,
  );

  const filteredBull = bullFilter
    ? bullResults.filter((r: ScanResult) =>
        r.signals.some(s => s.type === bullFilter) ||
        r.yesterdayTrend === bullFilter
      )
    : bullResults;

  const filteredBear = bearFilter
    ? bearResults.filter((r: ScanResult) =>
        r.signals.some(s => s.type === bearFilter) ||
        r.yesterdayTrend === bearFilter
      )
    : bearResults;

  if (isLoading) {
    return (
      <div style={{
        height: 200, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#8B8FA8', fontSize: 13,
        background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`,
      }}>
        載入盤後資料中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        height: 200, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: UP_COLOR, fontSize: 13,
        background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`,
      }}>
        無法載入盤後資料
      </div>
    );
  }

  const totalCount = bullResults.length + bearResults.length;

  return (
    <div style={{ background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
      {/* Workflow guide */}
      <div style={{ padding: 16, borderBottom: `1px solid ${BORDER}` }}>
        <WorkflowGuide count={totalCount} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
        {(['bull', 'bear'] as const).map(tab => {
          const color = tab === 'bull' ? UP_COLOR : DOWN_COLOR;
          const count = tab === 'bull' ? bullResults.length : bearResults.length;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 600,
                color: activeTab === tab ? color : '#8B8FA8',
                borderBottom: activeTab === tab
                  ? `2px solid ${color}` : '2px solid transparent',
                background: 'transparent', cursor: 'pointer',
              }}
            >
              {tab === 'bull' ? '多方候選' : '空方候選'}
              <span style={{
                marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 10,
                color, background: `${color}22`, border: `1px solid ${color}44`,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ padding: 16 }}>
        {activeTab === 'bull' ? (
          <>
            <FilterChips
              filters={BULL_STRATEGY_FILTERS}
              active={bullFilter}
              onSelect={setBullFilter}
              color={UP_COLOR}
            />
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {filteredBull.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>
                  暫無多方候選股
                </div>
              ) : (
                filteredBull.map((r: ScanResult) => (
                  <StockSignalCard key={r.symbol} result={r} mode="afterhours" side="bull" />
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <FilterChips
              filters={BEAR_STRATEGY_FILTERS}
              active={bearFilter}
              onSelect={setBearFilter}
              color={DOWN_COLOR}
            />
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {filteredBear.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>
                  暫無空方候選股
                </div>
              ) : (
                filteredBear.map((r: ScanResult) => (
                  <StockSignalCard key={r.symbol} result={r} mode="afterhours" side="bear" />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
