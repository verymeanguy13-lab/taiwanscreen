// =============================================================================
// app/api/admin/finmind-5sec-probe/route.ts
//
// READ-ONLY probe. Tests whether FinMind's 5-second TAIEX index datasets
// are actually accessible on this project's tier, before building any
// real analysis around them. Tries both dataset names that appear in
// FinMind's docs/release notes (TaiwanVariousIndicators5Seconds and
// TaiwanStockEvery5SecondsIndex, the latter added 2025-05-10 per their
// release notes) for a single recent date, and reports exactly what
// each returns: real data, a paid-tier error, or something else.
// =============================================================================

import { NextResponse } from 'next/server';

async function probe(dataset: string, date: string, includeDataId: boolean) {
  const token = process.env.FINMIND_TOKEN;
  const url = new URL('https://api.finmindtrade.com/api/v4/data');
  url.searchParams.set('dataset', dataset);
  if (includeDataId) url.searchParams.set('data_id', 'TAIEX');
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);

  try {
    const res = await fetch(url.toString(), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const raw = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(raw); } catch { /* leave null */ }
    const j = json as { data?: unknown[]; msg?: string; status?: number } | null;
    return {
      dataset,
      httpStatus: res.status,
      apiMsg: j?.msg ?? null,
      apiStatus: j?.status ?? null,
      rowCount: Array.isArray(j?.data) ? j!.data!.length : null,
      sampleRows: Array.isArray(j?.data) ? j!.data!.slice(0, 3) : null,
      rawSnippet: json ? null : raw.slice(0, 300),
    };
  } catch (err: unknown) {
    return { dataset, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? '2026-09-16';

  const results = await Promise.all([
    probe('TaiwanVariousIndicators5Seconds', date, false),
    probe('TaiwanVariousIndicators5Seconds', date, true),
    probe('TaiwanStockEvery5SecondsIndex', date, false),
  ]);

  return NextResponse.json({ note: 'Read-only probe, no analysis performed.', date, results });
}
