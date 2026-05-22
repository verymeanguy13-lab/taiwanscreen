// =============================================================================
// app/api/stock/[symbol]/chips/route.ts
// GET /api/stock/2330/chips
// Returns institutional flows, margin data, and broker rankings.
// =============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { cached } from '@/lib/cache';

interface InstitutionalSummary {
  foreign_5d:                number;
  foreign_10d:               number;
  foreign_20d:               number;
  trust_5d:                  number;
  trust_10d:                 number;
  trust_20d:                 number;
  foreign_consecutive_days:  number;
  trust_consecutive_days:    number;
  is_triple_buy:             boolean;
}

interface BrokerRankRow {
  broker_id:   string;
  broker_name: string;
  net_5d:      number;
  net_10d:     number;
  net_20d:     number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { symbol: string } },
) {
  const symbol = params.symbol?.toUpperCase().trim();
  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  const cacheKey = `chips:${symbol}`;

  try {
    const result = await cached(cacheKey, 15 * 60, async () => {
      // ── Run all queries in parallel ──────────────────────────────────
      const [
        flowRows,
        marginRows,
        brokerBuyRows,
        brokerSellRows,
      ] = await Promise.all([

        // 1. Institutional flows — last 120 days
        queryUnsafe(
          `SELECT *
           FROM institutional_flows
           WHERE symbol = $1
             AND date >= NOW() - INTERVAL '120 days'
           ORDER BY date ASC`,
          [symbol],
        ),

        // 3. Margin data — last 120 days
        queryUnsafe(
          `SELECT *
           FROM margin_data
           WHERE symbol = $1
             AND date >= NOW() - INTERVAL '120 days'
           ORDER BY date ASC`,
          [symbol],
        ),

        // 4a. Top 10 broker buyers (net_20d DESC)
        queryUnsafe<BrokerRankRow>(
          `SELECT
             bf.broker_id,
             bb.broker_name,
             SUM(CASE WHEN bf.date >= NOW() - '5 days'::interval
                      THEN bf.net_volume ELSE 0 END)  AS net_5d,
             SUM(CASE WHEN bf.date >= NOW() - '10 days'::interval
                      THEN bf.net_volume ELSE 0 END)  AS net_10d,
             SUM(bf.net_volume)                        AS net_20d
           FROM broker_flows bf
           JOIN broker_branches bb ON bf.broker_id = bb.broker_id
           WHERE bf.symbol = $1
             AND bf.date >= NOW() - INTERVAL '20 days'
           GROUP BY bf.broker_id, bb.broker_name
           ORDER BY net_20d DESC
           LIMIT 10`,
          [symbol],
        ),

        // 4b. Top 10 broker sellers (net_20d ASC)
        queryUnsafe<BrokerRankRow>(
          `SELECT
             bf.broker_id,
             bb.broker_name,
             SUM(CASE WHEN bf.date >= NOW() - '5 days'::interval
                      THEN bf.net_volume ELSE 0 END)  AS net_5d,
             SUM(CASE WHEN bf.date >= NOW() - '10 days'::interval
                      THEN bf.net_volume ELSE 0 END)  AS net_10d,
             SUM(bf.net_volume)                        AS net_20d
           FROM broker_flows bf
           JOIN broker_branches bb ON bf.broker_id = bb.broker_id
           WHERE bf.symbol = $1
             AND bf.date >= NOW() - INTERVAL '20 days'
           GROUP BY bf.broker_id, bb.broker_name
           ORDER BY net_20d ASC
           LIMIT 10`,
          [symbol],
        ),
      ]);

      // ── 2. Compute institutional summary from flowRows ────────────────
      const now   = new Date();
      const d5    = new Date(now); d5.setDate(now.getDate() - 5);
      const d10   = new Date(now); d10.setDate(now.getDate() - 10);
      const d20   = new Date(now); d20.setDate(now.getDate() - 20);

      type FlowRow = {
        date: string;
        foreign_net: number | null;
        trust_net: number | null;
        foreign_consecutive_days: number | null;
        trust_consecutive_days: number | null;
        triple_buy: boolean | null;
      };

      const flows = flowRows as FlowRow[];

      const sumField = (field: 'foreign_net' | 'trust_net', since: Date): number =>
        flows
          .filter(r => new Date(r.date) >= since)
          .reduce((s, r) => s + (Number(r[field]) || 0), 0);

      // Latest row (last in ASC-ordered array)
      const latest = flows[flows.length - 1];

      const summary: InstitutionalSummary = {
        foreign_5d:               sumField('foreign_net', d5),
        foreign_10d:              sumField('foreign_net', d10),
        foreign_20d:              sumField('foreign_net', d20),
        trust_5d:                 sumField('trust_net',   d5),
        trust_10d:                sumField('trust_net',   d10),
        trust_20d:                sumField('trust_net',   d20),
        foreign_consecutive_days: Number(latest?.foreign_consecutive_days ?? 0),
        trust_consecutive_days:   Number(latest?.trust_consecutive_days   ?? 0),
        is_triple_buy:            latest?.triple_buy === true,
      };

      // Normalise broker number fields (Neon returns strings for BIGINT/SUM)
      const normBroker = (rows: BrokerRankRow[]) =>
        rows.map(r => ({
          broker_id:   r.broker_id,
          broker_name: r.broker_name,
          net_5d:      Number(r.net_5d  ?? 0),
          net_10d:     Number(r.net_10d ?? 0),
          net_20d:     Number(r.net_20d ?? 0),
        }));

      return {
        institutionalFlows:    flows,
        institutionalSummary:  summary,
        marginData:            marginRows,
        brokerRanking: {
          buyers:  normBroker(brokerBuyRows),
          sellers: normBroker(brokerSellRows),
        },
      };
    });

    return NextResponse.json({ data: result });
  } catch (err) {
    console.error(`[chips/${symbol}] Unexpected error:`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}