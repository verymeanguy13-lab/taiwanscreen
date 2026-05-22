import { MetadataRoute } from 'next';

const BASE_URL = 'https://www.taiwanscreen.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    '/',
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

  return staticRoutes.map(route => ({
    url: `${BASE_URL}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '/' ? 'daily' : 'weekly',
    priority: route === '/' ? 1.0 : 0.7,
  }));
}