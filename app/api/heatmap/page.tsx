// Server component — no 'use client' here.
// Handles SEO metadata, then renders the interactive client component below.

import HeatmapClient from './HeatmapClient';

export async function generateMetadata() {
  return {
    title: '台股熱力圖 — 即時市場漲跌概覽 | 台股雷達',
    alternates: {
      languages: {
        en: {
          title: 'Taiwan Stock Heat Map — Live Market Overview | TaiwanScreen',
        },
      },
    },
  };
}

export default function HeatmapPage() {
  return <HeatmapClient />;
}
