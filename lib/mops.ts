// ============================================================
// ADD THESE FUNCTIONS TO THE BOTTOM OF lib/mops.ts
// (keep all existing functions above — just append these)
// ============================================================

// MOPS HTML parsing can be brittle. If MOPS changes their HTML format,
// this file may need updating. Always check the raw response first.

/**
 * Fetches balance sheet data from MOPS for all TWSE-listed stocks.
 * Endpoint: ajax_t164sb03 (資產負債表 — Balance Sheet)
 *
 * Returns total assets and total liabilities, from which we compute:
 *   debt_ratio = total_liabilities / total_assets × 100
 *
 * MOPS season encoding:
 *   Q1 = season 1 (published ~May)
 *   Q2 = season 2 (published ~August)
 *   Q3 = season 3 (published ~November)
 *   Q4 = season 4 (published ~March of following year)
 *
 * @param year    Western year (e.g. 2025) — converted to ROC internally
 * @param season  1 | 2 | 3 | 4
 */
export async function fetchBalanceSheet(
  year: number,
  season: number
): Promise<{ symbol: string; totalAssets: number; totalLiabilities: number; debtRatio: number }[]> {
  const rocYear = year - 1911;

  const tryFetch = async (): Promise<string> => {
    const res = await fetch('https://mops.twse.com.tw/mops/web/ajax_t164sb03', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        encodeURIComponent: '1',
        step: '1',
        firstin: '1',
        off: '1',
        keyword4: '',
        code1: '',
        TYPEK: 'sii',   // sii = TWSE listed stocks
        isnew: 'false',
        year: String(rocYear),
        season: String(season),
      }).toString(),
    });
    if (!res.ok) throw new Error(`MOPS balance sheet HTTP ${res.status}`);
    return res.text();
  };

  let html = '';
  try {
    html = await tryFetch();
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    try {
      html = await tryFetch();
    } catch (e) {
      console.error('[mops] fetchBalanceSheet failed:', e);
      return [];
    }
  }

  const rows = parseHTMLTable(html);
  const results: { symbol: string; totalAssets: number; totalLiabilities: number; debtRatio: number }[] = [];

  for (const row of rows) {
    // MOPS t164sb03 column layout (0-indexed):
    // 0: 公司代號 (symbol)
    // 1: 公司名稱 (name)
    // 2: 資產合計 (total assets, in thousands TWD)
    // 3: 負債合計 (total liabilities, in thousands TWD)
    // Additional columns vary by period
    if (row.length < 4) continue;
    const symbol = row[0]?.trim();
    if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

    const totalAssets = parseFloat(row[2]?.replace(/,/g, '') || '0');
    const totalLiabilities = parseFloat(row[3]?.replace(/,/g, '') || '0');

    if (isNaN(totalAssets) || totalAssets <= 0) continue;
    if (isNaN(totalLiabilities) || totalLiabilities < 0) continue;

    const debtRatio = parseFloat(((totalLiabilities / totalAssets) * 100).toFixed(2));

    results.push({ symbol, totalAssets, totalLiabilities, debtRatio });
  }

  console.log(`[mops] fetchBalanceSheet ${year}Q${season}: ${results.length} stocks`);
  return results;
}

/**
 * Fetches book value per share (每股淨值) from MOPS for all TWSE-listed stocks.
 * Endpoint: ajax_t05st22 (每股盈餘及淨值)
 *
 * Book value per share is used to compute:
 *   pb_ratio = current_price / book_value_per_share
 *
 * @param year    Western year (e.g. 2025)
 * @param season  1 | 2 | 3 | 4
 */
export async function fetchBookValue(
  year: number,
  season: number
): Promise<{ symbol: string; bookValuePerShare: number }[]> {
  const rocYear = year - 1911;

  const tryFetch = async (): Promise<string> => {
    const res = await fetch('https://mops.twse.com.tw/mops/web/ajax_t05st22', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        encodeURIComponent: '1',
        step: '1',
        firstin: '1',
        off: '1',
        keyword4: '',
        code1: '',
        TYPEK: 'sii',
        isnew: 'false',
        year: String(rocYear),
        season: String(season),
      }).toString(),
    });
    if (!res.ok) throw new Error(`MOPS book value HTTP ${res.status}`);
    return res.text();
  };

  let html = '';
  try {
    html = await tryFetch();
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    try {
      html = await tryFetch();
    } catch (e) {
      console.error('[mops] fetchBookValue failed:', e);
      return [];
    }
  }

  const rows = parseHTMLTable(html);
  const results: { symbol: string; bookValuePerShare: number }[] = [];

  for (const row of rows) {
    // MOPS t05st22 column layout (0-indexed):
    // 0: 公司代號 (symbol)
    // 1: 公司名稱 (name)
    // 2: 基本每股盈餘 (basic EPS)
    // 3: 稀釋每股盈餘 (diluted EPS)
    // 4: 每股淨值 (book value per share)  ← this is what we need
    if (row.length < 5) continue;
    const symbol = row[0]?.trim();
    if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

    const bookValue = parseFloat(row[4]?.replace(/,/g, '') || '0');
    if (isNaN(bookValue) || bookValue <= 0) continue;

    results.push({ symbol, bookValuePerShare: bookValue });
  }

  console.log(`[mops] fetchBookValue ${year}Q${season}: ${results.length} stocks`);
  return results;
}

/**
 * Returns the most recently completed fiscal season for a given date.
 * MOPS data is published ~6 weeks after quarter end.
 *
 * Q4 (Oct–Dec) → published ~mid-March of following year
 * Q1 (Jan–Mar) → published ~mid-May
 * Q2 (Apr–Jun) → published ~mid-August
 * Q3 (Jul–Sep) → published ~mid-November
 */
export function getLatestCompletedSeason(now: Date = new Date()): { year: number; season: number } {
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  if (month >= 11) return { year, season: 3 };       // Nov+: Q3 published
  if (month >= 8)  return { year, season: 2 };       // Aug–Oct: Q2 published
  if (month >= 5)  return { year, season: 1 };       // May–Jul: Q1 published
  return { year: year - 1, season: 4 };              // Jan–Apr: Q4 of prev year
}