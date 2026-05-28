// =============================================================================
// lib/twse.ts — TWSE OpenAPI client
// =============================================================================

const BASE_URL = 'https://openapi.twse.com.tw';

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
  symbol:   string;
  name_zh:  string;
  sector:   string;
}

export interface RawETFData {
  symbol:    string;
  name_zh:   string;
  nav:       number;
  close:     number;
  volume:    number;
  change_pct: number;
}

export interface RawFundamentals {
  symbol:         string;
  pe_ratio:       number | null;
  pb_ratio:       number | null;
  dividend_yield: number | null;
}

function parseNum(val: string | undefined | null): number {
  if (!val) return 0;
  return parseFloat(String(val).replace(/,/g, '')) || 0;
}

function parseNumNullable(val: string | undefined | null): number | null {
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

export async function fetchAllStockPrices(): Promise<RawStockPrice[]> {
  try {
    type TWSEStockDay = {
      Code:          string;
      Name:          string;
      TradeVolume:   string;
      OpeningPrice:  string;
      HighestPrice:  string;
      LowestPrice:   string;
      ClosingPrice:  string;
      Change:        string;
    };

    const rows = await twseFetch<TWSEStockDay>('/v1/exchangeReport/STOCK_DAY_ALL');

    return rows
      .filter(r => r.Code && r.ClosingPrice && r.ClosingPrice !== '--')
      .map(r => {
        const close      = parseNum(r.ClosingPrice);
        const change_amt = parseNum(r.Change);
        const prevClose  = close - change_amt;
        const change_pct = prevClose !== 0 ? (change_amt / prevClose) * 100 : 0;
        return {
          symbol:     r.Code.trim(),
          name_zh:    r.Name.trim(),
          volume:     parseNum(r.TradeVolume),
          open:       parseNum(r.OpeningPrice),
          high:       parseNum(r.HighestPrice),
          low:        parseNum(r.LowestPrice),
          close,
          change_amt,
          change_pct: Math.round(change_pct * 100) / 100,
        };
      });
  } catch (err) {
    console.error('[fetchAllStockPrices] Unexpected error:', err);
    return [];
  }
}

export async function fetchInstitutionalFlows(): Promise<RawInstitutionalFlow[]> {
  try {
    const rows = await twseFetch<Record<string, string>>('/v1/fund/T86');
    if (rows.length === 0) return [];

    return rows
      .filter(r => r['證券代號'] && r['證券代號'].trim())
      .map(r => {
        const foreign_buy  = parseNum(r['外陸資買進股數']);
        const foreign_sell = parseNum(r['外陸資賣出股數']);
        const foreign_net  = parseNum(r['外陸資淨買股數']) || (foreign_buy - foreign_sell);
        const trust_buy    = parseNum(r['投信買進股數']);
        const trust_sell   = parseNum(r['投信賣出股數']);
        const trust_net    = parseNum(r['投信淨買股數']) || (trust_buy - trust_sell);
        const dealer_buy   = parseNum(r['自營商買進股數(自行買賣)']) + parseNum(r['自營商買進股數(避險)']);
        const dealer_sell  = parseNum(r['自營商賣出股數(自行買賣)']) + parseNum(r['自營商賣出股數(避險)']);
        const dealer_net   = (parseNum(r['自營商淨買股數(自行買賣)']) + parseNum(r['自營商淨買股數(避險)'])) || (dealer_buy - dealer_sell);
        const total_net    = parseNum(r['三大法人買賣超股數']) || (foreign_net + trust_net + dealer_net);
        return { symbol: r['證券代號'].trim(), foreign_buy, foreign_sell, foreign_net, trust_buy, trust_sell, trust_net, dealer_buy, dealer_sell, dealer_net, total_net };
      });
  } catch (err) {
    console.error('[fetchInstitutionalFlows] Unexpected error:', err);
    return [];
  }
}

export async function fetchMarginData(): Promise<RawMarginData[]> {
  try {
    type TWSEMargin = {
      '股票代號': string;
      '融資買進': string;
      '融資賣出': string;
      '融資餘額': string;
      '融資前日餘額': string;
      '融券賣出': string;
      '融券買進': string;
      '融券餘額': string;
      '融券前日餘額': string;
    };

    const rows = await twseFetch<TWSEMargin>('/v1/exchangeReport/MI_MARGN');
    return rows
      .filter(r => r['股票代號'])
      .map(r => {
        const margin_balance = parseNum(r['融資餘額']);
        const short_balance  = parseNum(r['融券餘額']);
        return {
          symbol:         r['股票代號'].trim(),
          margin_buy:     parseNum(r['融資買進']),
          margin_sell:    parseNum(r['融資賣出']),
          margin_balance,
          margin_change:  margin_balance - parseNum(r['融資前日餘額']),
          short_sell:     parseNum(r['融券賣出']),
          short_buy:      parseNum(r['融券買進']),
          short_balance,
          short_change:   short_balance - parseNum(r['融券前日餘額']),
        };
      });
  } catch (err) {
    console.error('[fetchMarginData] Unexpected error:', err);
    return [];
  }
}

export async function fetchStockList(): Promise<RawStockInfo[]> {
  try {
    type TWSEStockInfo = { '公司代號': string; '公司簡稱': string; '產業類別': string };
    const rows = await twseFetch<TWSEStockInfo>('/v1/opendata/t187ap03_L');
    return rows
      .filter(r => r['公司代號'])
      .map(r => ({
        symbol:  r['公司代號'].trim(),
        name_zh: r['公司簡稱']?.trim() ?? '',
        sector:  r['產業類別']?.trim() ?? '',
      }));
  } catch (err) {
    console.error('[fetchStockList] Unexpected error:', err);
    return [];
  }
}

export async function fetchETFPrices(): Promise<RawETFData[]> {
  try {
    type TWSEETFDay = { '基金代號': string; '基金名稱': string; '淨值': string; '收盤價': string; '成交量': string; '漲跌幅': string };
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
        if (close > 0) results.push({ date: dateStr, open: parseNum(row[3]), high: parseNum(row[4]), low: parseNum(row[5]), close, volume: parseNum(row[1]), change_amt, change_pct });
      } catch { /* skip */ }
    }
    return results;
  } catch (err) {
    console.error(`[fetchHistoricalPrices] Error for ${symbol}:`, err);
    return [];
  }
}

