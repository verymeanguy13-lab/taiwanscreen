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
  '近五日強勢股', '外資連買三日', '外資連買五日',
  '主力買超', '投信買超', '投信連買', '融資增加', '投信籌碼集中',
];

const BEAR_STRATEGY_FILTERS = [
  '近五日弱勢股', '外資連賣三日', '外資連賣五日',
  '主力賣超', '空頭排列', '融券增加', '融資減少', '跌破季線',
];

const WORKFLOW_STEPS = [
  { step: 1, text: '系統每日收盤後自動掃描全市場符合條件個股' },
  { step: 2, text: '於 09:00 前完成昨日收盤資料建立' },
  { step: 3, text: '09:00至9:20 開盤觀察量能是否配合訊號方向' },
  { step: 4, text: '確認開盤方向後依據策略設定停利停損點位' },
];

function toScanResult(r: any, side: 'bull' | 'bear'): ScanResult {
  return {
    symbol:        r.symbol,
    name_zh:       r.name_zh,
    sector:        r.sector ?? '',
    price:         r.price ?? 0,
    changePercent: r.changePercent ?? 0,
    signals:       [],
    trendStrength: {
      bullScore:    side === 'bull' ? (r.matrixScore ?? r.confidence ?? 0) : 0,
      bearScore:    side === 'bear' ? (r.matrixScore ?? r.confidence ?? 0) : 0,
      dominantSide: side,
      bars:         [],
    },
    yesterdayTrend: r.breakoutType ?? '中性',
    bullCount:      side === 'bull' ? 1 : 0,
    bearCount:      side === 'bear' ? 1 : 0,
  };
}

