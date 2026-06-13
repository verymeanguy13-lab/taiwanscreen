// =============================================================================
// app/sitemap.ts
// Fully static — no DB calls at build time to prevent timeout
// =============================================================================

import { MetadataRoute } from 'next';

const BASE_URL = 'https://taiwanscreen.vercel.app';

const STATIC_ROUTES = [
  '',
  '/screener',
  '/heatmap',
  '/institutional',
  
  '/margin',
  '/etf',
  '/dividend',
  '/supply-chain',
  '/backtest',
  '/accuracy',
  '/rankings',
  '/dazhang',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES.map(route => ({
    url:             `${BASE_URL}${route}`,
    lastModified:    new Date(),
    changeFrequency: 'daily',
    priority:        route === '' ? 1.0 : 0.8,
  }));
}