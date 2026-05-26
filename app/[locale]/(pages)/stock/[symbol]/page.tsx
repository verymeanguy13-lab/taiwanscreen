// Server component — no 'use client' here.
// Fetches stock name from DB to build dynamic SEO title per stock.

import { query } from '@/lib/db';
import StockClient from './StockClient';

interface StockMeta {
  name_zh: string;
  name_en: string | null;
}

export async function generateMetadata({ params }: { params: { symbol: string } }) {
  const { symbol } = params;

  const rows = await query<StockMeta>`
    SELECT name_zh, name_en
    FROM stocks
    WHERE symbol = ${symbol}
    LIMIT 1
  `;

  const stock = rows[0];

  // If stock not found, return a basic fallback title
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
