'use client';

import { useState, useEffect } from 'react';

type AdSize = 'leaderboard' | 'rectangle';

const SIZE_MAP: Record<AdSize, { width: number; height: number }> = {
  leaderboard: { width: 728, height: 90 },
  rectangle:   { width: 300, height: 250 },
};

interface AdSlotProps {
  size: AdSize;
  slotId: string;
}

export default function AdSlot({ size, slotId }: AdSlotProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prevent SSR / hydration mismatch — render nothing on the server
  if (!mounted) return null;

  const { width, height } = SIZE_MAP[size];
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    return (
      <div
        style={{
          width,
          height,
          border: '2px dashed var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-secondary)',
          fontSize: 12,
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: 4,
          userSelect: 'none',
        }}
      >
        廣告 {width}×{height}
      </div>
    );
  }

  return (
    // Replace data-ad-client value with your Google AdSense publisher ID
    <ins
      className="adsbygoogle"
      style={{ display: 'block', width, height }}
      data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
      data-ad-slot={slotId}
      data-ad-format="auto"
      data-full-width-responsive="false"
    />
  );
}
