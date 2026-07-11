// app/api/admin/debug-sector-check/route.ts
//
// TEMPORARY diagnostic — read-only, no database writes (except reading).
// Investigates why ~1,090 stocks (roughly the TWSE half of the market)
// have a blank `sector` value, while TPEx-listed stocks' sectors look
// correct. Fetches the TWSE t187ap03_L open-data endpoint directly (the
// source `fetchStockList()` uses for TWSE sector data) and checks whether
// the 產業類別 field is actually populated for known large-cap symbols,
// plus reports current DB sector values for the same symbols for
// comparison. Delete once the root cause is confirmed.

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';

const CHECK_SYMBOLS = ['2330', '2454', '2317', '2412', '1301']; // TSMC, MediaTek, Hon Hai, Chunghwa Telecom, Formosa Plastics

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1) Fetch the raw TWSE open-data endpoint directly and inspect its shape.
  let rawFetchResult: unknown;
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap03_L', {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    const httpStatus = res.status;
    if (!res.ok) {
      rawFetchResult = { ok: false, httpStatus };
    } else {
      const json = await res.json();
      const isArray = Array.isArray(json);
      const totalRows = isArray ? json.length : null;
      const sampleRow = isArray ? json[0] : null;
      const sampleKeys = sampleRow ? Object.keys(sampleRow) : null;

      const matchedRows = isArray
        ? (json as Array<Record<string, string>>).filter(r => CHECK_SYMBOLS.includes(r['公司代號']))
        : [];

      rawFetchResult = {
        ok: true,
        httpStatus,
        isArray,
        totalRows,
        sampleKeys,
        sampleRow,
        matchedRowsForCheckSymbols: matchedRows,
      };
    }
  } catch (err) {
    rawFetchResult = { ok: false, error: String(err) };
  }

  // 2) Compare against what's currently stored in the DB for the same symbols.
  const dbRows = await queryUnsafe(
    `SELECT symbol, name_zh, sector, market FROM stocks WHERE symbol = ANY($1::text[])`,
    [CHECK_SYMBOLS],
  );

  // 3) Overall blank-sector breakdown by market, to see if it's TWSE-only.
  const blankSectorByMarket = await queryUnsafe(
    `SELECT market, COUNT(*)::int AS n
     FROM stocks
     WHERE sector = '' OR sector IS NULL
     GROUP BY market
     ORDER BY market`,
    [],
  );

  return NextResponse.json({
    rawFetchResult,
    dbRows,
    blankSectorByMarket,
  });
}