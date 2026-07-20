const BASE_URL = 'https://mops.twse.com.tw';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Convert western year to 民國 (Republic of China) year */
function toROCYear(westernYear: number): number {
  return westernYear - 1911;
}

/** Wait for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Session cookie handling
//
// MOPS's ajax_* endpoints frequently reject cookie-less POST requests with a
// silently empty/near-empty response (no HTTP error — just nothing useful in
// the body). A plain browser session gets a cookie by visiting a parent page
// first; we replicate that with one GET before the POST, cache the cookie for
// the life of this server instance, and re-fetch it if a request comes back
// empty (in case it expired).
// -----------------------------------------------------------------------------
let cachedCookie: string | null = null;

async function getMopsCookie(forceRefresh = false): Promise<string | null> {
  if (cachedCookie && !forceRefresh) return cachedCookie;

  try {
    const res = await fetch(`${BASE_URL}/mops/web/index`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TaiwanScreen/1.0)' },
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      // Keep just the cookie pairs, drop attributes like Path/HttpOnly/Expires
      cachedCookie = setCookie.split(',').map(c => c.split(';')[0].trim()).join('; ');
    }
    return cachedCookie;
  } catch (err) {
    console.error('[mops] Failed to prime session cookie:', err);
    return null;
  }
}

/**
 * POST to MOPS with form-encoded body.
 * Primes a session cookie first (required — see getMopsCookie above).
 * Retries once after 2 seconds on failure, and once more with a fresh
 * cookie if the response body comes back suspiciously empty.
 * Returns the raw response text, or null on failure.
 */
