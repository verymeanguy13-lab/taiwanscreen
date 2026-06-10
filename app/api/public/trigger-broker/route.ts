// app/api/public/trigger-broker/route.ts
//
// No-auth public endpoint called from the browser on BrokerPage mount.
// Protected by a DB date-check gate instead of a secret — if today's
// broker data already exists, TWSE is never called again.
//
// The real admin endpoint (app/api/admin/seed-broker) stays secret-protected
// for PowerShell/manual use.

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { ingestBrokerFlows } from '@/lib/ingest-broker';

const sql = neon(process.env.DATABASE_URL!);

export async function POST() {
  try {
    // ── Gate: skip if today's broker data already exists ──────────────────
    const today = new Date().toISOString().split('T')[0];
    const [latest] = await sql`SELECT MAX(date) as d FROM broker_flows`;
    if (latest?.d && String(latest.d).startsWith(today)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already up to date' });
    }

    // ── Also skip on weekends — TWSE is closed ────────────────────────────
    const dow = new Date().getDay();
    if (dow === 0 || dow === 6) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'market closed (weekend)' });
    }

    // ── Run ingestion for yesterday (most recent trading day) ─────────────
    // We ingest yesterday because TWSE broker data for today isn't published
    // until after market close (~3:30 PM Taiwan time).
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    // Walk back to last business day
    while (yesterday.getDay() === 0 || yesterday.getDay() === 6) {
      yesterday.setDate(yesterday.getDate() - 1);
    }

    const result = await ingestBrokerFlows(yesterday, 150);
    return NextResponse.json({ ok: true, skipped: false, result });

  } catch (err) {
    console.error('[trigger-broker]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}