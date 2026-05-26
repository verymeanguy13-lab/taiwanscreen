// Server component — no 'use client' here.
// Handles SEO metadata, then renders the interactive client component below.

import InstitutionalClient from './InstitutionalClient';

export async function generateMetadata() {
  return {
    title: '三大法人動向 — 外資投信買賣超排行 免費版 | 台股雷達',
    alternates: {
      languages: {
        en: {
          title: 'Taiwan Institutional Flows — Foreign & Trust Buying | TaiwanScreen',
        },
      },
    },
  };
}

export default function InstitutionalPage() {
  return <InstitutionalClient />;
}
