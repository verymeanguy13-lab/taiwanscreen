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
// bonds, TDRs, warrants, preferred shares, etc) -- a much larger page than
// TPEx's (strMode=4). The original single lazy [\s\S]*? regex spanning the
// whole document was likely suffering catastrophic backtracking on a
// document this size, hanging well past Vercel's 10s limit instead of
// erroring cleanly. Rewritten to split on <tr> first (a cheap, linear
// string operation) and then run a small, bounded regex against each row
// individually -- no backtracking risk regardless of document size.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();

  let html: string;
  let contentType: string | null = null;
  try {
    const res = await fetch('https://isin.twse.com.tw/isin/C_public.jsp?strMode=2', {
      headers: {
        'Accept': 'text/html',
        'Accept-Charset': 'big5,utf-8;q=0.7,*;q=0.3',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible)',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `ISIN fetch HTTP ${res.status}`, elapsedMs: Date.now() - t0 }, { status: 502 });
    }
    contentType = res.headers.get('content-type');
    // This page is served in Big5 (standard for Taiwanese gov/exchange
    // sites), NOT UTF-8. res.text() decodes assuming UTF-8 by default,
    // which corrupts every Chinese byte sequence into literal '?'
    // characters -- silently breaking every downstream match. Decode the
    // raw bytes explicitly as Big5 instead.
    const buffer = await res.arrayBuffer();
    try {
      html = new TextDecoder('big5').decode(buffer);
    } catch (decodeErr) {
      return NextResponse.json(
        { error: 'Big5 decode failed, falling back would corrupt data', detail: String(decodeErr), contentType, elapsedMs: Date.now() - t0 },
        { status: 500 },
      );
    }
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
  let rowCount = 0;
  try {
    // Cheap linear split instead of one big backtracking-prone regex.
    const rows = html.split('<tr>');
    rowCount = rows.length;

    // Per-row regex: bounded to a single <tr>...</tr> chunk, so even if a
    // row is malformed there's no risk of runaway backtracking across the
    // whole document.
    const cellRegex = /<td[^>]*>([^<]*)<\/td>/g;

    for (const row of rows) {
      if (!row.includes('\u3000')) continue; // quick pre-filter: symbol／name separator
      const cells: string[] = [];
      let m;
      cellRegex.lastIndex = 0;
      while ((m = cellRegex.exec(row)) !== null) {
        cells.push(m[1]);
        if (cells.length > 10) break; // safety cap, rows only need a few cells
      }
      if (cells.length < 5) continue;

      const first = cells[0] ?? '';
      const sepIdx = first.indexOf('\u3000');
      if (sepIdx < 1) continue;
      const symbol = first.slice(0, sepIdx).trim();
      if (!/^\d{4}$/.test(symbol)) continue;

      // market-type cell should read exactly '上市'
      const marketCell = (cells[2] ?? '').trim();
      if (marketCell !== '上市') continue;

      const sector = (cells[3] ?? '').trim();
      if (!sector) continue;

      symbols.push(symbol);
      sectors.push(sector);
    }
  } catch (err) {
    return NextResponse.json(
      { error: 'Parsing failed', detail: String(err), htmlLength, rowCount, elapsedMs: Date.now() - t0 },
      { status: 500 },
    );
  }

  const t2 = Date.now();

  if (symbols.length === 0) {
    return NextResponse.json(
      {
        error: 'No rows parsed from ISIN page -- page structure may have changed',
        htmlLength,
        rowCount,
        contentType,
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
      rowCount,
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