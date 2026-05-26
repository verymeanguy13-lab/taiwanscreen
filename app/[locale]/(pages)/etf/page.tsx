// Server component — no 'use client' here.
// Handles SEO metadata, then renders the interactive client component below.

import ETFClient from './ETFClient';

export async function generateMetadata() {
  return {
    title: '台股ETF比較 — 0050 vs 0056 vs 00878完整分析 | 台股雷達',
    alternates: {
      languages: {
        en: {
          title: 'Taiwan ETF Comparison — 0050 vs 0056 vs 00878 | TaiwanScreen',
        },
      },
    },
  };
}

export default function ETFPage() {
  return <ETFClient />;
}
