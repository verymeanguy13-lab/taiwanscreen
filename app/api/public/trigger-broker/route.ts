// app/api/public/trigger-broker/route.ts
//
// No-auth public endpoint called from the browser on BrokerPage mount.
// Protected by a DB date-check gate per offset slot — each visit covers
// a different slice of 50 symbols, rotating through 0→50→100→150→0.
// Over 4 page visits, all top 200 symbols are covered for the day.

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { ingestBrokerFlows } from '@/lib/ingest-broker';

const sql = neon(process.env.DATABASE_URL!);

const SLICE      = 50;   // symbols per visit
const MAX_OFFSET = 150;  // 4 slices: 0, 50, 100, 150

function getLastBusinessDay(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

export async function POST() {
  try {
    // ── Skip on weekends ──────────────────────────────────────────────────
    const dow = new Date().getDay();
    if (dow === 0 || dow === 6) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'market closed (weekend)' });
    }

    const yesterday = getLastBusinessDay();
    const isoDate   = yesterday.toISOString().split('T')[0];

    // ── Find which offset slot hasn't been ingested yet today ─────────────
    // Check how many distinct symbols we have for yesterday's date
    const [symbolCount] = await sql`
      SELECT COUNT(DISTINCT symbol) as n FROM broker_flows WHERE date = ${isoDate}
    `;
    const ingested = Number(symbolCount?.n ?? 0);

    // Determine next offset based on how many symbols already ingested
    // 0 ingested → offset 0, 50 ingested → offset 50, etc.
    const offset = Math.min(
      Math.floor(ingested / SLICE) * SLICE,
      MAX_OFFSET,
    );

    // If all slices done (200+ symbols), skip
    if (ingested >= MAX_OFFSET + SLICE) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'all slices complete', ingested });
    }

    const result = await ingestBrokerFlows(yesterday, SLICE, offset);
    return NextResponse.json({ ok: true, skipped: false, offset, result });

  } catch (err) {
    console.error('[trigger-broker]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}