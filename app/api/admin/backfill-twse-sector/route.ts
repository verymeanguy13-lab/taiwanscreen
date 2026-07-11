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

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const res = await fetch('https://isin.twse.com.tw/isin/C_public.jsp?strMode=2', {
    headers: { 'Accept': 'text/html' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `ISIN fetch HTTP ${res.status}` }, { status: 502 });
  }

  const html = await res.text();
  const rowRegex = /<tr>[\s\S]*?<td[^>]*>(\d{4,6}[A-Z0-9]*)\u3000([^<]+)<\/td>[\s\S]*?<td[^>]*>[^<]*<\/td>[\s\S]*?<td[^>]*>上市<\/td>[\s\S]*?<td[^>]*>([^<]*)<\/td>/g;

  const symbols: string[] = [];
  const sectors: string[] = [];
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const symbol = match[1].trim();
    const sector = match[3].trim();
    if (/^\d{4}$/.test(symbol) && sector) {
      symbols.push(symbol);
      sectors.push(sector);
    }
  }

  if (symbols.length === 0) {
    return NextResponse.json(
      { error: 'No rows parsed from ISIN page -- page structure may have changed' },
      { status: 500 },
    );
  }

  // Single bulk UPDATE via unnest(), instead of one query per symbol --
  // this is the part that made the combined ingestStockList approach too
  // slow (roughly ~2000 sequential awaited round-trips to Neon).
  const result = await queryUnsafe<{ symbol: string }>(
    `UPDATE stocks s
     SET sector = v.sector
     FROM (SELECT unnest($1::text[]) AS symbol, unnest($2::text[]) AS sector) v
     WHERE s.symbol = v.symbol
       AND s.market = 'TWSE'
     RETURNING s.symbol`,
    [symbols, sectors],
  );

  return NextResponse.json({
    parsedFromPage: symbols.length,
    updatedInDb: result.length,
  });
}