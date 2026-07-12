// app/api/admin/backfill-twse-sector/route.ts
//
// One-shot, lightweight sector backfill for TWSE-listed stocks. Deliberately
// kept OUT of ingestStockList/fetchStockList (which is called every day as
// part of the cron chain and was already stripped down once before to avoid
// Vercel Hobby's 10s timeout) -- this does exactly one HTML fetch + one bulk
// SQL UPDATE (via unnest arrays instead of ~1000+ sequential per-row
// upserts), so it should complete in a few seconds. Sector rarely changes,
// so this only needs to be run occasionally (e.g. after a batch of new IPOs
// or once to backfill the ~1,090 stocks that were missing it), not daily.
//
// NOTE: the strMode=2 ISIN page lists ALL listed securities (stocks, ETFs,
// bonds, TDRs, warrants, preferred shares, etc), not just common stocks --
// likely a much larger page than the TPEx (strMode=4) one. Wrapped every
// step in try/catch with timing so a failure (timeout, bad response shape,
// regex taking too long) surfaces a real error instead of a bare 500.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();

  let html: string;
  try {
    const res = await fetch('https://isin.twse.com.tw/isin/C_public.jsp?strMode=2', {
      headers: { 'Accept': 'text/html' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `ISIN fetch HTTP ${res.status}`, elapsedMs: Date.now() - t0 }, { status: 502 });
    }
    html = await res.text();
  } catch (err) {
    return NextResponse.json(
      { error: 'ISIN fetch failed (timeout or network error)', detail: String(err), elapsedMs: Date.now() - t0 },
      { status: 502 },
    );
  }

  const t1 = Date.now();
  const htmlLength = html.length;

  let symbols: string[] = [];
  let sectors: string[] = [];
  try {
    const rowRegex = /<tr>[\s\S]*?<td[^>]*>(\d{4,6}[A-Z0-9]*)\u3000([^<]+)<\/td>[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>上市<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/g;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const symbol = match[1].trim();
      const sector = match[3].trim();
      if (/^\d{4}$/.test(symbol) && sector) {
        symbols.push(symbol);
        sectors.push(sector);
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Regex parsing failed', detail: String(err), htmlLength, elapsedMs: Date.now() - t0 },
      { status: 500 },
    );
  }

  const t2 = Date.now();

  if (symbols.length === 0) {
    return NextResponse.json(
      {
        error: 'No rows parsed from ISIN page -- page structure may have changed',
        htmlLength,
        htmlPreview: html.slice(0, 500),
        fetchMs: t1 - t0,
        parseMs: t2 - t1,
      },
      { status: 500 },
    );
  }

  try {
    // Single bulk UPDATE via unnest(), instead of one query per symbol.
    const result = await queryUnsafe<{ symbol: string }>(
      `UPDATE stocks s
       SET sector = v.sector
       FROM (SELECT unnest($1::text[]) AS symbol, unnest($2::text[]) AS sector) v
       WHERE s.symbol = v.symbol
         AND s.market = 'TWSE'
       RETURNING s.symbol`,
      [symbols, sectors],
    );

    const t3 = Date.now();

    return NextResponse.json({
      parsedFromPage: symbols.length,
      updatedInDb: result.length,
      htmlLength,
      fetchMs: t1 - t0,
      parseMs: t2 - t1,
      dbMs:    t3 - t2,
      totalMs: t3 - t0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Database update failed',
        detail: String(err),
        parsedFromPage: symbols.length,
        fetchMs: t1 - t0,
        parseMs: t2 - t1,
        elapsedMs: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}