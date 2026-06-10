// app/api/public/trigger-signals/route.ts
//
// No-auth public endpoint called from the browser on the accuracy page mount.
// Protected by a DB date-check gate — if signals were already computed today,
// the expensive 100-stock query is skipped entirely.
//
// The real admin endpoint (app/api/admin/update-signals) stays as-is.

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function POST() {
  try {
    // ── Gate: skip if signals were already computed today ─────────────────
    const today = new Date().toISOString().split('T')[0];
    const [latest] = await sql`
      SELECT MAX(signal_date) as d FROM signal_results
    `;
    if (latest?.d && String(latest.d).startsWith(today)) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already up to date' });
    }

    // ── Also skip on weekends ─────────────────────────────────────────────
    const dow = new Date().getDay();
    if (dow === 0 || dow === 6) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'market closed (weekend)' });
    }

    // ── Delegate to the real update-signals handler ───────────────────────
    // Call it internally rather than duplicating logic.
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://taiwanscreen.vercel.app';
    const res = await fetch(`${base}/api/admin/update-signals`, {
      method: 'POST',
      headers: {
        // update-signals has no auth check — this is safe
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json();
    return NextResponse.json({ ok: true, skipped: false, result: data });

  } catch (err) {
    console.error('[trigger-signals]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}