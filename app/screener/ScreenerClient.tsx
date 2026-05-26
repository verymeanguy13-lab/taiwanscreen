'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { PresetBar } from '@/components/screener/PresetBar';
import { FilterPanel } from '@/components/screener/FilterPanel';
import { ScreenerTable } from '@/components/screener/ScreenerTable';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import AdSlot from '@/components/ads/AdSlot';
import type { ScreenerFilter, PaginatedResponse, ScreenerRow } from '@/types';

// ── SWR fetcher ───────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── URL ↔ filter helpers ──────────────────────────────────────────────────────
function filtersToParams(f: ScreenerFilter): URLSearchParams {
  const p = new URLSearchParams();
  const add = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') {
      if (Array.isArray(v)) {
        if (v.length > 0) p.set(k, v.join(','));
      } else {
        p.set(k, String(v));
      }
    }
  };
  Object.entries(f).forEach(([k, v]) => add(k, v));
  return p;
}

function paramsToFilters(p: URLSearchParams): ScreenerFilter {
  const get     = (k: string) => p.get(k);
  const getNum  = (k: string) => { const v = p.get(k); return v !== null ? parseFloat(v) : undefined; };
  const getInt  = (k: string) => { const v = p.get(k); return v !== null ? parseInt(v, 10) : undefined; };
  const getBool = (k: string) => { const v = p.get(k); return v === 'true' ? true : v === 'false' ? false : undefined; };

  return {
    pe_min:                  getNum('pe_min'),
    pe_max:                  getNum('pe_max'),
    pb_min:                  getNum('pb_min'),
    pb_max:                  getNum('pb_max'),
    roe_min:                 getNum('roe_min'),
    gross_margin_min:        getNum('gross_margin_min'),
    debt_ratio_max:          getNum('debt_ratio_max'),
    revenue_growth_min:      getNum('revenue_growth_min'),
    eps_growth_min:          getNum('eps_growth_min'),
    market_cap_min:          getNum('market_cap_min'),
    market_cap_max:          getNum('market_cap_max'),
    price_min:               getNum('price_min'),
    price_max:               getNum('price_max'),
    volume_min:              getNum('volume_min'),
    change_pct_min:          getNum('change_pct_min'),
    change_pct_max:          getNum('change_pct_max'),
    foreign_net_min:         getNum('foreign_net_min'),
    trust_net_min:           getNum('trust_net_min'),
    foreign_consecutive_min: getInt('foreign_consecutive_min'),
    trust_consecutive_min:   getInt('trust_consecutive_min'),
    triple_buy:              getBool('triple_buy'),
    yield_min:               getNum('yield_min'),
    yield_max:               getNum('yield_max'),
    consecutive_years_min:   getInt('consecutive_years_min'),
    sector:                  get('sector') ? get('sector')!.split(',') : undefined,
    market:                  (get('market') as ScreenerFilter['market']) ?? 'all',
    sort_by:                 get('sort_by') ?? 'change_pct',
    sort_dir:                (get('sort_dir') as 'asc' | 'desc') ?? 'desc',
    page:                    getInt('page') ?? 1,
    per_page:                getInt('per_page') ?? 50,
  };
}

// ── Client component ──────────────────────────────────────────────────────────
export default function ScreenerClient() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);

  const filters = paramsToFilters(searchParams);

  const setFilters = useCallback((f: ScreenerFilter) => {
    const params = filtersToParams(f);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [router]);

  const handleSort = (col: string) => {
    const newDir = filters.sort_by === col && filters.sort_dir === 'desc' ? 'asc' : 'desc';
    setFilters({ ...filters, sort_by: col, sort_dir: newDir, page: 1 });
  };

  const apiParams = filtersToParams(filters);
  const apiUrl = `/api/screener?${apiParams.toString()}`;

  const { data, isLoading } = useSWR<PaginatedResponse<ScreenerRow>>(apiUrl, fetcher, {
    keepPreviousData: true,
  });

  const totalPages  = data ? Math.ceil(data.total / (filters.per_page ?? 50)) : 1;
  const currentPage = filters.page ?? 1;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for non-secure contexts
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="mx-auto max-w-screen-2xl px-4 py-4 flex flex-col gap-4">

        {/* ── PresetBar ── */}
        <PresetBar currentFilters={filters} onFilterChange={setFilters} />

        {/* ── Main layout ── */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start">

          {/* ── Filter Panel (left) ── */}
          <div className="w-full md:w-64 shrink-0">
            <FilterPanel filters={filters} onChange={setFilters} />
          </div>

          {/* ── Results (right) ── */}
          <div className="flex flex-1 flex-col gap-3 min-w-0">

            {/* ── Top bar: count + copy ── */}
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {isLoading
                  ? '搜尋中…'
                  : `找到 ${(data?.total ?? 0).toLocaleString()} 檔股票`
                }
              </span>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? '✓ 已複製' : '複製連結'}
              </Button>
            </div>

            {/* ── Ad slot — sits above the results table ── */}
            <div className="flex justify-center">
              <AdSlot size="leaderboard" slotId="screener-top" />
            </div>

            {/* ── Table or skeleton ── */}
            {isLoading
              ? <SkeletonTable rows={12} cols={11} />
              : (
                <ScreenerTable
                  data={data?.data ?? []}
                  sortBy={filters.sort_by ?? 'change_pct'}
                  sortDir={filters.sort_dir ?? 'desc'}
                  onSort={handleSort}
                />
              )
            }

            {/* ── Pagination ── */}
            {!isLoading && (data?.total ?? 0) > 0 && (
              <div className="flex items-center justify-center gap-4 py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setFilters({ ...filters, page: currentPage - 1 })}
                >
                  上一頁
                </Button>
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  第 {currentPage} / {totalPages} 頁
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setFilters({ ...filters, page: currentPage + 1 })}
                >
                  下一頁
                </Button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
