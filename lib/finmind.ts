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
  monthsBack: number = 15,
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

/** Wait for ms milliseconds — used to pace requests within a batch. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}