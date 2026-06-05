'use client';

import { useEffect, useState } from 'react';

type AdSize = 'leaderboard' | 'rectangle';

interface AdSlotProps {
  size: AdSize;
  slotId: string;
}

export default function AdSlot({ size, slotId }: AdSlotProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div style={{ display: 'none' }} />;
  return <div style={{ display: 'none' }} />;
}