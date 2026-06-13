// =============================================================================
// app/api/broker/scrape/route.ts
// GET /api/broker/scrape?symbol=2330&date=20260610
//
// Scrapes bsr.twse.com.tw for per-stock broker branch buy/sell data.
// Two-step process:
//   1. GET the page to extract ASP.NET ViewState + EventValidation tokens
//   2. POST with those tokens + stock number to get the data table
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';

function toTWSEDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function getLastBusinessDay(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return toTWSEDate(d);
}

function extractHidden(html: string, name: string): string {
  const re = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

export interface BrokerScrapeRow {
  broker_id:   string;
  broker_name: string;
  buy_volume:  number; // in lots (張)
  sell_volume: number;
  net_volume:  number;
}

async function scrapeBrokerData(symbol: string, date: string): Promise<BrokerScrapeRow[]> {
  const baseUrl = 'https://bsr.twse.com.tw/bshtm/bsMenu.aspx';

  // ── Step 1: GET the page to extract ViewState tokens ─────────────────────
  const getRes = await fetch(baseUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);
  const getHtml = await getRes.text();

  const viewState       = extractHidden(getHtml, '__VIEWSTATE');
  const viewStateGen    = extractHidden(getHtml, '__VIEWSTATEGENERATOR');
  const eventValidation = extractHidden(getHtml, '__EVENTVALIDATION');

  if (!viewState) throw new Error('Could not extract ViewState from bsr.twse.com.tw');

  // ── Step 2: POST with stock number and date ───────────────────────────────
  // Format date as MM/DD/YYYY for the form field
  const y = date.slice(0, 4);
  const m = date.slice(4, 6);
  const d = date.slice(6, 8);
  const formDate = `${m}/${d}/${y}`;

  const body = new URLSearchParams({
    '__VIEWSTATE':          viewState,
    '__VIEWSTATEGENERATOR': viewStateGen,
    '__EVENTVALIDATION':    eventValidation,
    'ctl00$ContentPlaceHolder1$txtStockNo': symbol,
    'ctl00$ContentPlaceHolder1$txtDate':    formDate,
    'ctl00$ContentPlaceHolder1$btnQuery':   '查詢',
  });

  const postRes = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Content-Type':   'application/x-www-form-urlencoded',
      'Accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language':'zh-TW,zh;q=0.9,en;q=0.8',
      'Referer':        baseUrl,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(20000),
  });

  if (!postRes.ok) throw new Error(`POST failed: ${postRes.status}`);
  const postHtml = await postRes.text();

  // ── Step 3: Parse the HTML table ──────────────────────────────────────────
  // The result table has rows like:
  // <tr><td>券商代號</td><td>券商名稱</td><td>買進股數</td><td>賣出股數</td></tr>
  const results: BrokerScrapeRow[] = [];

  // Find all table rows with broker data
  const rowRe = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  const rows = postHtml.match(rowRe) ?? [];

  for (const row of rows) {
    const cells: string[] = [];
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(row)) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());
    }

    if (cells.length < 4) continue;

    // Broker ID is typically 4 digits
    const broker_id = cells[0].trim();
    if (!/^\d{3,4}$/.test(broker_id)) continue;

    const broker_name = cells[1].trim();
    const buy_shares  = parseInt(cells[2].replace(/,/g, '')) || 0;
    const sell_shares = parseInt(cells[3].replace(/,/g, '')) || 0;

    // Convert shares → lots (張 = 1000 shares)
    const buy_volume  = Math.round(buy_shares  / 1000);
    const sell_volume = Math.round(sell_shares / 1000);

    if (buy_volume === 0 && sell_volume === 0) continue;

    results.push({
      broker_id,
      broker_name,
      buy_volume,
      sell_volume,
      net_volume: buy_volume - sell_volume,
    });
  }

  return results.sort((a, b) => Math.abs(b.net_volume) - Math.abs(a.net_volume));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get('symbol')?.trim().toUpperCase();
  const date   = searchParams.get('date') ?? getLastBusinessDay();

  if (!symbol || !/^\d{4,6}$/.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol' }, { status: 400 });
  }

  try {
    if (searchParams.get('debug') === '1') {
    const baseUrl = 'https://bsr.twse.com.tw/bshtm/bsMenu.aspx';
    const getRes = await fetch(baseUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await getRes.text();
    return new NextResponse(html.slice(0, 5000), { headers: { 'Content-Type': 'text/plain' } });
  }
    const rows = await scrapeBrokerData(symbol, date);
    return NextResponse.json(
      { symbol, date, rows, count: rows.length },
      { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=300' } },
    );
  } catch (err) {
    console.error('[broker/scrape]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}