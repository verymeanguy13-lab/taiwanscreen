// =============================================================================
// lib/twse.ts — TWSE + TPEx OpenAPI client
// Primary EOD price source: MI_INDEX (TWSE) + TPEx aftertrading endpoint
// These return final verified closing prices, unlike STOCK_DAY_ALL which may
// reflect incomplete intraday data if queried before TWSE finishes publishing.
// =============================================================================

const BASE_URL      = 'https://openapi.twse.com.tw';
const TPEX_BASE_URL = 'https://www.tpex.org.tw';

export interface RawStockPrice {
  symbol:     string;
  name_zh:    string;
  volume:     number;
  open:       number;
  high:       number;
  low:        number;
  close:      number;
  change_amt: number;
  change_pct: number;
}

export interface RawInstitutionalFlow {
  symbol:      string;
  foreign_buy:  number;
  foreign_sell: number;
  foreign_net:  number;
  trust_buy:    number;
  trust_sell:   number;
  trust_net:    number;
  dealer_buy:   number;
  dealer_sell:  number;
  dealer_net:   number;
  total_net:    number;
}

export interface RawMarginData {
  symbol:         string;
  margin_buy:     number;
  margin_sell:    number;
  margin_balance: number;
  margin_change:  number;
  short_sell:     number;
  short_buy:      number;
  short_balance:  number;
  short_change:   number;
}

export interface RawStockInfo {
  symbol:             string;
  name_zh:            string;
  sector:             string;
  market:             'TWSE' | 'TPEx';
  shares_outstanding: number | null;
}

export interface RawETFData {
  symbol:     string;
  name_zh:    string;
  nav:        number;
  close:      number;
  volume:     number;
  change_pct: number;
}

export interface RawFundamentals {
  symbol:         string;
  pe_ratio:       number | null;
  pb_ratio:       number | null;
  dividend_yield: number | null;
}

export function parseNum(val: string | undefined | null): number {
  if (!val) return 0;
  return parseFloat(String(val).replace(/,/g, '')) || 0;
}

