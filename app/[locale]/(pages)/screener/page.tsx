// Server component — no 'use client' here.
// Handles SEO metadata, then renders the interactive client component below.

import { Suspense } from 'react';
import ScreenerClient from './ScreenerClient';

export async function generateMetadata() {
  return {
    title: '台股選股器 — 免費篩選1,600支台灣股票 | 台股雷達',
    description: '完全免費的台股多因子選股器，支援本益比、殖利率、外資買超40+條件',
    alternates: {
      languages: {
        en: {
          title: 'Taiwan Stock Screener — Free TWSE Filter Tool | TaiwanScreen',
          description:
            'Free multi-factor screener for 1,600+ TWSE stocks. Filter by P/E, yield, foreign buying and 40+ criteria.',
        },
      },
    },
  };
}

export default function ScreenerPage() {
  // Suspense is required here because ScreenerClient uses useSearchParams()
  return (
    <Suspense>
      <ScreenerClient />
    </Suspense>
  );
}
