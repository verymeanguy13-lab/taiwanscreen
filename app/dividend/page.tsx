// Server component — no 'use client' here.
// Handles SEO metadata, then renders the interactive client component below.

import DividendClient from './DividendClient';

export async function generateMetadata() {
  return {
    title: '台股高殖利率排行 — 存股族選股工具 | 台股雷達',
    alternates: {
      languages: {
        en: {
          title: 'Taiwan High Dividend Stocks — Dividend Investor Tool | TaiwanScreen',
        },
      },
    },
  };
}

export default function DividendPage() {
  return <DividendClient />;
}
