// =============================================================================
// app/api/admin/cash-gap-data/route.ts
//
// READ-ONLY. Returns 0050's daily open + prior close for every date in
// range, so the opening-gap can be computed externally:
//   Gap_t = (open_t - priorClose_t) / priorClose_t
//
// Reads directly from the existing daily_prices table (symbol='0050') ??
// no new table, no write, no schema change. Same source sox-signal-check
// and the other admin routes already use.
//
// Query params: start_date=YYYY-MM-DD, end_date=YYYY-MM-DD (both required)
// =============================================================================

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

interface DailyPriceRow {
  date: string;
  open: number | null;
  close: number | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'start_date and end_date (YYYY-MM-DD) are required' }, { status: 400 });
  }

  try {
    // Fetch a bit before start_date too, so the first in-range date still
    // has a valid prior close to compute its gap against.
    const fetchFrom = new Date(startDate);
    fetchFrom.setDate(fetchFrom.getDate() - 10);

    const priceRows = await sql`
      SELECT date::text AS date, open, close
      FROM daily_prices
      WHERE symbol = '0050' AND date >= ${fetchFrom.toISOString().slice(0, 10)} AND date <= ${endDate}
      ORDER BY date ASC
    ` as unknown as DailyPriceRow[];

    const out: Array<{ date: string; open: number; priorClose: number; gapPct: number }> = [];
    const excluded: Array<{ date: string; reason: string }> = [];

    for (let i = 1; i < priceRows.length; i++) {
      const row = priceRows[i];
      const prior = priceRows[i - 1];
      if (row.date < startDate || row.date > endDate) continue;
      if (row.open == null) { excluded.push({ date: row.date, reason: 'missing 0050 open' }); continue; }
      if (prior.close == null) { excluded.push({ date: row.date, reason: 'missing prior 0050 close' }); continue; }
      const gapPct = (row.open / prior.close - 1) * 100;
      out.push({ date: row.date, open: row.open, priorClose: prior.close, gapPct });
    }

    return NextResponse.json({
      note: 'Read-only, from daily_prices (symbol=0050). gapPct = (open_t / priorClose_t - 1) * 100.',
      startDate, endDate,
      count: out.length,
      excludedCount: excluded.length,
      excluded,
      data: out,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
