'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ChainGraph } from '@/components/supply-chain/ChainGraph';
import type { GraphNode, GraphEdge } from '@/components/supply-chain/ChainGraph';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatChange } from '@/lib/utils';

// ── Fetcher ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Ecosystem config ──────────────────────────────────────────────────────────
const ECOSYSTEMS = [
  { label: '台積電',  value: 'tsmc'   },
  { label: '蘋果',    value: 'apple'  },
  { label: 'AI/輝達', value: 'nvidia' },
  { label: '電動車',  value: 'ev'     },
] as const;

type Ecosystem = typeof ECOSYSTEMS[number]['value'];

// ── Types ─────────────────────────────────────────────────────────────────────
interface ApiNode {
  symbol:           string;
  name_zh:          string;
  name_en:          string | null;
  sector:           string | null;
  close:            number | null;
  change_pct:       number | null;
  market_cap:       number | null;
  latest_yield_pct: number | null;
  is_center:        boolean;
}

interface ApiEdge {
  parent_symbol: string;
  child_symbol:  string;
  relationship:  string | null;
  category:      string | null;
  tier:          number | null;
}

interface Performance {
  up_count:          number;
  down_count:        number;
  flat_count:        number;
  avg_change:        number;
  total_foreign_net: number | null;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SupplyChainPage() {
  const router = useRouter();
  const [ecosystem, setEcosystem]         = useState<Ecosystem>('tsmc');
  const [highlighted, setHighlighted]     = useState<string | null>(null);
  const [lastClickTime, setLastClickTime] = useState(0);

  const { data: res, isLoading } = useSWR(
    `/api/supply-chain?ecosystem=${ecosystem}`,
    fetcher,
    { keepPreviousData: true },
  );

  const apiNodes:   ApiNode[]   = res?.data?.nodes       ?? [];
  const apiEdges:   ApiEdge[]   = res?.data?.edges       ?? [];
  const perf:       Performance = res?.data?.performance ?? { up_count: 0, down_count: 0, flat_count: 0, avg_change: 0, total_foreign_net: null };
  const ecoLabel = ECOSYSTEMS.find(e => e.value === ecosystem)?.label ?? ecosystem;

  // Map API nodes → GraphNode
  const graphNodes: GraphNode[] = apiNodes.map(n => ({
    symbol:     n.symbol,
    name_zh:    n.name_zh,
    change_pct: n.change_pct,
    market_cap: n.market_cap,
    is_center:  n.is_center,
    sector:     n.sector,
    close:      n.close,
  }));

  // Map API edges → GraphEdge (source/target as symbol strings)
  const graphEdges: GraphEdge[] = apiEdges.map(e => ({
    source:   e.parent_symbol,
    target:   e.child_symbol,
    category: e.category,
    tier:     e.tier,
  }));

  // Companion table: non-center nodes sorted by change_pct desc
  const tableNodes = apiNodes
    .filter(n => !n.is_center)
    .sort((a, b) => (b.change_pct ?? -99) - (a.change_pct ?? -99));

  // Get edge role for a symbol
  const getRole = (symbol: string): string => {
    const edge = apiEdges.find(e => e.child_symbol === symbol);
    return edge?.category ?? '—';
  };

  const handleNodeClick = (symbol: string) => {
    const now = Date.now();
    if (symbol === highlighted && now - lastClickTime < 400) {
      // Double click → navigate
      router.push(`/stock/${symbol}`);
    } else {
      setHighlighted(prev => prev === symbol ? null : symbol);
      setLastClickTime(now);
    }
  };

  const handleRowClick = (symbol: string) => {
    const now = Date.now();
    if (symbol === highlighted && now - lastClickTime < 400) {
      router.push(`/stock/${symbol}`);
    } else {
      setHighlighted(prev => prev === symbol ? null : symbol);
      setLastClickTime(now);
    }
  };

  // Taiwan convention: red = up, green = down (was backwards before)
  const avgColor = perf.avg_change >= 0 ? 'var(--accent-red)' : 'var(--accent-green)';

  return (
    <div className="flex flex-col" style={{ backgroundColor: 'var(--bg-primary)', height: 'calc(100vh - 3.5rem)' }}>

      {/* ── Ecosystem tabs ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-0 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}>
        {ECOSYSTEMS.map(eco => (
          <button key={eco.value} onClick={() => { setEcosystem(eco.value); setHighlighted(null); }}
            className="px-4 py-2 text-sm font-medium transition-colors duration-100"
            style={{
              color: ecosystem === eco.value ? 'var(--accent-green)' : 'var(--text-secondary)',
              borderBottom: ecosystem === eco.value ? '2px solid var(--accent-green)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {eco.label}
          </button>
        ))}
      </div>

      {/* ── Performance banner ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs shrink-0"
        style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          今日{ecoLabel}供應鏈：
        </span>
        <span style={{ color: 'var(--accent-red)' }}>上漲 {perf.up_count} 家 ▲</span>
        <span style={{ color: 'var(--accent-green)' }}>下跌 {perf.down_count} 家 ▼</span>
        <span style={{ color: 'var(--text-muted)' }}>平盤 {perf.flat_count} 家</span>
        <span>
          平均漲跌：
          <span className="num font-semibold ml-1" style={{ color: avgColor }}>
            {perf.avg_change >= 0 ? '+' : ''}{Number(perf.avg_change).toFixed(2)}%
          </span>
        </span>
        {perf.total_foreign_net != null && (
          <span style={{ color: 'var(--text-muted)' }}>
            外資合計：
            <span className="num ml-1" style={{ color: perf.total_foreign_net >= 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
              {perf.total_foreign_net >= 0 ? '+' : ''}{Math.round(perf.total_foreign_net / 1000).toLocaleString('en-US')}千張
            </span>
          </span>
        )}
      </div>

      {/* ── Main body ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── LEFT: Graph ─────────────────────────────────────────────── */}
        <div className="flex flex-col" style={{ width: '65%', borderRight: '1px solid var(--border)' }}>
          <div className="flex-1 p-3 overflow-hidden">
            {isLoading
              ? <Skeleton className="h-full w-full rounded-lg" />
              : (
                <ChainGraph
                  nodes={graphNodes}
                  edges={graphEdges}
                  onNodeClick={handleNodeClick}
                  highlightedSymbol={highlighted}
                />
              )
            }
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 px-4 py-2 text-xs shrink-0"
            style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: '#F5B700' }} />
              中心節點
            </span>
            <span>● 節點大小 = 市值</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-5" style={{ backgroundColor: '#6B7FCC', opacity: 0.6 }} />
              一階供應商
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#FF4D6D' }} /> 上漲
              <span className="inline-block h-2 w-2 rounded-full ml-1" style={{ backgroundColor: '#00D4AA' }} /> 下跌
            </span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
              拖曳移動節點 | 滾輪縮放
            </span>
          </div>
        </div>

