'use client';

import { useState } from 'react';
import type { ScanState } from './IntradayScanner';
import { StockSignalCard } from './StockSignalCard';
import type { BullSignalType, BearSignalType } from '@/lib/bullbearSignals';

interface Props {
  scanState: ScanState;
}

const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';
const BORDER     = '#1E2235';

const BULL_FILTERS: BullSignalType[] = [
  '突破昨高', '突破5日高', '突破10日高', '站上5MA', '站上20MA',
  '攻擊K', '紅三兵', '漲幅超過3%', '漲停',
];

const BEAR_FILTERS: BearSignalType[] = [
  '跌破昨低', '跌破5日低', '跌破10日低', '跌破5MA', '跌破20MA',
  '跌幅超過3%', '跌停', '陰跌連三日',
];

export function DualScreener({ scanState }: Props) {
  const { status, progress, scannedCount, totalCount, bull, bear } = scanState;

  const [mobileTab, setMobileTab]     = useState<'bull' | 'bear'>('bull');
  const [bullFilter, setBullFilter]   = useState<BullSignalType | null>(null);
  const [bearFilter, setBearFilter]   = useState<BearSignalType | null>(null);

  const filteredBull = bullFilter
    ? bull.filter(r => r.signals.some(s => s.type === bullFilter))
    : bull;

  const filteredBear = bearFilter
    ? bear.filter(r => r.signals.some(s => s.type === bearFilter))
    : bear;

  const FilterChips = ({
    filters, active, onSelect, color,
  }: {
    filters: string[];
    active: string | null;
    onSelect: (f: any) => void;
    color: string;
  }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
      <button
        onClick={() => onSelect(null)}
        style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4,
          border: `1px solid ${active === null ? color : BORDER}`,
          background: active === null ? `${color}22` : 'transparent',
          color: active === null ? color : '#8B8FA8',
          cursor: 'pointer',
        }}
      >
        全部
      </button>
      {filters.map(f => (
        <button
          key={f}
          onClick={() => onSelect(active === f ? null : f)}
          style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 4,
            border: `1px solid ${active === f ? color : BORDER}`,
            background: active === f ? `${color}22` : 'transparent',
            color: active === f ? color : '#8B8FA8',
            cursor: 'pointer',
          }}
        >
          {f}
        </button>
      ))}
    </div>
  );

  const BullPanel = () => (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: UP_COLOR }}>
          多方訊號
        </span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 10,
          color: UP_COLOR, background: `${UP_COLOR}22`, border: `1px solid ${UP_COLOR}44`,
        }}>
          {filteredBull.length} 檔
        </span>
      </div>
      <FilterChips
        filters={BULL_FILTERS}
        active={bullFilter}
        onSelect={setBullFilter}
        color={UP_COLOR}
      />
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {filteredBull.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>
            {status === 'scanning' ? '掃描中...' : '暫無多方訊號'}
          </div>
        ) : (
          filteredBull.map(r => (
            <StockSignalCard key={r.symbol} result={r} mode="intraday" side="bull" />
          ))
        )}
      </div>
    </div>
  );

  const BearPanel = () => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: DOWN_COLOR }}>
          空方訊號
        </span>
        <span style={{
          fontSize: 10, padding: '1px 6px', borderRadius: 10,
          color: DOWN_COLOR, background: `${DOWN_COLOR}22`, border: `1px solid ${DOWN_COLOR}44`,
        }}>
          {filteredBear.length} 檔
        </span>
      </div>
      <FilterChips
        filters={BEAR_FILTERS}
        active={bearFilter}
        onSelect={setBearFilter}
        color={DOWN_COLOR}
      />
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
        {filteredBear.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>
            {status === 'scanning' ? '掃描中...' : '暫無空方訊號'}
          </div>
        ) : (
          filteredBear.map(r => (
            <StockSignalCard key={r.symbol} result={r} mode="intraday" side="bear" />
          ))
        )}
      </div>
    </div>
  );

  return (
    <div style={{ background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
      {/* Progress bar */}
      {status === 'scanning' && (
        <div>
          <div style={{
            padding: '8px 16px', borderBottom: `1px solid ${BORDER}`,
            fontSize: 11, color: '#8B8FA8',
          }}>
            掃描中 {scannedCount}/{totalCount} 檔...
          </div>
          <div style={{ height: 2, background: BORDER }}>
            <div style={{
              height: '100%', width: `${progress}%`,
              background: DOWN_COLOR, transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* Mobile tab switcher */}
      <div className="md:hidden" style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
        {(['bull', 'bear'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            style={{
              flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 600,
              color: mobileTab === tab ? (tab === 'bull' ? UP_COLOR : DOWN_COLOR) : '#8B8FA8',
              borderBottom: mobileTab === tab
                ? `2px solid ${tab === 'bull' ? UP_COLOR : DOWN_COLOR}`
                : '2px solid transparent',
              background: 'transparent', cursor: 'pointer',
            }}
          >
            {tab === 'bull' ? '多方訊號' : '空方訊號'}
          </button>
        ))}
      </div>

      {/* Mobile content */}
      <div className="md:hidden" style={{ padding: 12 }}>
        {mobileTab === 'bull' ? <BullPanel /> : <BearPanel />}
      </div>

      {/* Desktop two-column layout */}
      <div
        className="hidden md:grid"
        style={{ gridTemplateColumns: '1fr 1fr', gap: 0 }}
      >
        <div style={{ padding: 16, borderRight: `1px solid ${BORDER}` }}>
          <BullPanel />
        </div>
        <div style={{ padding: 16 }}>
          <BearPanel />
        </div>
      </div>
    </div>
  );
}
