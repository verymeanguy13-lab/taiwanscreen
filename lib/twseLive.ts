// lib/twseLive.ts — TWSE bulk intraday price fetcher

export interface LiveQuote {
  symbol: string;
  price: number;
  isLive: boolean;
}

export function inferExchange(symbol: string): 'tse' | 'otc' {
  const n = parseInt(symbol, 10);
  if (isNaN(n)) return 'tse';
  return n >= 7000 ? 'otc' : 'tse';
}

export function isMarketOpen(): boolean {
  // Taiwan is UTC+8 year-round (no DST) — compute directly via millisecond
  // offset rather than round-tripping through toLocaleString(), which
  // depends on the runtime's ICU/locale data and has been an unreliable
  // source of Taiwan-timezone bugs elsewhere in this codebase (see the
  // large-orders route fix). Direct offset math has no such dependency.
  const now = new Date();
  const taipeiMs = now.getTime() + 8 * 60 * 60 * 1000;
  const taipei = new Date(taipeiMs);
  const day = taipei.getUTCDay();
  const minuteOfDay = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  // Extended to 18:30 (1110 min) so TWSE MIS still serves final closing price
  // after market close (13:30) until our cron ingests EOD data at 18:30.
  return day >= 1 && day <= 5 && minuteOfDay >= 540 && minuteOfDay < 1110;
}

/**
 * Current Taiwan date (YYYY-MM-DD) and minute-of-day, using the same
 * reliable UTC+8 math as isMarketOpen(). Used by the quote route to detect
 * the post-close-but-pre-cron window (13:30–18:30) where TWSE's live MIS
 * `z` field can still reflect the last continuous-trading tick rather than
 * the closing-auction-settled price, so daily_prices (if already populated
 * for today) should be preferred over the raw live tick.
 */
export function getTaipeiNow(): { date: string; minuteOfDay: number } {
  const now = new Date();
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const date = taipei.toISOString().slice(0, 10);
  const minuteOfDay = taipei.getUTCHours() * 60 + taipei.getUTCMinutes();
  return { date, minuteOfDay };
}

export async function fetchLivePrices(
  symbols: string[],
  exchange: 'tse' | 'otc'
): Promise<LiveQuote[]> {
  if (symbols.length === 0) return [];
  const exCh = symbols.map(s => `${exchange}_${s}.tw`).join('|');
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exCh)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const json = await res.json();
    const msgArray = json?.msgArray ?? [];
    return (msgArray as any[])
      .map(item => {
        const zVal = item.z && item.z !== '-' ? parseFloat(item.z) : null;
        const yVal = item.y ? parseFloat(item.y) : null;
        return {
          symbol: item.c,
          price: zVal ?? yVal ?? 0,
          isLive: zVal !== null,
        };
      })
      .filter(q => q.price > 0);
  } catch (err) {
    console.error('[twseLive] fetchLivePrices error:', err);
    return [];
  }
}

export async function fetchLivePricesBatch(
  stocks: { symbol: string; exchange: 'tse' | 'otc' }[]
): Promise<Map<string, LiveQuote>> {
  const result = new Map<string, LiveQuote>();
  if (stocks.length === 0) return result;

  const tseSymbols = stocks.filter(s => s.exchange === 'tse').map(s => s.symbol);
  const otcSymbols = stocks.filter(s => s.exchange === 'otc').map(s => s.symbol);

  function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  const batches = [
    ...chunk(tseSymbols, 100).map(b => fetchLivePrices(b, 'tse')),
    ...chunk(otcSymbols, 100).map(b => fetchLivePrices(b, 'otc')),
  ];

  const allResults = await Promise.all(batches);
  for (const quotes of allResults) {
    for (const q of quotes) result.set(q.symbol, q);
  }
  return result;
}