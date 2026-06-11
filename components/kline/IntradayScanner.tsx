'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  detectIntradaySignals,
  computeTrendStrength,
  classifyYesterdayTrend,
} from '@/lib/bullbearSignals';
import type {
  IntradaySignalEvent,
  TrendStrength,
  YesterdayTrend,
} from '@/lib/bullbearSignals';
import type { Candle } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanResult {
  symbol:          string;
  name_zh:         string;
  sector:          string;
  price:           number;
  changePercent:   number;
  signals:         IntradaySignalEvent[];
  trendStrength:   TrendStrength;
  yesterdayTrend:  YesterdayTrend;
  bullCount:       number;
  bearCount:       number;
}

export interface ScanState {
  status:       'idle' | 'scanning' | 'done' | 'error';
  progress:     number;
  scannedCount: number;
  totalCount:   number;
  bull:         ScanResult[];
  bear:         ScanResult[];
  lastScanAt:   Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isMarketOpen(): boolean {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }),
  );
  const d = now.getDay();
  const h = now.getHours();
  const m = now.getMinutes();
  return d >= 1 && d <= 5 && h >= 9 && (h < 13 || (h === 13 && m <= 30));
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useIntradayScanner(enabled: boolean) {
  const [state, setState] = useState<ScanState>({
    status:       'idle',
    progress:     0,
    scannedCount: 0,
    totalCount:   0,
    bull:         [],
    bear:         [],
    lastScanAt:   null,
  });

  const abortRef = useRef(false);

  const runScan = useCallback(async () => {
    if (!enabled || !isMarketOpen()) return;

    abortRef.current = false;

    setState(s => ({ ...s, status: 'scanning', progress: 0, scannedCount: 0 }));

    try {
      // 1. Get universe
      const uniRes  = await fetch('/api/kline/universe');
      const uniJson = await uniRes.json();

      // API returns { symbols: [...] } — not { stocks: [...] }
      const universe: { symbol: string; name_zh: string; sector: string }[] =
        uniJson.symbols ?? uniJson.stocks ?? [];

      if (universe.length === 0) {
        setState(s => ({ ...s, status: 'done', lastScanAt: new Date() }));
        return;
      }

      setState(s => ({ ...s, totalCount: universe.length }));

      const bull: ScanResult[] = [];
      const bear: ScanResult[] = [];
      const BATCH = 10;

      for (let i = 0; i < universe.length; i += BATCH) {
        if (abortRef.current) break;

        const batch = universe.slice(i, i + BATCH);

        await Promise.all(
          batch.map(async ({ symbol, name_zh, sector }) => {
            try {
              // Fetch live quote via TWSE proxy
              const [quoteRes, klineRes] = await Promise.all([
                fetch(`/api/proxy/twse?symbol=${symbol}`),
                fetch(`/api/kline/${symbol}`),
              ]);

              if (!quoteRes.ok || !klineRes.ok) return;

              const quoteJson = await quoteRes.json();
              const klineJson = await klineRes.json();

              const candles: Candle[] = klineJson.candles ?? [];
              const indicators        = klineJson.indicators ?? {};

              if (candles.length < 5) return;

              // Parse TWSE fields
              const price     = parseFloat(quoteJson.z ?? quoteJson.close ?? '0');
              const prevClose = parseFloat(quoteJson.y ?? '0');
              const open      = parseFloat(quoteJson.o ?? price.toString());
              const volume    = parseInt(quoteJson.v ?? '0', 10);

              if (!price || price <= 0) return;

              const changePercent = prevClose > 0
                ? ((price - prevClose) / prevClose) * 100
                : 0;

              // Build a single synthetic tick
              const tick = {
                time:   new Date().toLocaleTimeString('en-US', {
                          hour12: false, timeZone: 'Asia/Taipei',
                        }),
                price,
                volume,
                side:   price >= open ? ('B' as const) : ('S' as const),
              };

              const signals        = detectIntradaySignals([tick, tick], candles, []);
              const trendStrength  = computeTrendStrength(signals);
              const yesterdayTrend = classifyYesterdayTrend(candles, {
                sma5:  indicators.sma5  ?? [],
                sma20: indicators.sma20 ?? [],
                sma60: indicators.sma60 ?? [],
                bb:    indicators.bb    ?? { upper: [], middle: [], lower: [] },
              });

              const bullCount = signals.filter(s => s.side === 'bull').length;
              const bearCount = signals.filter(s => s.side === 'bear').length;

              const result: ScanResult = {
                symbol, name_zh, sector, price, changePercent,
                signals, trendStrength, yesterdayTrend, bullCount, bearCount,
              };

              if (bullCount > 0) bull.push(result);
              if (bearCount > 0) bear.push(result);
            } catch {
              // Skip failed symbols silently
            }
          }),
        );

        const scannedCount = Math.min(i + BATCH, universe.length);
        const progress     = Math.round((scannedCount / universe.length) * 100);

        setState(s => ({
          ...s,
          progress,
          scannedCount,
          bull: [...bull].sort((a, b) => b.bullCount - a.bullCount),
          bear: [...bear].sort((a, b) => b.bearCount - a.bearCount),
        }));

        await delay(200);
      }

      setState(s => ({
        ...s,
        status:     'done',
        progress:   100,
        lastScanAt: new Date(),
        bull: [...bull].sort((a, b) => b.bullCount - a.bullCount),
        bear: [...bear].sort((a, b) => b.bearCount - a.bearCount),
      }));
    } catch {
      setState(s => ({ ...s, status: 'error' }));
    }
  }, [enabled]);

  // Auto-run on mount + every 3 minutes
  useEffect(() => {
    if (!enabled) return;
    runScan();
    const interval = setInterval(runScan, 3 * 60 * 1000);
    return () => {
      clearInterval(interval);
      abortRef.current = true;
    };
  }, [enabled, runScan]);

  return { ...state, rescan: runScan };
}
