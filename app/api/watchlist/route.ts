// =============================================================================
// app/api/watchlist/route.ts
// Watchlist API — requires NextAuth session (Google login)
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { query, sql } from '@/lib/db';

// ── Types ─────────────────────────────────────────────────────────────────────
interface WatchlistRow {
  id:         number;
  name:       string;
  symbols:    string[];
}

interface StockPriceRow {
  symbol:     string;
  name_zh:    string;
  close:      number | null;
  change_pct: number | null;
  volume:     number | null;
  foreign_net: number | null;
}

interface UserRow {
  id: number;
}

// ── Helper: get user_id from email ────────────────────────────────────────────
async function getUserId(email: string): Promise<number | null> {
  const rows = await query<UserRow>`
    SELECT id FROM users WHERE email = ${email} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

// ── GET /api/watchlist ────────────────────────────────────────────────────────
// Returns all watchlists with current price data for each stock
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await getUserId(session.user.email);
  if (!userId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Fetch all watchlists for this user
  const watchlists = await query<WatchlistRow>`
    SELECT id, name, symbols
    FROM watchlists
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;

  // For each watchlist, fetch current price data for every symbol
  const result = await Promise.all(
    watchlists.map(async (wl) => {
      if (!wl.symbols || wl.symbols.length === 0) {
        return { id: wl.id, name: wl.name, stocks: [] };
      }

      const stocks = await query<StockPriceRow>`
        SELECT
          s.symbol,
          s.name_zh,
          dp.close,
          dp.change_pct,
          dp.volume,
          i.foreign_net
        FROM stocks s
        LEFT JOIN daily_prices dp
          ON s.symbol = dp.symbol
         AND dp.date = (SELECT MAX(date) FROM daily_prices)
        LEFT JOIN institutional_flows i
          ON s.symbol = i.symbol
         AND i.date = (SELECT MAX(date) FROM institutional_flows)
        WHERE s.symbol = ANY(${wl.symbols}::text[])
        ORDER BY s.symbol
      `;

      return { id: wl.id, name: wl.name, stocks };
    })
  );

  return NextResponse.json({ data: result });
}

// ── POST /api/watchlist ───────────────────────────────────────────────────────
// Create a new empty watchlist (max 5 per user)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await getUserId(session.user.email);
  if (!userId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json();
  const name = (body?.name ?? '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  // Check max 5 watchlists
  const countRows = await query<{ count: string }>`
    SELECT COUNT(*) AS count FROM watchlists WHERE user_id = ${userId}
  `;
  const count = parseInt(countRows[0]?.count ?? '0', 10);
  if (count >= 5) {
    return NextResponse.json(
      { error: '免費版最多建立 5 個自選股清單' },
      { status: 400 }
    );
  }

  const rows = await query<WatchlistRow>`
    INSERT INTO watchlists (user_id, name, symbols)
    VALUES (${userId}, ${name}, '{}')
    RETURNING id, name, symbols
  `;

  return NextResponse.json({ data: { ...rows[0], stocks: [] } }, { status: 201 });
}

// ── PUT /api/watchlist — add or remove a symbol ───────────────────────────────
// Body: { id: number, action: 'add'|'remove', symbol: string }
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await getUserId(session.user.email);
  if (!userId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json();
  const { id, action, symbol } = body ?? {};

  if (!id || !action || !symbol) {
    return NextResponse.json({ error: 'id, action, and symbol are required' }, { status: 400 });
  }
  if (action !== 'add' && action !== 'remove') {
    return NextResponse.json({ error: 'action must be add or remove' }, { status: 400 });
  }

  // Make sure this watchlist belongs to the user
  const owned = await query<{ id: number }>`
    SELECT id FROM watchlists WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `;
  if (!owned.length) {
    return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 });
  }

  if (action === 'add') {
    await sql`
      UPDATE watchlists
      SET symbols = array_append(symbols, ${symbol}::text)
      WHERE id = ${id}
        AND NOT (${symbol}::text = ANY(symbols))
    `;
  } else {
    await sql`
      UPDATE watchlists
      SET symbols = array_remove(symbols, ${symbol}::text)
      WHERE id = ${id}
    `;
  }

  return NextResponse.json({ success: true });
}

// ── DELETE /api/watchlist — delete a watchlist ────────────────────────────────
// Body: { id: number }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = await getUserId(session.user.email);
  if (!userId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json();
  const { id } = body ?? {};

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  await sql`
    DELETE FROM watchlists WHERE id = ${id} AND user_id = ${userId}
  `;

  return NextResponse.json({ success: true });
}