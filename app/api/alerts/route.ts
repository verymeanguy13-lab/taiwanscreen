// =============================================================================
// app/api/alerts/route.ts
// GET    /api/alerts  — list user's active alerts
// POST   /api/alerts  — create a new alert
// All routes require an active session.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { queryUnsafe } from '@/lib/db';

const FREE_ALERT_LIMIT = 3;

async function getUserId(email: string): Promise<number | null> {
  const rows = await queryUnsafe<{ id: number }>(
    `INSERT INTO users (email)
     VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email],
  );
  return rows[0]?.id ?? null;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const rows = await queryUnsafe(
      `SELECT
         a.id, a.symbol, a.alert_type, a.threshold,
         a.is_active, a.last_triggered, a.created_at,
         s.name_zh, s.sector
       FROM alerts a
       JOIN stocks s ON a.symbol = s.symbol
       WHERE a.user_id = (SELECT id FROM users WHERE email = $1)
         AND a.is_active = TRUE
       ORDER BY a.created_at DESC`,
      [session.user.email],
    );
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[alerts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { symbol, alert_type, threshold } = await req.json() as {
      symbol:     string;
      alert_type: string;
      threshold:  number | null;
    };

    if (!symbol || !alert_type) {
      return NextResponse.json({ error: 'symbol and alert_type are required' }, { status: 400 });
    }

    const userId = await getUserId(session.user.email);
    if (!userId) {
      return NextResponse.json({ error: 'Could not resolve user' }, { status: 500 });
    }

    const countRows = await queryUnsafe<{ count: string }>(
      `SELECT COUNT(*) AS count FROM alerts WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
    const currentCount = parseInt(countRows[0]?.count ?? '0', 10);

    if (currentCount >= FREE_ALERT_LIMIT) {
      return NextResponse.json(
        { error: 'Free plan limit reached', limit: FREE_ALERT_LIMIT, upgrade_required: true },
        { status: 403 },
      );
    }

    const stockRows = await queryUnsafe<{ symbol: string }>(
      `SELECT symbol FROM stocks WHERE symbol = $1`,
      [symbol.toUpperCase()],
    );
    if (!stockRows[0]) {
      return NextResponse.json({ error: `Stock ${symbol} not found` }, { status: 404 });
    }

    const inserted = await queryUnsafe<{ id: number }>(
      `INSERT INTO alerts (user_id, symbol, alert_type, threshold)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, symbol.toUpperCase(), alert_type, threshold ?? null],
    );

    return NextResponse.json({ data: { id: inserted[0].id } }, { status: 201 });
  } catch (err) {
    console.error('[alerts POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}