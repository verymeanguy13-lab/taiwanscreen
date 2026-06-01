// =============================================================================
// app/sitemap.ts
// =============================================================================

import { MetadataRoute } from 'next';
import { query } from '@/lib/db';

const BASE_URL = 'https://taiwanscreen.vercel.app';

const STATIC_ROUTES = [
  '',
  '/screener',
  '/heatmap',
  '/institutional',
  '/broker',
  '/margin',
  '/etf',
  '/dividend',
  '/supply-chain',
  '/backtest',
  '/accuracy',
];

interface StockRow {
  symbol: string;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map(route => ({
    url:             `${BASE_URL}${route}`,
    lastModified:    new Date(),
    changeFrequency: 'daily',
    priority:        route === '' ? 1.0 : 0.8,
  }));

  // Simple query — no joins, no market_cap filter, won't timeout
  let stockEntries: MetadataRoute.Sitemap = [];
  try {
    const stocks = await query<StockRow>`
      SELECT symbol FROM stocks
      ORDER BY symbol ASC
      LIMIT 200
    `;
    stockEntries = stocks.map(({ symbol }) => ({
      url:             `${BASE_URL}/stock/${symbol}`,
      lastModified:    new Date(),
      changeFrequency: 'daily' as const,
      priority:        0.7,
    }));
  } catch (err) {
    console.error('[sitemap] Failed to fetch stocks:', err);
  }

  return [...staticEntries, ...stockEntries];
}