// =============================================================================
// app/api/quote/[symbol]/route.ts
// GET /api/quote/2330
// Fetches 15-min delayed live price from TWSE/TPEx intraday API.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

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

    // TWSE field names
    // z = current price, o = open, h = high, l = low, v = volume
    // y = yesterday close, c = symbol, n = name
    const rawZ = parseFloat(d.z);
const bestAsk = parseFloat(d.a?.split('_')[0] ?? '');
const bestBid = parseFloat(d.b?.split('_')[0] ?? '');
const midpoint = (!isNaN(bestAsk) && !isNaN(bestBid) && bestAsk > 0 && bestBid > 0)
  ? (bestAsk + bestBid) / 2
  : null;
const close = (!isNaN(rawZ) && rawZ > 0)
  ? rawZ
  : (midpoint ?? parseFloat(d.y ?? '0'));
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
    });
  } catch (err) {
    console.error(`[quote/${symbol}]`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}