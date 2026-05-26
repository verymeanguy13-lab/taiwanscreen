// =============================================================================
// app/sitemap.ts
// Next.js automatically serves this at /sitemap.xml — no extra config needed.
//
// ⚠️ When you get a real domain, replace taiwanscreen.vercel.app below
//    with your new domain (e.g. taiwanradar.com) in the BASE_URL line.
// =============================================================================

import { MetadataRoute } from 'next';
import { query } from '@/lib/db';

const BASE_URL = 'https://taiwanscreen.vercel.app'; // ← swap your domain here later

// All static pages in the app
const STATIC_ROUTES = [
  '',                // home
  '/screener',
  '/heatmap',
  '/institutional',
  '/broker',
  '/margin',
  '/etf',
  '/dividend',
  '/supply-chain',
  '/backtest',
];

interface StockRow {
  symbol: string;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {

  // ── Static pages ──────────────────────────────────────────────────────────
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map(route => ({
    url:             `${BASE_URL}${route}`,
    lastModified:    new Date(),
    changeFrequency: 'daily',
    priority:        route === '' ? 1.0 : 0.8,
  }));

  // ── Top 200 stocks by market cap ─────────────────────────────────────────
  let stockEntries: MetadataRoute.Sitemap = [];

  try {
    const stocks = await query<StockRow>`
      SELECT symbol
      FROM stocks
      WHERE market_cap IS NOT NULL
      ORDER BY market_cap DESC
      LIMIT 200
    `;

    stockEntries = stocks.flatMap(({ symbol }) => [
      {
        url:             `${BASE_URL}/stock/${symbol}`,
        lastModified:    new Date(),
        changeFrequency: 'daily' as const,
        priority:        0.7,
      },
    ]);
  } catch (err) {
    // If the DB query fails, just return static routes — don't crash the sitemap
    console.error('[sitemap] Failed to fetch top stocks:', err);
  }

  return [...staticEntries, ...stockEntries];
}