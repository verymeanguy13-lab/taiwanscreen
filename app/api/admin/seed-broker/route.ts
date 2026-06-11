// app/api/admin/seed-broker/route.ts
//
// Trigger broker branch data ingestion for the last N business days.
// Protected by CRON_SECRET.
//
// Each run processes one slice of symbols (default 50) at a given offset.
// Run multiple times with different offsets to cover more symbols:
//
// Usage (PowerShell):
//   $headers = @{"x-cron-secret" = "mysecret123"; "Content-Type" = "application/json"}
//
//   # Slice 1: top 50
//   $body = '{"days": 1, "symbolLimit": 50, "offset": 0}'
//   Invoke-WebRequest -Uri "https://taiwanscreen.vercel.app/api/admin/seed-broker" `
//     -Method POST -Headers $headers -Body $body -UseBasicParsing | Select -ExpandProperty Content
//
//   # Slice 2: 51-100
//   $body = '{"days": 1, "symbolLimit": 50, "offset": 50}'
//   # Slice 3: 101-150
//   $body = '{"days": 1, "symbolLimit": 50, "offset": 100}'
//   # Slice 4: 151-200
//   $body = '{"days": 1, "symbolLimit": 50, "offset": 150}'

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
  const days        = Math.min(Math.max(parseInt(body.days) || 1, 1), 3);
  const symbolLimit = Math.min(parseInt(body.symbolLimit) || 50, 100);
  const offset      = Math.max(parseInt(body.offset) || 0, 0);

  const businessDays = pastBusinessDays(days);
  const results = [];

  for (const day of businessDays) {
    const result = await ingestBrokerFlows(day, symbolLimit, offset);
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

  const [branchCount]  = await sql`SELECT COUNT(*) as n FROM broker_branches`;
  const [flowCount]    = await sql`SELECT COUNT(*) as n FROM broker_flows`;
  const [latestFlow]   = await sql`SELECT MAX(date) as d FROM broker_flows`;
  const [symbolsToday] = await sql`
    SELECT COUNT(DISTINCT symbol) as n
    FROM broker_flows
    WHERE date = (SELECT MAX(date) FROM broker_flows)
  `;

  return NextResponse.json({
    broker_branches_rows:  branchCount.n,
    broker_flows_rows:     flowCount.n,
    latest_broker_date:    latestFlow.d,
    symbols_latest_date:   symbolsToday.n,
  });
}