export function parseNumNullable(val: string | undefined | null): number | null {
  if (!val || val === '--' || val === '-' || val.trim() === '') return null;
  const n = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

async function twseFetch<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[twseFetch] HTTP ${res.status} for ${path}`);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error(`[twseFetch] Non-array response for ${path}`);
      return [];
    }
    return data as T[];
  } catch (err) {
    console.error(`[twseFetch] Failed to fetch ${path}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// fetchAllStockPrices — uses MI_INDEX (TWSE) + TPEx aftertrading as primary
// sources for final verified EOD prices.
//
// Pass `yyyymmdd` (e.g. "20250617") to fetch a specific date; omit or pass
// undefined to use today's Taiwan date.
// ---------------------------------------------------------------------------
export async function fetchAllStockPrices(yyyymmdd?: string): Promise<RawStockPrice[]> {
  // Derive Taiwan date string if not provided
  const dateStr = yyyymmdd ?? (() => {
    const now = new Date();
    const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const y   = tw.getUTCFullYear();
    const m   = String(tw.getUTCMonth() + 1).padStart(2, '0');
    const d   = String(tw.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  })();

  const clean = (s: string) => parseFloat(String(s).replace(/,/g, '').trim()) || 0;

  // ── TWSE: MI_INDEX ────────────────────────────────────────────────────────
  const twsePrices: RawStockPrice[] = await (async () => {
    try {
      const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${dateStr}&type=ALLBUT0999`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        console.error(`[fetchAllStockPrices] TWSE MI_INDEX HTTP ${res.status}`);
        return [];
      }

      const json = await res.json();
      if (!json || json.stat !== 'OK' || !Array.isArray(json.tables)) {
        console.error('[fetchAllStockPrices] TWSE MI_INDEX bad response, stat:', json?.stat);
        return [];
      }

      // Find the price table: fields[0] contains '證券代號', length >= 9
      const tables = json.tables as Array<{ title?: string; fields?: string[]; data?: string[][] }>;
      const priceTable = tables.find(t =>
        Array.isArray(t.fields) && t.fields.length >= 9 && t.fields[0]?.includes('證券代號')
      );
      if (!priceTable?.data) {
        console.error('[fetchAllStockPrices] TWSE MI_INDEX: price table not found');
        return [];
      }

      const results: RawStockPrice[] = [];
      for (const row of priceTable.data) {
        if (row.length < 11) continue;
        const symbol = String(row[0]).trim();
        if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

        const name_zh    = String(row[1] ?? '').trim();
        const volume     = Math.round(clean(row[2]) / 1000); // shares → lots
        const open       = clean(row[5]);
        const high       = clean(row[6]);
        const low        = clean(row[7]);
        const close      = clean(row[8]);
        if (!close || close <= 0) continue;

        const direction = String(row[9] ?? '').trim();
        const sign = (direction.includes('-') && !direction.includes('+')) ? -1 : 1;
        const change_amt = sign * clean(row[10]);
        const prevClose  = close - change_amt;
        const change_pct = prevClose > 0
          ? Math.round((change_amt / prevClose) * 10000) / 100
          : 0;

        results.push({ symbol, name_zh, volume, open, high, low, close, change_amt, change_pct });
      }

      console.log(`[fetchAllStockPrices] TWSE MI_INDEX: ${results.length} stocks for ${dateStr}`);
      return results;
    } catch (err) {
      console.error('[fetchAllStockPrices] TWSE MI_INDEX fetch failed:', err);
      return [];
    }
  })();

  // ── TPEx: aftertrading final EOD ──────────────────────────────────────────
  const tpexPrices: RawStockPrice[] = await (async () => {
    try {
      const tpexDate = `${dateStr.slice(0, 4)}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`;
      const url = `https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?d=${encodeURIComponent(tpexDate)}&se=AL&s=0,asc&o=json`;

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        console.error(`[fetchAllStockPrices] TPEx HTTP ${res.status}`);
        return [];
      }

      const json = await res.json();
      // TPEx's response format changed at some point from the legacy
      // {"aaData": [...]} shape to a TWSE-MI_INDEX-style {"tables": [{fields,
      // data}]} shape. The old aaData check silently returned [] on every
      // request once this happened -- explaining why TPEx-listed stocks'
      // daily_prices froze at whatever date the format changed (observed:
      // 2026-06-05), while TWSE ingestion (unaffected) kept working fine.
      const tables = Array.isArray(json?.tables) ? json.tables : null;
      const priceTable = tables?.find((t: { fields?: string[] }) =>
        Array.isArray(t.fields) && t.fields.length >= 8 && t.fields[0]?.includes('代號')
      );
      if (!priceTable || !Array.isArray(priceTable.data)) {
        console.error('[fetchAllStockPrices] TPEx: unexpected response shape (no tables[].data found)');
        return [];
      }

      const results: RawStockPrice[] = [];
      for (const row of priceTable.data as string[][]) {
        if (!row || row.length < 8) continue;
        const symbol = String(row[0]).trim();
        if (!symbol || !/^\d{4,6}$/.test(symbol)) continue;

        const name_zh    = String(row[1] ?? '').trim();
        const close      = clean(row[2]);
        if (!close || close <= 0) continue;

        const changeRaw  = String(row[3] ?? '').replace(/,/g, '').replace(/^\+/, '');
        const change_amt = changeRaw === '---' || changeRaw === '' ? 0 : parseFloat(changeRaw) || 0;
        const open       = clean(row[4]);
        const high       = clean(row[5]);
        const low        = clean(row[6]);
        // NOTE: in the current tables[] field layout, 成交股數 (volume in
        // shares) is at index 7, not 8 -- index 8 is 成交金額(元) (trade
        // value in dollars). The old aaData-based row[8] was correct for
        // the legacy format but reads the wrong column here.
        const volume     = Math.round(clean(row[7]) / 1000); // shares → lots
        const prevClose  = close - change_amt;
        const change_pct = prevClose > 0
          ? Math.round((change_amt / prevClose) * 10000) / 100
          : 0;

        results.push({ symbol, name_zh, volume, open, high, low, close, change_amt, change_pct });
      }

      console.log(`[fetchAllStockPrices] TPEx: ${results.length} stocks for ${dateStr}`);
      return results;
    } catch (err) {
      console.error('[fetchAllStockPrices] TPEx fetch failed:', err);
      return [];
    }
  })();

  // Merge: TWSE wins on conflict
  const merged = new Map<string, RawStockPrice>();
  for (const p of tpexPrices) merged.set(p.symbol, p);
  for (const p of twsePrices) merged.set(p.symbol, p);

  console.log(`[fetchAllStockPrices] Total combined: ${merged.size} stocks`);
  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// fetchInstitutionalFlows — accepts optional date (YYYYMMDD).
// Defaults to today's Taiwan date if not provided.
// ---------------------------------------------------------------------------
export async function fetchInstitutionalFlows(yyyymmdd?: string): Promise<RawInstitutionalFlow[]> {
  try {
    const dateStr = yyyymmdd ?? (() => {
      const now = new Date();
      const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      const y   = tw.getUTCFullYear();
      const m   = String(tw.getUTCMonth() + 1).padStart(2, '0');
      const d   = String(tw.getUTCDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    })();

    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateStr}&selectType=ALLBUT0999`;

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.error(`[fetchInstitutionalFlows] HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) {
      console.error('[fetchInstitutionalFlows] No data or bad stat:', json?.stat);
      return [];
    }

    const results: RawInstitutionalFlow[] = [];

    for (const row of json.data) {
      const symbol = String(row[0]).trim();
      if (!/^\d{4,6}$/.test(symbol)) continue;

      const foreign_buy  = parseNum(row[2]);
      const foreign_sell = parseNum(row[3]);
      const foreign_net  = parseNum(row[4]) || (foreign_buy - foreign_sell);
      const trust_buy    = parseNum(row[8]);
      const trust_sell   = parseNum(row[9]);
      const trust_net    = parseNum(row[10]) || (trust_buy - trust_sell);
      const dealer_buy   = parseNum(row[12]) + parseNum(row[15]);
      const dealer_sell  = parseNum(row[13]) + parseNum(row[16]);
      const dealer_net   = parseNum(row[11]) || (dealer_buy - dealer_sell);
      const total_net    = parseNum(row[18]) || (foreign_net + trust_net + dealer_net);

      results.push({
        symbol,
        foreign_buy, foreign_sell, foreign_net,
        trust_buy, trust_sell, trust_net,
        dealer_buy, dealer_sell, dealer_net,
        total_net,
      });
    }

    console.log(`[fetchInstitutionalFlows] Fetched ${results.length} stocks for ${dateStr}`);
    return results;
  } catch (err) {
    console.error('[fetchInstitutionalFlows] Unexpected error:', err);
    return [];
  }
}

export async function fetchMarginData(): Promise<RawMarginData[]> {
  try {
    type TWSEMargin = {
      '股票代號':     string;
      '融資買進':     string;
      '融資賣出':     string;
      '融資今日餘額': string;
      '融資前日餘額': string;
      '融券賣出':     string;
      '融券買進':     string;
      '融券今日餘額': string;
      '融券前日餘額': string;
    };

    const rows = await twseFetch<TWSEMargin>('/v1/exchangeReport/MI_MARGN');
    return rows
      .filter(r => r['股票代號'])
      .map(r => {
        const margin_balance = parseNum(r['融資今日餘額']);
        const short_balance  = parseNum(r['融券今日餘額']);
        return {
          symbol:        r['股票代號'].trim(),
          margin_buy:    parseNum(r['融資買進']),
          margin_sell:   parseNum(r['融資賣出']),
          margin_balance,
          margin_change: margin_balance - parseNum(r['融資前日餘額']),
          short_sell:    parseNum(r['融券賣出']),
          short_buy:     parseNum(r['融券買進']),
          short_balance,
          short_change:  short_balance - parseNum(r['融券前日餘額']),
        };
      });
  } catch (err) {
    console.error('[fetchMarginData] Unexpected error:', err);
    return [];
  }
}

export async function fetchStockList(): Promise<RawStockInfo[]> {
  try {
    type TWSEStockInfo = {
      '公司代號': string;
      '公司簡稱': string;
      '產業別': string; // NOTE: field is '產業別', not '產業類別' -- and even if
                         // read correctly it's a numeric code (e.g. "24"),
                         // not a readable name. Sector is now sourced from
                         // the ISIN scrape below instead; this field is kept
                         // only for reference/logging.
      '已發行普通股數或TDR原股發行股數': string;
    };

    const twseRows = await twseFetch<TWSEStockInfo>('/v1/opendata/t187ap03_L');

    // Build symbol -> readable sector name for TWSE-listed (上市) stocks via
    // the same ISIN lookup page already used below for TPEx (上櫃) sectors --
    // proven to correctly decode and return real Chinese sector names (e.g.
    // 半導體業). t187ap03_L's own sector field was previously read under the
    // wrong key name ('產業類別' vs the real '產業別'), which silently
    // blanked sector for all ~1,090 TWSE-listed stocks; and even fixing the
    // key name would only yield a numeric code, not a name matching the
    // Chinese sector strings used throughout the rest of the app.
    const twseSectorMap = new Map<string, string>();
    try {
      const res = await fetch('https://isin.twse.com.tw/isin/C_public.jsp?strMode=2', {
        headers: { 'Accept': 'text/html' },
        cache: 'no-store',
      });
      if (res.ok) {
        const html = await res.text();
        const rowRegex = /<tr>[\s\S]*?<td[^>]*>(\d{4,6}[A-Z0-9]*)\u3000([^<]+)<\/td>[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>上市<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/g;
        let match;
        while ((match = rowRegex.exec(html)) !== null) {
          const symbol = match[1].trim();
          const sector = match[3].trim();
          if (/^\d{4}$/.test(symbol) && sector) {
            twseSectorMap.set(symbol, sector);
          }
        }
        console.log(`[fetchStockList] TWSE sector map (ISIN scrape): ${twseSectorMap.size} entries`);
      } else {
        console.error(`[fetchStockList] TWSE ISIN sector scrape HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('[fetchStockList] TWSE ISIN sector scrape failed:', err);
    }

    const twseStocks: RawStockInfo[] = twseRows
      .filter(r => r['公司代號'])
      .map(r => ({
        symbol:             r['公司代號'].trim(),
        name_zh:            r['公司簡稱']?.trim() ?? '',
        sector:             twseSectorMap.get(r['公司代號'].trim()) ?? '',
        market:             'TWSE' as const,
        shares_outstanding: parseInt(r['已發行普通股數或TDR原股發行股數']?.replace(/,/g, '') ?? '0', 10) || null,
      }));

    let tpexStocks: RawStockInfo[] = [];
    try {
      const res = await fetch('https://isin.twse.com.tw/isin/C_public.jsp?strMode=4', {
        headers: { 'Accept': 'text/html' },
        cache: 'no-store',
      });
      if (res.ok) {
        const html = await res.text();
        const rowRegex = /<tr>[\s\S]*?<td[^>]*>(\d{4,6}[A-Z0-9]*)\u3000([^<]+)<\/td>[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>上櫃<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/g;
        let match;
        while ((match = rowRegex.exec(html)) !== null) {
          const symbol  = match[1].trim();
          const name_zh = match[2].trim();
          const sector  = match[3].trim();
          if (/^\d{4}$/.test(symbol)) {
            tpexStocks.push({ symbol, name_zh, sector, market: 'TPEx' as const, shares_outstanding: null });
          }
        }
        console.log(`[fetchStockList] TPEx: ${tpexStocks.length} stocks`);
      }
    } catch (err) {
      console.error('[fetchStockList] TPEx fetch failed:', err);
    }

    console.log(`[fetchStockList] TWSE: ${twseStocks.length}, TPEx: ${tpexStocks.length}`);
    return [...twseStocks, ...tpexStocks];
  } catch (err) {
    console.error('[fetchStockList] Unexpected error:', err);
    return [];
  }
}

export async function fetchETFPrices(): Promise<RawETFData[]> {
  try {
    type TWSEETFDay = {
      '基金代號': string;
      '基金名稱': string;
      '淨值':     string;
      '收盤價':   string;
      '成交量':   string;
      '漲跌幅':   string;
    };
    const rows = await twseFetch<TWSEETFDay>('/v1/ETF/DAY_TRADING');
    return rows
      .filter(r => r['基金代號'])
      .map(r => ({
        symbol:     r['基金代號'].trim(),
        name_zh:    r['基金名稱']?.trim() ?? '',
        nav:        parseNum(r['淨值']),
        close:      parseNum(r['收盤價']),
        volume:     parseNum(r['成交量']),
        change_pct: parseNum(r['漲跌幅']),
      }));
  } catch (err) {
    console.error('[fetchETFPrices] Unexpected error:', err);
    return [];
  }
}

export interface RawHistoricalPrice {
  date:       string;
  open:       number;
  high:       number;
  low:        number;
  close:      number;
  volume:     number;
  change_amt: number;
  change_pct: number;
}

export async function fetchHistoricalPrices(symbol: string, yyyymm: string): Promise<RawHistoricalPrice[]> {
  try {
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm}&stockNo=${symbol}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) return [];

    const results: RawHistoricalPrice[] = [];
    let prevClose: number | null = null;

    for (const row of json.data) {
      try {
        const parts = String(row[0]).split('/');
        if (parts.length !== 3) continue;
        const adYear  = parseInt(parts[0], 10) + 1911;
        const dateStr = `${adYear}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        const close      = parseNum(row[6]);
        const changeRaw  = String(row[7]).replace(/,/g, '');
        const change_amt = changeRaw.startsWith('+') || changeRaw.startsWith('-') ? parseFloat(changeRaw) || 0 : 0;
        const change_pct = prevClose && prevClose !== 0 ? Math.round((change_amt / prevClose) * 10000) / 100 : 0;
        prevClose = close;
        if (close > 0) results.push({
          date: dateStr,
          open: parseNum(row[3]),
          high: parseNum(row[4]),
          low:  parseNum(row[5]),
          close,
          volume:     parseNum(row[1]),
          change_amt,
          change_pct,
        });
      } catch { /* skip */ }
    }
    return results;
  } catch (err) {
    console.error(`[fetchHistoricalPrices] Error for ${symbol}:`, err);
    return [];
  }
}

export async function fetchFundamentals(): Promise<RawFundamentals[]> {
  try {
    type BWIBBU = {
      Code:          string;
      Name:          string;
      PEratio:       string;
      DividendYield: string;
      PBratio:       string;
    };

    type PBX = {
      '證券代號':   string;
      '本益比':     string;
      '股價淨值比': string;
      '殖利率':     string;
    };

    const [bwiRows, pbxRows] = await Promise.all([
      twseFetch<BWIBBU>('/v1/exchangeReport/BWIBBU_ALL'),
      twseFetch<PBX>('/v1/exchangeReport/PBX'),
    ]);

    console.log(`[fetchFundamentals] BWIBBU_ALL: ${bwiRows.length} rows, PBX: ${pbxRows.length} rows`);

    const map = new Map<string, RawFundamentals>();

    for (const r of pbxRows) {
      const symbol = r['證券代號']?.trim();
      if (!symbol) continue;
      map.set(symbol, {
        symbol,
        pe_ratio:       parseNumNullable(r['本益比']),
        pb_ratio:       parseNumNullable(r['股價淨值比']),
        dividend_yield: parseNumNullable(r['殖利率']),
      });
    }

    for (const r of bwiRows) {
      const symbol = r.Code?.trim();
      if (!symbol) continue;
      const existing = map.get(symbol);
      map.set(symbol, {
        symbol,
        pe_ratio:       parseNumNullable(r.PEratio)       ?? existing?.pe_ratio       ?? null,
        pb_ratio:       parseNumNullable(r.PBratio)       ?? existing?.pb_ratio       ?? null,
        dividend_yield: parseNumNullable(r.DividendYield) ?? existing?.dividend_yield ?? null,
      });
    }

    console.log(`[fetchFundamentals] Combined: ${map.size} unique symbols`);
    return Array.from(map.values());
  } catch (err) {
    console.error('[fetchFundamentals] Unexpected error:', err);
    return [];
  }
}