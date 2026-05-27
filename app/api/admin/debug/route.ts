// =============================================================================
// app/api/admin/debug/route.ts
// GET /api/admin/debug — shows table counts and diagnoses data issues
// Protected by x-cron-secret header.
//
// PowerShell:
//   Invoke-WebRequest -Uri "https://taiwanscreen.vercel.app/api/admin/debug" `
//     -Headers @{"x-cron-secret"="GRsiYRX6H8cyTIzPappLQM4NZvE2GiO3QodPFz6jgFo="} `
//     -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json | ConvertTo-Json -Depth 5
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { fetchInstitutionalFlows, fetchAllStockPrices, fetchMarginData } from '@/lib/twse';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // ── Table counts ──────────────────────────────────────────────────────────
  for (const table of ['stocks', 'daily_prices', 'institutional_flows', 'margin_data', 'fundamentals', 'etfs', 'dividends']) {
    try {
      const rows = await queryUnsafe<{ count: string; max_date: string | null }>(
        `SELECT COUNT(*) AS count, MAX(date) AS max_date FROM ${table}`,
        [],
      );
      results[table] = { count: rows[0]?.count, latest_date: rows[0]?.max_date };
    } catch (err) {
      try {
        const rows = await queryUnsafe<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
          [],
        );
        results[table] = { count: rows[0]?.count };
      } catch (err2) {
        results[table] = { error: String(err2)