// =============================================================================
// app/api/stock/[symbol]/broker-timeline/route.ts
// GET /api/stock/[symbol]/broker-timeline?days=30
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

interface BrokerRow {
  date:        string;
  broker_name: string;
  net_volume:  number;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10);
  const cacheKey = `broker-timeline:${symbol}:${days}`;

  try {
    const result = await cached(cacheKey, 30 * 60, async () => {
      const rows = await queryUnsafe<BrokerRow>(
        `SELECT bf.date::text, bb.broker_name, bf.net_volume
         FROM broker_flows bf
         JOIN broker_branches bb ON bf.broker_id = bb.broker_id
         WHERE bf.symbol = $1
           AND bf.date >= NOW() - ($2 || ' days')::INTERVAL
           AND bf.broker_id IN (
             SELECT broker_id FROM broker_flows
             WHERE symbol = $1 AND date >= NOW() - ($2 || ' days')::INTERVAL
             GROUP BY broker_id ORDER BY ABS(SUM(net_volume)) DESC LIMIT 5
           )
         ORDER BY bf.date, bb.broker_name`,
        [symbol, String(days)],
      );

      if (!rows.length) {
        return { data: [], brokers: [] };
      }

      // Get unique broker names in order of appearance
      const brokerSet = new Set<string>();
      rows.forEach(r => brokerSet.add(r.broker_name));
      const brokers = Array.from(brokerSet);

      // Group by date → { date, broker1: vol, broker2: vol, ... }
      const dateMap = new Map<string, Record<string, string | number>>();
      for (const row of rows) {
        const date = row.date.slice(0, 10);
        if (!dateMap.has(date)) dateMap.set(date, { date });
        dateMap.get(date)![row.broker_name] = Number(row.net_volume);
      }

      const data = Array.from(dateMap.values()).sort((a, b) =>
        (a.date as string).localeCompare(b.date as string),
      );

      return { data, brokers };
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[broker-timeline] Unexpected error:', err);
    return NextResponse.json({ data: [], brokers: [] }, { status: 200 });
  }
}