import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe } from '@/lib/db';
import { fetchInstitutionalFlows, fetchAllStockPrices, fetchMarginData } from '@/lib/twse';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  for (const table of ['stocks', 'daily_prices', 'institutional_flows', 'margin_data', 'fundamentals', 'etfs', 'dividends']) {
    try {
      const rows = await queryUnsafe<{ count: string; max_date: string | null }>(
        `SELECT COUNT(*) AS count, MAX(date) AS max_date FROM ${table}`,
        [],
      );
      results[table] = { count: rows[0]?.count, latest_date: rows[0]?.max_date };
    } catch {
      try {
        const rows = await queryUnsafe<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
          [],
        );
        results[table] = { count: rows[0]?.count };
      } catch (err2) {
        results[table] = { error: String(err2) };
      }
    }
  }

  const liveMode = req.nextUrl.searchParams.get('live') === '1';

  if (liveMode) {
    try {
      const flows = await fetchInstitutionalFlows();
      results['live_institutional'] = { count: flows.length, sample: flows.slice(0, 3) };
    } catch (err) {
      results['live_institutional'] = { error: String(err) };
    }

    try {
      const prices = await fetchAllStockPrices();
      results['live_prices'] = { count: prices.length, sample: prices.slice(0, 2) };
    } catch (err) {
      results['live_prices'] = { error: String(err) };
    }

    try {
      const margin = await fetchMarginData();
      results['live_margin'] = { count: margin.length, sample: margin.slice(0, 2) };
    } catch (err) {
      results['live_margin'] = { error: String(err) };
    }
  }

  return NextResponse.json(results, { status: 200 });
}