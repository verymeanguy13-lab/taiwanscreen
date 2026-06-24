// =============================================================================
// app/api/quote/[symbol]/route.ts
// GET /api/quote/2330
// During market hours: fetches live price from TWSE intraday API.
// After market close: returns yesterday's EOD data from daily_prices.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { isMarketOpen } from '@/lib/twseLive';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol?.toUpperCase().trim();
  if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });

  try {
    // Look up market from DB
    const rows = await queryUnsafe<{ market: string }>(
      `SELECT market FROM stocks WHERE symbol = $1`,
      [symbol],
    );
    const market = rows[0]?.market ?? 'TWSE';

    // ── After market close: return EOD data from DB ───────────────────────
    if (!isMarketOpen()) {
      const eod = await queryUnsafe<{
        close: string; open: string; high: string; low: string;
        volume: string; change_amt: string; change_pct: string; date: string;
      }>(
        `SELECT close, open, high, low, volume, change_amt, change_pct, date
         FROM daily_prices
         WHERE symbol = $1
         ORDER BY date DESC
         LIMIT 1`,
        [symbol],
      );
      if (!eod[0]) return NextResponse.json({ error: 'No data' }, { status: 404 });
      const q = eod[0];
      return NextResponse.json({
        symbol,
        close:      parseFloat(q.close),
        open:       parseFloat(q.open),
        high:       parseFloat(q.high),
        low:        parseFloat(q.low),
        volume:     parseFloat(q.volume),
        change_amt: parseFloat(q.change_amt ?? '0'),
        change_pct: parseFloat(q.change_pct ?? '0'),
        prev_close: parseFloat(q.close),
        name:       '',
        time:       null,
        market,
        isLive:     false,
      });
    }

    // ── Market open: fetch live price from TWSE ───────────────────────────
    const ex = market === 'TPEx' ? 'otc' : 'tse';
    const code = `${ex}_${symbol}.tw`;
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${code}&json=1&delay=0`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 0 },
    });

    if (!res.ok) throw new Error(`TWSE returned ${res.status}`);
    const raw = await res.json();
    const d = raw?.msgArray?.[0];
    if (!d) return NextResponse.json({ error: 'No data' }, { status: 404 });

    const rawZ     = parseFloat(d.z);
    const bestAsk  = parseFloat(d.a?.split('_')[0] ?? '');
    const bestBid  = parseFloat(d.b?.split('_')[0] ?? '');
    const midpoint = (!isNaN(bestAsk) && !isNaN(bestBid) && bestAsk > 0 && bestBid > 0)
      ? (bestAsk + bestBid) / 2
      : null;
    const close     = (!isNaN(rawZ) && rawZ > 0) ? rawZ : (midpoint ?? parseFloat(d.y ?? '0'));
    const open      = parseFloat(d.o ?? '0');
    const high      = parseFloat(d.h ?? '0');
    const low       = parseFloat(d.l ?? '0');
    const volume    = parseFloat(d.v ?? '0');
    const prevClose = parseFloat(d.y ?? '0');
    const changeAmt = prevClose > 0 ? close - prevClose : 0;
    const changePct = prevClose > 0 ? (changeAmt / prevClose) * 100 : 0;

    return NextResponse.json({
      symbol,
      close,
      open,
      high,
      low,
      volume,
      change_amt: Math.round(changeAmt * 100) / 100,
      change_pct: Math.round(changePct * 100) / 100,
      prev_close: prevClose,
      name:       d.n ?? '',
      time:       d.t ?? '',
      market,
      isLive:     true,
    });

  } catch (err) {
    console.error(`[quote/${symbol}]`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}