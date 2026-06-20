// Server component — fetches initial data for SSR + SEO
import { query, queryUnsafe } from '@/lib/db';
import StockClient from './StockClient';

interface StockMeta {
  name_zh: string;
  name_en: string | null;
}

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  let rows: StockMeta[] = [];
  try {
    rows = await query<StockMeta>`
      SELECT name_zh, name_en
      FROM stocks
      WHERE symbol = ${symbol}
      LIMIT 1
    `;
  } catch {
    // DB error — return fallback title
  }
  const stock = rows[0];
  if (!stock) {
    return { title: `${symbol} | 台股雷達` };
  }
  const { name_zh, name_en } = stock;
  return {
    title: `${symbol} ${name_zh} 股價 籌碼 技術分析 | 台股雷達`,
    description: `${symbol} ${name_zh} 即時股價、技術分析、籌碼分析、法人買賣、健康評分。免費台股分析工具。`,
    alternates: {
      languages: {
        en: {
          title: `${symbol} ${name_en ?? name_zh} Stock Analysis | TaiwanScreen`,
        },
      },
    },
  };
}

export default async function StockPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;

  let initialData = null;
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://taiwanscreen.vercel.app';
    const res = await fetch(`${baseUrl}/api/stock/${symbol}`, {
      next: { revalidate: 300 }, // cache 5 minutes
    });
    if (res.ok) {
      initialData = await res.json();
    }
  } catch {
    // fall through — client will fetch on mount
  }

  return <StockClient initialData={initialData} />;
}