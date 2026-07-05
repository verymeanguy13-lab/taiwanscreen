// =============================================================================
// lib/finmind.ts — FinMind API client
// Used for quarterly financial statement data (EPS, net income, equity),
// which powers eps_growth_yoy and roe in the fundamentals table.
//
// FinMind free tier: 300 requests/hour without a token, 600/hour with one.
// Set FINMIND_TOKEN in your environment to get the higher limit.
// Docs: https://finmind.github.io/tutor/TaiwanMarket/Fundamental/
// =============================================================================

const BASE_URL = 'https://api.finmindtrade.com/api/v4/data';

export interface QuarterlyFinancials {
  date:   string; // e.g. "2025-09-30"
  eps:    number | null;
  netIncome: number | null;   // IncomeAfterTaxes
  equity:    number | null;   // EquityAttributableToOwnersOfParent
}

/**
 * Fetches quarterly financial statement line items for a single stock,
 * going back far enough to cover the same quarter one year ago (so YoY
 * EPS growth can be computed from a single call).
 */
export async function fetchStockFinancials(
  stockId: string,
  monthsBack: number = 20,
): Promise<QuarterlyFinancials[]> {
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    const startDateStr = startDate.toISOString().slice(0, 10);

    const token = process.env.FINMIND_TOKEN ?? '';
    const url = new URL(BASE_URL);
    url.searchParams.set('dataset', 'TaiwanStockFinancialStatements');
    url.searchParams.set('data_id', stockId);
    url.searchParams.set('start_date', startDateStr);

    const res = await fetch(url.toString(), {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[fetchStockFinancials] HTTP ${res.status} for ${stockId}`);
      return [];
    }

    const json = await res.json();
    if (json?.status !== 200 || !Array.isArray(json?.data)) {
      console.error(`[fetchStockFinancials] Bad response for ${stockId}:`, json?.msg);
      return [];
    }

    // The API returns one row per (date, line-item type). Group by date first.
    const byDate = new Map<string, { eps: number | null; netIncome: number | null; equity: number | null }>();

    for (const row of json.data as { date: string; type: string; value: number }[]) {
      if (!byDate.has(row.date)) {
        byDate.set(row.date, { eps: null, netIncome: null, equity: null });
      }
      const entry = byDate.get(row.date)!;
      if (row.type === 'EPS') entry.eps = row.value;
      if (row.type === 'IncomeAfterTaxes') entry.netIncome = row.value;
      if (row.type === 'EquityAttributableToOwnersOfParent') entry.equity = row.value;
    }

    const results: QuarterlyFinancials[] = Array.from(byDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return results;
  } catch (err) {
    console.error(`[fetchStockFinancials] Unexpected error for ${stockId}:`, err);
    return [];
  }
}

export interface LatestPBR {
  date: string; // e.g. "2026-07-02"
  per:  number | null;
  pbr:  number | null;
}

/**
 * Fetches the most recent PER/PBR snapshot for a single stock from FinMind's
 * TaiwanStockPER dataset. This gives us pb_ratio directly — no need to
 * compute book value per share ourselves.
 */
export async function fetchLatestPBR(stockId: string): Promise<LatestPBR | null> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 14); // small window, we only need the latest row
    const startDateStr = startDate.toISOString().slice(0, 10);

    const token = process.env.FINMIND_TOKEN ?? '';
    const url = new URL(BASE_URL);
    url.searchParams.set('dataset', 'TaiwanStockPER');
    url.searchParams.set('data_id', stockId);
    url.searchParams.set('start_date', startDateStr);

    const res = await fetch(url.toString(), {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[fetchLatestPBR] HTTP ${res.status} for ${stockId}`);
      return null;
    }

    const json = await res.json();
    if (json?.status !== 200 || !Array.isArray(json?.data) || json.data.length === 0) {
      return null;
    }

    const rows = json.data as { date: string; PER: number | null; PBR: number | null }[];
    const latest = rows.sort((a, b) => a.date.localeCompare(b.date))[rows.length - 1];

    return { date: latest.date, per: latest.PER ?? null, pbr: latest.PBR ?? null };
  } catch (err) {
    console.error(`[fetchLatestPBR] Unexpected error for ${stockId}:`, err);
    return null;
  }
}

export interface BalanceSheetSnapshot {
  date: string;
  totalAssets:      number | null;
  totalLiabilities: number | null;
}

/**
 * Fetches the most recent balance sheet snapshot for a single stock from
 * FinMind's TaiwanStockBalanceSheet dataset, used to compute debt_ratio
 * (totalLiabilities / totalAssets × 100).
 *
 * NOTE: FinMind's exact `type` label for these two line items hasn't been
 * confirmed live yet — this matches against several plausible names. If a
 * batch run comes back with debt_ratio all null, check the `errors` array
 * from ingestBalanceSheetFinMind for the unmatched type list it logs, and
 * adjust the matching below.
 */
export async function fetchStockBalanceSheet(
  stockId: string,
  monthsBack: number = 6,
): Promise<BalanceSheetSnapshot[]> {
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);
    const startDateStr = startDate.toISOString().slice(0, 10);

    const token = process.env.FINMIND_TOKEN ?? '';
    const url = new URL(BASE_URL);
    url.searchParams.set('dataset', 'TaiwanStockBalanceSheet');
    url.searchParams.set('data_id', stockId);
    url.searchParams.set('start_date', startDateStr);

    const res = await fetch(url.toString(), {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[fetchStockBalanceSheet] HTTP ${res.status} for ${stockId}`);
      return [];
    }

    const json = await res.json();
    if (json?.status !== 200 || !Array.isArray(json?.data)) {
      console.error(`[fetchStockBalanceSheet] Bad response for ${stockId}:`, json?.msg);
      return [];
    }

    const byDate = new Map<string, { totalAssets: number | null; totalLiabilities: number | null }>();

    for (const row of json.data as { date: string; type: string; value: number }[]) {
      if (!byDate.has(row.date)) {
        byDate.set(row.date, { totalAssets: null, totalLiabilities: null });
      }
      const entry = byDate.get(row.date)!;
      // Match by exact name first, then a loose fallback in case FinMind's
      // label differs slightly from what's documented.
      if (row.type === 'TotalAssets' || (entry.totalAssets === null && row.type.includes('TotalAssets'))) {
        entry.totalAssets = row.value;
      }
      if (row.type === 'Liabilities' || (entry.totalLiabilities === null && row.type.includes('Liabilities') && !row.type.includes('Current') && !row.type.includes('NonCurrent'))) {
        entry.totalLiabilities = row.value;
      }
    }

    return Array.from(byDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    console.error(`[fetchStockBalanceSheet] Unexpected error for ${stockId}:`, err);
    return [];
  }
}

/** Wait for ms milliseconds — used to pace requests within a batch. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}