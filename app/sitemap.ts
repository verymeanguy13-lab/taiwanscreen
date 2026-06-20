import { queryUnsafe } from '@/lib/db';

export default async function sitemap() {
  const baseUrl = 'https://taiwanscreen.vercel.app';

  // Fetch all stock symbols
  const stocks = await queryUnsafe<{ symbol: string }>(
    `SELECT symbol FROM stocks ORDER BY symbol ASC`,
    [],
  );

  const stockUrls = stocks.flatMap(({ symbol }) => [
    {
      url: `${baseUrl}/zh/stock/${symbol}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/en/stock/${symbol}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    },
  ]);

  const staticUrls = [
    {
      url: `${baseUrl}/zh`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1.0,
    },
    {
      url: `${baseUrl}/zh/screener`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/zh/dazhang`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/zh/heatmap`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    },
    {
      url: `${baseUrl}/zh/dividend`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    },
  ];

  return [...staticUrls, ...stockUrls];
}