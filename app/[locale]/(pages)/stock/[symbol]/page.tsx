// Server component — no 'use client' here.
// Fetches stock name from DB to build dynamic SEO title per stock.

import { query } from '@/lib/db';
import StockClient from './StockClient';

interface StockMeta {
  name_zh: string;
  name_en: string | null;
}

// Next.js 16: params must be typed as Promise and awaited
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
    title: `${symbol} ${name_zh} 股價分析 籌碼 殖利率 | 台股雷達`,
    alternates: {
      languages: {
        en: {
          title: `${symbol} ${name_en ?? name_zh} Stock Analysis | TaiwanScreen`,
        },
      },
    },
  };
}

export default function StockPage() {
  return <StockClient />;
}