async function mopsFetch(path: string, body: Record<string, string>): Promise<string | null> {
  const url = `${BASE_URL}${path}`;
  const formBody = new URLSearchParams(body).toString();

  const attempt = async (cookie: string | null): Promise<string | null> => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json, text/html, */*',
          // MOPS requires a referer or it may block the request
          'Referer': BASE_URL,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: formBody,
      });

      if (!res.ok) {
        console.error(`[mopsFetch] HTTP ${res.status} for ${path}`);
        return null;
      }

      return await res.text();
    } catch (err) {
      console.error(`[mopsFetch] Fetch error for ${path}:`, err);
      return null;
    }
  };

  const cookie = await getMopsCookie();

  // First attempt
  const first = await attempt(cookie);
  if (first !== null && first.trim().length > 0) return first;

  // Retry after 2 seconds — could be a cold session cookie, so refresh it
  console.warn(`[mopsFetch] Empty/failed response for ${path}, retrying with fresh cookie…`);
  await sleep(2000);
  const freshCookie = await getMopsCookie(true);
  return attempt(freshCookie);
}

// -----------------------------------------------------------------------------
// parseHTMLTable
//
// Parsing approach:
//   1. Strip all HTML comments and <script> blocks to reduce noise.
//   2. Find <tr>…</tr> blocks using regex.
//   3. Within each <tr>, find all <td>…</td> or <th>…</th> cells.
//   4. Strip inner HTML tags from each cell and decode basic HTML entities.
//   5. Return a 2D array: rows × cells.
//
// This approach avoids any external HTML parser dependency.
// It handles most MOPS table formats but may need adjustment if MOPS
// adds deeply nested tags or unusual whitespace in cell content.
// -----------------------------------------------------------------------------

export function parseHTMLTable(html: string): string[][] {
  // Remove comments and script blocks
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  const rows: string[][] = [];

  // Match each table row
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(cleaned)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];

    // Match each cell (td or th)
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      // Strip inner tags
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
      cells.push(text);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

/**
 * Extract HTML from a MOPS JSON response.
 * MOPS wraps table HTML in a JSON field — try common field names.
 */
function extractHTML(raw: string): string {
  try {
    const json = JSON.parse(raw);
    // MOPS uses various field names depending on the endpoint
    const html: string =
      json?.html ??
      json?.data ??
      json?.table ??
      json?.trs ??
      '';
    if (html) return html;
  } catch {
    // Not JSON — the raw text may already be HTML
  }
  // Fall back: treat entire response as HTML
  return raw;
}

// -----------------------------------------------------------------------------
// 1. fetchMonthlyRevenue
//
// NOTE: previously called MOPS's consumer-portal ajax endpoint
// (mops.twse.com.tw/mops/web/ajax_t05st10), which is now referer-walled and
// returns a "FOR SECURITY REASONS" block page for automated requests.
//
// Rewritten to use the official TWSE OpenAPI instead (t187ap05_L), which
// mirrors the same monthly-revenue disclosure data without that wall.
// This endpoint only serves the most recently published month — it does not
// support querying arbitrary past months — so it takes no parameters.
// -----------------------------------------------------------------------------

export async function fetchMonthlyRevenue(): Promise<
  { symbol: string; name_zh: string; revenue: number; yoy_growth: number; periodYYYMM: string }[]
> {
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap05_L', {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[fetchMonthlyRevenue] HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (!Array.isArray(json)) {
      console.error('[fetchMonthlyRevenue] Non-array response from TWSE OpenAPI');
      return [];
    }

    const results: { symbol: string; name_zh: string; revenue: number; yoy_growth: number; periodYYYMM: string }[] = [];

    for (const row of json as Record<string, string>[]) {
      const symbol = row['公司代號']?.trim();
      if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

      const name_zh     = row['公司名稱']?.trim() ?? '';
      const revenue     = parseFloat((row['營業收入-當月營收'] ?? '0').replace(/,/g, '')) || 0;
      const yoy_growth  = parseFloat((row['營業收入-去年同月增減(%)'] ?? '0').replace(/,/g, '')) || 0;
      const periodYYYMM = row['資料年月']?.trim() ?? '';

      results.push({ symbol, name_zh, revenue, yoy_growth, periodYYYMM });
    }

    console.log(`[fetchMonthlyRevenue] Fetched ${results.length} stocks via TWSE OpenAPI (t187ap05_L)`);
    return results;
  } catch (err) {
    console.error('[fetchMonthlyRevenue] Unexpected error:', err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// 2. fetchDividendData
// -----------------------------------------------------------------------------

export async function fetchDividendData(
  year: number,
): Promise<{ symbol: string; cash_dividend: number; ex_date: string }[]> {
  try {
    const rocYear = toROCYear(year);
    const raw = await mopsFetch('/mops/web/ajax_t05st09', {
      year: String(rocYear),
      type: 'sii',
    });

    if (!raw) return [];

    const html = extractHTML(raw);
    const rows = parseHTMLTable(html);

    // Expected columns: 公司代號, 公司名稱, 除息日期, 現金股利(元), 股票股利(元), ...
    const results: { symbol: string; cash_dividend: number; ex_date: string }[] = [];

    for (const row of rows) {
      const symbol = row[0]?.trim();
      if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

      // ex_date is stored in ROC format (e.g. "113/05/15") — convert to ISO
      const rawDate       = row[2]?.trim() ?? '';
      const ex_date       = convertROCDate(rawDate);
      const cash_dividend = parseFloat((row[3] ?? '0').replace(/,/g, '')) || 0;

      results.push({ symbol, cash_dividend, ex_date });
    }

    return results;
  } catch (err) {
    console.error('[fetchDividendData] Unexpected error:', err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// Date helper
// -----------------------------------------------------------------------------

/**
 * Convert a ROC date string (e.g. "113/05/15") to ISO format ("2024-05-15").
 * Returns the original string if parsing fails.
 */
function convertROCDate(rocDate: string): string {
  const parts = rocDate.split('/');
  if (parts.length !== 3) return rocDate;
  const [rocYear, month, day] = parts;
  const westernYear = parseInt(rocYear, 10) + 1911;
  return `${westernYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// 3. fetchMajorShareholders
// -----------------------------------------------------------------------------

export async function fetchMajorShareholders(
  symbol: string,
  year: number,
  quarter: number,
): Promise<{ holder_name: string; holder_type: string; shares_held: number; holding_pct: number }[]> {
  try {
    const rocYear = toROCYear(year);
    const raw = await mopsFetch('/mops/web/ajax_t04st04', {
      step:   '1',
      firstin:'1',
      year:   String(rocYear),
      season: String(quarter),
      co_id:  symbol,
      TYPEK:  'sii',
    });

    if (!raw) return [];

    const html = extractHTML(raw);
    const rows = parseHTMLTable(html);

    const results: { holder_name: string; holder_type: string; shares_held: number; holding_pct: number }[] = [];

    for (const row of rows) {
      const holder_name = row[0]?.trim();
      if (!holder_name || holder_name === '股東名稱' || holder_name === '姓名') continue;

      const shares_held = parseInt((row[2] ?? '0').replace(/,/g, ''), 10) || 0;
      const holding_pct = parseFloat((row[3] ?? '0').replace(/,/g, '')) || 0;

      results.push({
        holder_name,
        holder_type: 'major_10pct',
        shares_held,
        holding_pct,
      });
    }

    return results;
  } catch (err) {
    console.error('[fetchMajorShareholders] Unexpected error:', err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// 4. fetchDirectorHoldings
// -----------------------------------------------------------------------------

/**
 * Compute a ROC year/month N months back from today.
 * MOPS director-holdings data (stapap1) is published MONTHLY, not
 * quarterly, and typically isn't available for a given month until
 * partway through the following month.
 */
function getROCYearMonth(monthsAgo: number): { rocYear: number; month: number } {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  return { rocYear: toROCYear(d.getFullYear()), month: d.getMonth() + 1 };
}

async function fetchDirectorHoldingsForMonth(
  symbol: string,
  rocYear: number,
  month: number,
): Promise<{ holder_name: string; holder_type: string; shares_held: number; holding_pct: number; change_shares: number }[]> {
  // Endpoint corrected from the previous (wrong/defunct) ajax_t09se03 to the
  // actual page MOPS serves 董監事持股明細 from — confirmed against a working
  // reference implementation, not guessed. Full param set is required;
  // MOPS ignores/blank-responds to partial payloads on this endpoint.
  const raw = await mopsFetch('/mops/web/ajax_stapap1', {
    encodeURIComponent: '1',
    step:      '1',
    firstin:   '1',
    off:       '1',
    keyword4:  '',
    code1:     '',
    TYPEK2:    '',
    checkbtn:  '',
    queryName: 'co_id',
    inpuType:  'co_id',
    TYPEK:     'all',
    isnew:     'false',
    co_id:     symbol,
    year:      String(rocYear),
    month:     String(month).padStart(2, '0'),
  });

  if (!raw) return [];

  const html = extractHTML(raw);
  const rows = parseHTMLTable(html);
  if (rows.length === 0) return [];

  // The real table has a merged, two-row header (main columns + a sub-header
  // for "配偶、未成年子女及利用他人名義持有部份"). Rather than trust fixed
  // column positions — which broke once already on this table — find the
  // header row by content, then locate 職稱/姓名/持股/比例 columns by text.
  const headerIdx = rows.findIndex(r => r.some(c => c.includes('職稱')) && r.some(c => c.includes('姓名')));
  if (headerIdx === -1) return [];

  const header = rows[headerIdx];
  const titleCol = header.findIndex(c => c.includes('職稱'));
  const nameCol  = header.findIndex(c => c.includes('姓名'));
  // "目前持股" section: first 持股 column after the name column, and the
  // 比例 (percentage) column immediately following it.
  const sharesCol = header.findIndex((c, i) => i > nameCol && c.includes('持股') && !c.includes('比例'));
  const pctCol    = header.findIndex((c, i) => i > sharesCol && c.includes('比例'));

  if (titleCol === -1 || nameCol === -1 || sharesCol === -1) return [];

  const results: { holder_name: string; holder_type: string; shares_held: number; holding_pct: number; change_shares: number }[] = [];

  for (const row of rows.slice(headerIdx + 1)) {
    const holder_name = row[nameCol]?.trim();
    // Skip repeated header rows and blank rows
    if (!holder_name || holder_name === '姓名' || holder_name === '職稱' || holder_name === '') continue;

    const raw_type    = row[titleCol]?.trim() ?? '';
    const holder_type = raw_type.includes('監') ? 'supervisor' : 'director';
    const shares_held = parseInt((row[sharesCol] ?? '0').replace(/,/g, ''), 10) || 0;
    const holding_pct = pctCol > -1 ? parseFloat((row[pctCol] ?? '0').replace(/,/g, '')) || 0 : 0;

    results.push({ holder_name, holder_type, shares_held, holding_pct, change_shares: 0 });
  }

  return results;
}

export async function fetchDirectorHoldings(
  symbol: string,
): Promise<{ holder_name: string; holder_type: string; shares_held: number; holding_pct: number; change_shares: number }[]> {
  try {
    // Try last month first, then the month before, since MOPS publishes
    // monthly data with a lag and last month's may not be posted yet.
    for (const monthsAgo of [1, 2, 3]) {
      const { rocYear, month } = getROCYearMonth(monthsAgo);
      const results = await fetchDirectorHoldingsForMonth(symbol, rocYear, month);
      if (results.length > 0) return results;
    }
    return [];
  } catch (err) {
    console.error('[fetchDirectorHoldings] Unexpected error:', err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// 5. fetchBalanceSheet
// -----------------------------------------------------------------------------

/**
 * Fetches balance sheet data (資產負債表) from MOPS for all TWSE-listed stocks.
 * Endpoint: ajax_t164sb03
 *
 * Returns total assets and total liabilities, from which we compute:
 *   debt_ratio = total_liabilities / total_assets × 100
 *
 * MOPS season encoding: Q1=1, Q2=2, Q3=3, Q4=4
 *
 * @param year    Western year (e.g. 2025) — converted to ROC internally
 * @param season  1 | 2 | 3 | 4
 */
export async function fetchBalanceSheet(
  year: number,
  season: number,
): Promise<{ symbol: string; totalAssets: number; totalLiabilities: number; debtRatio: number }[]> {
  try {
    const rocYear = toROCYear(year);
    const raw = await mopsFetch('/mops/web/ajax_t164sb03', {
      encodeURIComponent: '1',
      step:     '1',
      firstin:  '1',
      off:      '1',
      keyword4: '',
      code1:    '',
      TYPEK:    'sii',
      isnew:    'false',
      year:     String(rocYear),
      season:   String(season),
    });

    if (!raw) return [];

    const html = extractHTML(raw);
    const rows = parseHTMLTable(html);

    // MOPS t164sb03 column layout (0-indexed):
    // 0: 公司代號, 1: 公司名稱, 2: 資產合計, 3: 負債合計
    const results: { symbol: string; totalAssets: number; totalLiabilities: number; debtRatio: number }[] = [];

    for (const row of rows) {
      const symbol = row[0]?.trim();
      if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

      const totalAssets      = parseFloat((row[2] ?? '0').replace(/,/g, '')) || 0;
      const totalLiabilities = parseFloat((row[3] ?? '0').replace(/,/g, '')) || 0;

      if (totalAssets <= 0) continue;

      const debtRatio = parseFloat(((totalLiabilities / totalAssets) * 100).toFixed(2));
      results.push({ symbol, totalAssets, totalLiabilities, debtRatio });
    }

    console.log(`[fetchBalanceSheet] ${year}Q${season}: ${results.length} stocks`);
    return results;
  } catch (err) {
    console.error('[fetchBalanceSheet] Unexpected error:', err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// 6. fetchBookValue
// -----------------------------------------------------------------------------

/**
 * Fetches book value per share (每股淨值) from MOPS for all TWSE-listed stocks.
 * Endpoint: ajax_t05st22
 *
 * Used to compute: pb_ratio = current_price / book_value_per_share
 *
 * @param year    Western year (e.g. 2025)
 * @param season  1 | 2 | 3 | 4
 */
export async function fetchBookValue(
  year: number,
  season: number,
): Promise<{ symbol: string; bookValuePerShare: number }[]> {
  try {
    const rocYear = toROCYear(year);
    const raw = await mopsFetch('/mops/web/ajax_t05st22', {
      encodeURIComponent: '1',
      step:     '1',
      firstin:  '1',
      off:      '1',
      keyword4: '',
      code1:    '',
      TYPEK:    'sii',
      isnew:    'false',
      year:     String(rocYear),
      season:   String(season),
    });

    if (!raw) return [];

    const html = extractHTML(raw);
    const rows = parseHTMLTable(html);

    // MOPS t05st22 column layout (0-indexed):
    // 0: 公司代號, 1: 公司名稱, 2: 基本EPS, 3: 稀釋EPS, 4: 每股淨值
    const results: { symbol: string; bookValuePerShare: number }[] = [];

    for (const row of rows) {
      const symbol = row[0]?.trim();
      if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

      const bookValue = parseFloat((row[4] ?? '0').replace(/,/g, '')) || 0;
      if (bookValue <= 0) continue;

      results.push({ symbol, bookValuePerShare: bookValue });
    }

    console.log(`[fetchBookValue] ${year}Q${season}: ${results.length} stocks`);
    return results;
  } catch (err) {
    console.error('[fetchBookValue] Unexpected error:', err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// 7. getLatestCompletedSeason
// -----------------------------------------------------------------------------

/**
 * Returns the most recently completed fiscal season for a given date.
 * MOPS data is published ~6 weeks after quarter end:
 *   Q4 (Oct–Dec) → published ~mid-March of following year
 *   Q1 (Jan–Mar) → published ~mid-May
 *   Q2 (Apr–Jun) → published ~mid-August
 *   Q3 (Jul–Sep) → published ~mid-November
 */
export function getLatestCompletedSeason(now: Date = new Date()): { year: number; season: number } {
  const month = now.getMonth() + 1; // 1-12
  const year  = now.getFullYear();

  if (month >= 11) return { year, season: 3 };
  if (month >= 8)  return { year, season: 2 };
  if (month >= 5)  return { year, season: 1 };
  return { year: year - 1, season: 4 };
}