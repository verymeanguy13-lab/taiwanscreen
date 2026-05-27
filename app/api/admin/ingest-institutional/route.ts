// =============================================================================
// app/api/admin/ingest-institutional/route.ts
// POST /api/admin/ingest-institutional
// Manually trigger institutional flows ingestion for a specific date.
//
// PowerShell:
//   Invoke-WebRequest -Uri "https://taiwanscreen.vercel.app/api/admin/ingest-institutional" `
//     -Method POST `
//     -Headers @{"x-cron-secret"="GRsiYRX6H8cyTIzPappLQM4NZvE2GiO3QodPFz6jgFo="; "Content-Type"="application/json"} `
//     -Body '{"date":"2026-05-27"}' -UseBasicParsing | Select-Object -ExpandProperty Content
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { ingestInstitutionalFlows } from '@/lib/ingest';
import { fetchInstitutionalFlows } from '@/lib/twse';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { date?: string; preview?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const date = body.date ?? new Date().toISOString().slice(0, 10);

  // Preview mode: just show what the TWSE API returns without inserting
  if (body.preview) {
    const flows = await fetchInstitutionalFlows();
    return NextResponse.json({
      mode: 'preview',
      count: flows.length,
      first_3: flows.slice(0, 3),
    });
  }

  // Full ingest
  const result = await ingestInstitutionalFlows(date);
  return NextResponse.json({ date, ...result });
}