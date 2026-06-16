// =============================================================================
// lib/largeOrders.ts
// Fetch and parse large block trades (大單) from TWSE TWT38U endpoint.
// A "large order" = any single broker transaction >= 100 lots in one day.
// A "consecutive order" = same broker buying/selling the same stock 3+ days.
// =============================================================================

export type LargeOrder = {
  symbol:     string;
  date:       string;   // YYYY-MM-DD
  time?:      string;
  price:      number;
  volume:     number;   // in lots (張)
  direction:  'BUY' | 'SELL';
  brokerCode: string;
  brokerName: string;
  orderType:  'block' | 'consecutive' | 'single_lot';
};

export type ConsecutiveBuyer = {
  brokerCode:      string;
  brokerName:      string;
  direction:       'BUY' | 'SELL';
  consecutiveDays: number;
  totalVolume:     number;
  avgPrice:        number;
};

// ---------------------------------------------------------------------------
// Internal: parse TWT38U response for a single date
// Response fields (zero-indexed per TWSE spec):
//   [0] 券商代號  [1] 券商名稱  [2] 買進股數  [3] 賣出股數  [4] 差異
// ---------------------------------------------------------------------------
interface TWT38URow {
  brokerCode: string;
  brokerName: string;
  buyShares:  number;   // 買進股數 (股)
  sellShares: number;   // 賣出股數 (股)
}

async function fetchTWT38UForDate(symbol: string, yyyyMMdd: string): Promise<TWT38URow[]> {
  const url =
    `https://www.twse.com.tw/rwd/zh/fund/TWT38U` +
    `?stockNo=${encodeURIComponent(symbol)}&date=${yyyyMMdd}&response=json`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 TaiwanScreen/1.0' },
    next: { revalidate: 3600 },
  });

  if (!res.ok) return [];

  let json: { stat?: string; data?: string[][] } = {};
  try { json = await res.json(); } catch { return []; }

  if (json.stat !== 'OK' || !Array.isArray(json.data)) return [];

  return json.data
    .map((row) => {
      // Strip commas from numbers
      const clean = (v: string) => Number((v ?? '0').replace(/,/g, ''));
      return {
        brokerCode: row[0]?.trim() ?? '',
        brokerName: row[1]?.trim() ?? '',
        buyShares:  clean(row[2]),
        sellShares: clean(row[3]),
      };
    })
    .filter((r) => r.brokerCode !== '' && r.brokerCode !== '合計');
}

// ---------------------------------------------------------------------------
// Convert shares → lots (1 lot = 1,000 shares)
// ---------------------------------------------------------------------------
const sharesPerLot = 1_000;
const largeOrderThreshold = 100; // lots

// ---------------------------------------------------------------------------
// fetchLargeOrders — get large block trades for a symbol on a given date
// ---------------------------------------------------------------------------
export async function fetchLargeOrders(
  symbol: string,
  date: string,   // YYYY-MM-DD
): Promise<LargeOrder[]> {
  const yyyyMMdd = date.replace(/-/g, '');
  const rows = await fetchTWT38UForDate(symbol, yyyyMMdd);

  const orders: LargeOrder[] = [];

  for (const row of rows) {
    const buyLots  = Math.floor(row.buyShares  / sharesPerLot);
    const sellLots = Math.floor(row.sellShares / sharesPerLot);

    if (buyLots >= largeOrderThreshold) {
      orders.push({
        symbol,
        date,
        price:      0,   // TWT38U doesn't include price; caller can enrich if needed
        volume:     buyLots,
        direction:  'BUY',
        brokerCode: row.brokerCode,
        brokerName: row.brokerName,
        orderType:  'block',
      });
    }
    if (sellLots >= largeOrderThreshold) {
      orders.push({
        symbol,
        date,
        price:      0,
        volume:     sellLots,
        direction:  'SELL',
        brokerCode: row.brokerCode,
        brokerName: row.brokerName,
        orderType:  'block',
      });
    }
  }

  return orders.sort((a, b) => b.volume - a.volume);
}

// ---------------------------------------------------------------------------
// getPastTradingDates — produce the last N calendar dates (excluding weekends)
// We can't query TWSE for future/holidays reliably; caller may pass dates directly.
// ---------------------------------------------------------------------------
function getPastTradingDates(n: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  while (dates.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates; // newest first
}

// ---------------------------------------------------------------------------
// detectConsecutiveBuyers — find brokers buying/selling 3+ consecutive days
// ---------------------------------------------------------------------------
export async function detectConsecutiveBuyers(
  symbol: string,
  days: number = 5,
): Promise<ConsecutiveBuyer[]> {
  const dates = getPastTradingDates(Math.min(days, 30));

  // Fetch all dates in parallel (rate-limit: TWSE allows ~5 rps)
  const perDateRows = await Promise.all(
    dates.map(async (date) => {
      const yyyyMMdd = date.replace(/-/g, '');
      const rows = await fetchTWT38UForDate(symbol, yyyyMMdd);
      return { date, rows };
    }),
  );

  // Build per-broker timeline: { brokerCode → { date → { buy, sell } } }
  type DayData = { buy: number; sell: number };
  const timeline: Map<string, { name: string; days: Map<string, DayData> }> = new Map();

  for (const { date, rows } of perDateRows) {
    for (const row of rows) {
      if (!timeline.has(row.brokerCode)) {
        timeline.set(row.brokerCode, { name: row.brokerName, days: new Map() });
      }
      timeline.get(row.brokerCode)!.days.set(date, {
        buy:  Math.floor(row.buyShares  / sharesPerLot),
        sell: Math.floor(row.sellShares / sharesPerLot),
      });
    }
  }

  const results: ConsecutiveBuyer[] = [];
  const sortedDates = [...dates].sort(); // oldest first for streak counting

  for (const [brokerCode, { name, days }] of timeline) {
    // Check BUY streak
    let buyStreak = 0;
    let buyVol = 0;
    let buyPriceSum = 0; // price is 0 from TWT38U; placeholder
    for (const date of sortedDates) {
      const d = days.get(date);
      if (d && d.buy >= largeOrderThreshold) {
        buyStreak++;
        buyVol += d.buy;
      } else {
        buyStreak = 0;
        buyVol = 0;
      }
    }

    // Check SELL streak
    let sellStreak = 0;
    let sellVol = 0;
    for (const date of sortedDates) {
      const d = days.get(date);
      if (d && d.sell >= largeOrderThreshold) {
        sellStreak++;
        sellVol += d.sell;
      } else {
        sellStreak = 0;
        sellVol = 0;
      }
    }

    if (buyStreak >= 3) {
      results.push({
        brokerCode,
        brokerName:      name,
        direction:       'BUY',
        consecutiveDays: buyStreak,
        totalVolume:     buyVol,
        avgPrice:        0, // enrich from daily_prices if needed
      });
    }
    if (sellStreak >= 3) {
      results.push({
        brokerCode,
        brokerName:      name,
        direction:       'SELL',
        consecutiveDays: sellStreak,
        totalVolume:     sellVol,
        avgPrice:        0,
      });
    }
  }

  return results.sort((a, b) => b.consecutiveDays - a.consecutiveDays || b.totalVolume - a.totalVolume);
}