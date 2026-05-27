// lib/fugle.ts -- Fugle Market Data API intraday client
// Free tier: 5,000 calls/day. Quotes delayed 15 min on free tier.
// Docs: https://developer.fugle.tw/docs/data/market-data
// All functions return null or [] on error -- never throw.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RealtimeQuote {
  symbol:        string;
  price:         number;  // current / last trade price
  open:          number;
  high:          number;
  low:           number;
  volume:        number;  // cumulative lots traded today
  change:        number;  // price change vs yesterday close
  changePercent: number;  // % change
  prevClose:     number;
  limitUp:       number;  // prevClose * 1.1 rounded
  limitDown:     number;  // prevClose * 0.9 rounded
  time:          string;  // ISO timestamp of last quote
}

export interface IntradayTick {
  time:   string;         // HH:MM:SS
  price:  number;
  volume: number;         // lots in this tick
  side:   'B' | 'S' | 'U'; // Buy / Sell / Unknown
}

// ---------------------------------------------------------------------------
// Private helper
// ---------------------------------------------------------------------------

const BASE = 'https://api.fugle.tw/marketdata/v1.0/stock';

async function fugleFetch(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      headers: { 'X-API-KEY': process.env.FUGLE_API_KEY ?? '' },
      next: { revalidate: 0 }, // always fresh — intraday data
    });
    if (!res.ok) {
      console.error('fugleFetch', path, `HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('fugleFetch', path, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 1. getFugleQuote
// ---------------------------------------------------------------------------

export async function getFugleQuote(symbol: string): Promise<RealtimeQuote | null> {
  try {
    const data = await fugleFetch(`intraday/quote/${symbol}`) as Record<string, unknown> | null;
    if (!data) return null;

    const price     = (data.lastPrice as number) ?? (data.closePrice as number) ?? null;
    const prevClose = (data.previousClose as number) ?? null;

    if (price === null || prevClose === null) return null;

    const change        = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;
    const limitUp       = Math.round(prevClose * 1.1 * 100) / 100;
    const limitDown     = Math.round(prevClose * 0.9 * 100) / 100;

    // volume: Fugle returns shares, convert to lots (張 = 1000 shares)
    const rawVolume = (data.total as Record<string, unknown>)?.tradeVolume as number | undefined;
    const volume    = rawVolume !== undefined ? rawVolume : 0;

    return {
      symbol,
      price,
      open:          (data.openPrice  as number) ?? price,
      high:          (data.highPrice  as number) ?? price,
      low:           (data.lowPrice   as number) ?? price,
      volume,
      change,
      changePercent: Math.round(changePercent * 100) / 100,
      prevClose,
      limitUp,
      limitDown,
      time:          (data.lastUpdated as string) ?? new Date().toISOString(),
    };
  } catch (err) {
    console.error('fugleFetch', `intraday/quote/${symbol}`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. getFugleTicks
// ---------------------------------------------------------------------------

export async function getFugleTicks(symbol: string): Promise<IntradayTick[]> {
  try {
    const res = await fugleFetch(`intraday/trades/${symbol}`) as Record<string, unknown> | null;
    if (!res) return [];

    const rows = res.data as Record<string, unknown>[] | undefined;
    if (!Array.isArray(rows)) return [];

    return rows.map((t) => {
      // Extract HH:MM:SS from ISO timestamp e.g. "2026-05-27T09:01:30.000+08:00"
      const isoTime = (t.at as string) ?? '';
      const timePart = isoTime.includes('T')
        ? isoTime.split('T')[1].substring(0, 8)
        : isoTime.substring(0, 8);

      const rawVol = (t.volume as number) ?? 0;

      const rawSide = (t.side as string) ?? 'U';
      const side: 'B' | 'S' | 'U' =
        rawSide === 'B' ? 'B' : rawSide === 'S' ? 'S' : 'U';

      return {
        time:   timePart,
        price:  (t.price as number) ?? 0,
        volume: rawVol,
        side,
      };
    });
  } catch (err) {
    console.error('fugleFetch', `intraday/trades/${symbol}`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 3. getFugleQuoteBatch
// ---------------------------------------------------------------------------

export async function getFugleQuoteBatch(symbols: string[]): Promise<RealtimeQuote[]> {
  const results: RealtimeQuote[] = [];
  const batchSize = 50;
  const delay = 200; // ms between batches

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);

    const settled = await Promise.allSettled(
      batch.map((sym) => getFugleQuote(sym)),
    );

    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value !== null) {
        results.push(s.value);
      }
    }

    console.log(`Completed ${Math.min(i + batchSize, symbols.length)}/${symbols.length} quotes`);

    // Delay between batches (skip after last batch)
    if (i + batchSize < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 4. isMarketOpen
// ---------------------------------------------------------------------------

export function isMarketOpen(): boolean {
  const now = new Date();
  const taipei = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));

  const day    = taipei.getDay();    // 0 = Sun, 6 = Sat
  const hour   = taipei.getHours();
  const minute = taipei.getMinutes();

  if (day === 0 || day === 6) return false; // weekend

  const afterOpen  = hour > 9  || (hour === 9  && minute >= 0);
  const beforeClose = hour < 13 || (hour === 13 && minute <= 30);

  return afterOpen && beforeClose;
}