// -----------------------------------------------------------------------------
// fetchFundamentals
// Uses TWSE BWIBBU_ALL (PE/PB/yield for dividend-paying stocks)
// AND PBX_ALL (PB ratio for all stocks) to get broader coverage.
// -----------------------------------------------------------------------------

export async function fetchFundamentals(): Promise<RawFundamentals[]> {
  try {
    // Primary: BWIBBU_ALL — PE, PB, yield (only stocks with recent dividends)
    type BWIBBU = {
      Code:         string;
      '殖利率(%)':  string;
      '本益比':     string;
      '股價淨值比': string;
    };

    // Secondary: PBX — PB ratio for ALL listed stocks
    type PBX = {
      '證券代號': string;
      '本益比':   string;
      '股價淨值比': string;
      '殖利率':   string;
    };

    const [bwiRows, pbxRows] = await Promise.all([
      twseFetch<BWIBBU>('/v1/exchangeReport/BWIBBU_ALL'),
      twseFetch<PBX>('/v1/exchangeReport/PBX'),
    ]);

    console.log(`[fetchFundamentals] BWIBBU_ALL: ${bwiRows.length} rows, PBX: ${pbxRows.length} rows`);

    // Build map from PBX first (broader coverage)
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

    // Overlay BWIBBU (more accurate for dividend stocks)
    for (const r of bwiRows) {
      const symbol = r.Code?.trim();
      if (!symbol) continue;
      const existing = map.get(symbol);
      map.set(symbol, {
        symbol,
        pe_ratio:       parseNumNullable(r['本益比'])       ?? existing?.pe_ratio       ?? null,
        pb_ratio:       parseNumNullable(r['股價淨值比'])   ?? existing?.pb_ratio       ?? null,
        dividend_yield: parseNumNullable(r['殖利率(%)'])    ?? existing?.dividend_yield ?? null,
      });
    }

    console.log(`[fetchFundamentals] Combined: ${map.size} unique symbols`);
    return Array.from(map.values());
  } catch (err) {
    console.error('[fetchFundamentals] Unexpected error:', err);
    return [];
  }
}
