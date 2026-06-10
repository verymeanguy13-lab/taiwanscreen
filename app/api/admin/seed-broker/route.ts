// app/api/admin/seed-broker/route.ts
//
// Trigger broker branch data ingestion for the last N business days.
// Protected by CRON_SECRET.
//
// NOTE: Each stock requires a separate TWSE API call. With 150 symbols and
// 300ms delay each, one day takes ~45s. Keep days=1 to stay under Vercel's
// 60s function timeout. For backfill, run days=1 repeatedly.
//
// Usage (PowerShell):
//   $headers = @{"x-cron-secret" = "mysecret123"; "Content-Type" = "application/json"}
//   $body = '{"days": 1, "symbolLimit": 150}'
//   Invoke-WebRequest -Uri "https://taiwanscreen.vercel.app/api/admin/seed-broker" `
//     -Method POST -Headers $headers -Body $body -UseBasicParsing | Select -ExpandProperty Content

import { NextRequest, NextResponse } from 'next/server';
import { ingestBrokerFlows } from '@/lib/ingest-broker';

function pastBusinessDays(n: number): Date[] {
  const days: Date[] = [];
  const d = new Date();
  while (days.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(new Date(d));
  }
  return days.reverse();
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body        = await req.json().catch(() => ({}));
  const days        = Math.min(Math.max(parseInt(body.days) || 1, 1), 3); // max 3 days — timeout risk
  const symbolLimit = Math.min(parseInt(body.symbolLimit) || 150, 200);

  const businessDays = pastBusinessDays(days);
  const results = [];

  for (const day of businessDays) {
    const result = await ingestBrokerFlows(day, symbolLimit);
    results.push(result);
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL!);

  const [branchCount] = await sql`SELECT COUNT(*) as n FROM broker_branches`;
  const [flowCount]   = await sql`SELECT COUNT(*) as n FROM broker_flows`;
  const [latestFlow]  = await sql`SELECT MAX(date) as d FROM broker_flows`;

  return NextResponse.json({
    broker_branches_rows: branchCount.n,
    broker_flows_rows:    flowCount.n,
    latest_broker_date:   latestFlow.d,
  });
}