function WorkflowGuide({ count }: { count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0F1117', cursor: 'pointer', border: 'none' }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>
          📋 盤後操作流程 · 共掃描到 {count} 檔個股
        </span>
        <span style={{ fontSize: 12, color: '#8B8FA8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ background: '#08090E', padding: '12px 16px' }}>
          {WORKFLOW_STEPS.map(({ step, text }) => (
            <div key={step} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: '#1E2235', color: DOWN_COLOR, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>
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

function FilterChips({ filters, active, onSelect, color }: { filters: string[]; active: string | null; onSelect: (f: string | null) => void; color: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
      <button onClick={() => onSelect(null)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${active === null ? color : BORDER}`, background: active === null ? `${color}22` : 'transparent', color: active === null ? color : '#8B8FA8' }}>
        全部
      </button>
      {filters.map(f => (
        <button key={f} onClick={() => onSelect(active === f ? null : f)} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${active === f ? color : BORDER}`, background: active === f ? `${color}22` : 'transparent', color: active === f ? color : '#8B8FA8' }}>
          {f}
        </button>
      ))}
    </div>
  );
}

export function AfterHoursScreener() {
  const [activeTab,  setActiveTab]  = useState<'bull' | 'bear'>('bull');
  const [bullFilter, setBullFilter] = useState<string | null>(null);
  const [bearFilter, setBearFilter] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [marketOpen, setMarketOpen] = useState(false);

  const { data: bullData, isLoading: bullLoading, mutate: mutateBull } = useSWR(
    '/api/kline/afterhours?side=bull',
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: marketOpen ? 300000 : 0,
      onSuccess: (d) => { if (d?.marketOpen) setMarketOpen(true); },
    }
  );

  const { data: bearData, isLoading: bearLoading, error, mutate: mutateBear } = useSWR(
    '/api/kline/afterhours?side=bear',
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: marketOpen ? 300000 : 0,
      onSuccess: (d) => { if (d?.marketOpen) setMarketOpen(true); },
    }
  );

  const isLoading  = bullLoading || bearLoading;
  const isLive     = !!(bullData?.isLive || bearData?.isLive);
  const liveAt     = bullData?.liveAt ?? bearData?.liveAt ?? null;

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      await Promise.all([
        fetch('/api/kline/afterhours?side=bull&rebuild=true'),
        fetch('/api/kline/afterhours?side=bear&rebuild=true'),
      ]);
      await Promise.all([mutateBull(), mutateBear()]);
    } finally {
      setRebuilding(false);
    }
  };

  // Keep raw results array in original order (sorted by confidence desc) so we
  // can access r.confidence by index when passing to StockSignalCard.
  const rawBullResults: any[] = (bullData?.results ?? [])
    .sort((a: any, b: any) => b.confidence - a.confidence);

  const rawBearResults: any[] = (bearData?.results ?? [])
    .sort((a: any, b: any) => b.confidence - a.confidence);

  const bullResults: ScanResult[] = rawBullResults.map((r: any) => toScanResult(r, 'bull'));
  const bearResults: ScanResult[] = rawBearResults.map((r: any) => toScanResult(r, 'bear'));

  // For filtered views we need to keep the raw item alongside the ScanResult
  const bullPairs = bullResults.map((r, i) => ({ result: r, raw: rawBullResults[i] }));
  const bearPairs = bearResults.map((r, i) => ({ result: r, raw: rawBearResults[i] }));

  const filteredBull = bullFilter ? bullPairs.filter(p => p.result.yesterdayTrend === bullFilter) : bullPairs;
  const filteredBear = bearFilter ? bearPairs.filter(p => p.result.yesterdayTrend === bearFilter) : bearPairs;

  const liveTimeStr = liveAt
    ? new Date(liveAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Taipei' })
    : '';

  if (isLoading) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B8FA8', fontSize: 13, background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}` }}>
        載入盤後資料中..
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UP_COLOR, fontSize: 13, background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}` }}>
        ⚠️ 無法載入盤後資料
      </div>
    );
  }

  const totalCount = bullResults.length + bearResults.length;

  return (
    <div style={{ background: '#0F1117', borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>

      {/* Status bar */}
      {marketOpen && isLive ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#081208', borderBottom: '1px solid #1a3a1a', fontSize: 11, color: DOWN_COLOR }}>
          <span>⚡ 即時報價模式 · 最後更新 {liveTimeStr}（每5分鐘自動刷新）</span>
          <button onClick={handleRebuild} disabled={rebuilding} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${DOWN_COLOR}44`, background: `${DOWN_COLOR}11`, color: DOWN_COLOR, opacity: rebuilding ? 0.5 : 1 }}>
            {rebuilding ? '更新中..' : '立即更新'}
          </button>
        </div>
      ) : marketOpen && !isLive ? (
        <div style={{ padding: '8px 16px', background: '#121208', borderBottom: '1px solid #3a3a1a', fontSize: 11, color: '#FFD700' }}>
          ⏳ 等待即時報價資料載入中...
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: '#08090E', borderBottom: `1px solid ${BORDER}`, fontSize: 11, color: '#8B8FA8' }}>
          <span>盤後模式</span>
          <button onClick={handleRebuild} disabled={rebuilding} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${BORDER}`, background: 'transparent', color: '#8B8FA8', opacity: rebuilding ? 0.5 : 1 }}>
            {rebuilding ? '重建中..' : '重新整理'}
          </button>
        </div>
      )}

      <div style={{ padding: 16, borderBottom: `1px solid ${BORDER}` }}>
        <WorkflowGuide count={totalCount} />
      </div>

      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
        {(['bull', 'bear'] as const).map(tab => {
          const color = tab === 'bull' ? UP_COLOR : DOWN_COLOR;
          const count = tab === 'bull' ? bullResults.length : bearResults.length;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 600, color: activeTab === tab ? color : '#8B8FA8', borderBottom: activeTab === tab ? `2px solid ${color}` : '2px solid transparent', background: 'transparent', cursor: 'pointer' }}>
              {tab === 'bull' ? '看多' : '看空'}
              <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 10, color, background: `${color}22`, border: `1px solid ${color}44` }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16 }}>
        {activeTab === 'bull' ? (
          <>
            <FilterChips filters={BULL_STRATEGY_FILTERS} active={bullFilter} onSelect={setBullFilter} color={UP_COLOR} />
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {filteredBull.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>暫無看多訊號</div>
              ) : (
                filteredBull.map(({ result, raw }, i) => (
                  <div key={result.symbol} style={{ position: 'relative' }}>
                    <StockSignalCard
                      result={result}
                      mode="afterhours"
                      side="bull"
                      score={raw.confidence !== undefined ? Math.round(raw.confidence) : undefined}
                    />
                    {isLive && raw.isLivePrice && (
                      <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, background: `${DOWN_COLOR}22`, color: DOWN_COLOR, padding: '1px 5px', borderRadius: 3 }}>即時</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <FilterChips filters={BEAR_STRATEGY_FILTERS} active={bearFilter} onSelect={setBearFilter} color={DOWN_COLOR} />
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {filteredBear.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#8B8FA8', fontSize: 12 }}>暫無看空訊號</div>
              ) : (
                filteredBear.map(({ result, raw }, i) => (
                  <div key={result.symbol} style={{ position: 'relative' }}>
                    <StockSignalCard
                      result={result}
                      mode="afterhours"
                      side="bear"
                      score={raw.confidence !== undefined ? Math.round(raw.confidence) : undefined}
                    />
                    {isLive && raw.isLivePrice && (
                      <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 9, background: `${DOWN_COLOR}22`, color: DOWN_COLOR, padding: '1px 5px', borderRadius: 3 }}>即時</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