        {/* ── RIGHT: Companion table ───────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden" style={{ width: '35%' }}>
          <div className="px-3 py-2 text-xs font-semibold shrink-0"
            style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            供應鏈成員（點擊高亮 | 快速雙擊進入個股）
          </div>
          <div className="overflow-y-auto flex-1">
            {isLoading
              ? <Skeleton className="h-full w-full" />
              : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['代號', '股名', '在鏈角色', '漲跌%', '殖利率'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold"
                          style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableNodes.map((node, idx) => {
                      const change      = formatChange(node.change_pct ?? 0);
                      const isSelected  = highlighted === node.symbol;
                      return (
                        <tr key={node.symbol}
                          className="cursor-pointer transition-colors duration-100"
                          onClick={() => handleRowClick(node.symbol)}
                          style={{
                            backgroundColor: isSelected
                              ? 'rgba(245,183,0,0.08)'
                              : idx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)',
                            borderBottom: '1px solid var(--border)',
                            borderLeft: isSelected ? '3px solid var(--accent-gold)' : '3px solid transparent',
                          }}>
                          <td className="num px-3 py-1.5 font-semibold"
                            style={{ color: 'var(--accent-blue)', whiteSpace: 'nowrap' }}>
                            {node.symbol}
                          </td>
                          <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                            {node.name_zh}
                          </td>
                          <td className="px-3 py-1.5" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {getRole(node.symbol)}
                          </td>
                          <td className="num px-3 py-1.5 font-semibold" style={{ color: change.color }}>
                            {change.value}
                          </td>
                          <td className="num px-3 py-1.5" style={{ color: 'var(--accent-gold)' }}>
                            {node.latest_yield_pct != null
                              ? `${Number(node.latest_yield_pct).toFixed(2)}%`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {tableNodes.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-6 text-center"
                        style={{ color: 'var(--text-muted)' }}>暫無資料</td></tr>
                    )}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>
      </div>
    </div>
  );
}