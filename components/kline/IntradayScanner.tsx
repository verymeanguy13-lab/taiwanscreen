'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  evaluateAfterHours,
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

// Convert evaluateAfterHours bull/bear strategies to IntradaySignalEvent[]
function strategiesToSignals(
  bullStrategies: string[],
  bearStrategies: string[],
  bullScore: number,
  bearScore: number,
  price: number,
): IntradaySignalEvent[] {
  const time = new Date().toLocaleTimeString('zh-TW', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei',
  });

  const signals: IntradaySignalEvent[] = [];

  for (const s of bullStrategies) {
    signals.push({
      type:        s as any,
      side:        'bull',
      time,
      price,
      strength:    bullScore >= 40 ? 3 : bullScore >= 20 ? 2 : 1,
      description: s,
    });
  }

  for (const s of bearStrategies) {
    signals.push({
      type:        s as any,
      side:        'bear',
      time,
      price,
      strength:    bearScore >= 40 ? 3 : bearScore >= 20 ? 2 : 1,
      description: s,
    });
  }

  return signals;
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
              // Fetch kline data (required) + live quote (optional)
              const [klineRes, quoteRes] = await Promise.all([
                fetch(`/api/kline/${symbol}`),
                fetch(`/api/proxy/twse?symbol=${symbol}`).catch(() => null),
              ]);

              if (!klineRes.ok) return;

              const klineJson = await klineRes.json();
              const candles: Candle[] = klineJson.candles ?? [];
              const indicators        = klineJson.indicators ?? {};

              if (candles.length < 20) return;

              // Use live price if available, fall back to last candle close
              const lastCandle = candles[candles.length - 1];
              let price       = lastCandle.close;
              let changePercent = lastCandle.close > 0 && candles.length >= 2
                ? ((lastCandle.close - candles[candles.length - 2].close) / candles[candles.length - 2].close) * 100
                : 0;

              if (quoteRes?.ok) {
                try {
                  const quoteJson = await quoteRes.json();
                  const livePrice = parseFloat(quoteJson.z ?? '0');
                  const prevClose = parseFloat(quoteJson.y ?? '0');
                  if (livePrice > 0) {
                    price = livePrice;
                    changePercent = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
                  }
                } catch { /* use fallback */ }
              }

              // Use evaluateAfterHours for signal detection
              // This works on daily candles — reliable, no tick stream needed
              const evalResult = evaluateAfterHours(candles, {
                sma5:  indicators.sma5  ?? [],
                sma20: indicators.sma20 ?? [],
                sma60: indicators.sma60 ?? [],
                bb:    indicators.bb    ?? { upper: [], middle: [], lower: [] },
              });

              const { bullStrategies, bearStrategies, bullScore, bearScore } = evalResult;

              // Skip stocks with no signals
              if (bullStrategies.length === 0 && bearStrategies.length === 0) return;
              // Minimum score threshold to reduce noise
              if (bullScore < 10 && bearScore < 10) return;

              const signals = strategiesToSignals(
                bullStrategies, bearStrategies, bullScore, bearScore, price,
              );

              const trendStrength  = computeTrendStrength(signals);
              const yesterdayTrend = classifyYesterdayTrend(candles, {
                sma5:  indicators.sma5  ?? [],
                sma20: indicators.sma20 ?? [],
                sma60: indicators.sma60 ?? [],
                bb:    indicators.bb    ?? { upper: [], middle: [], lower: [] },
              });

              const bullCount = bullStrategies.length;
              const bearCount = bearStrategies.length;

              const result: ScanResult = {
                symbol, name_zh, sector, price, changePercent,
                signals, trendStrength, yesterdayTrend, bullCount, bearCount,
              };

              if (bullCount > 0 && bullScore >= 10) bull.push(result);
              if (bearCount > 0 && bearScore >= 10) bear.push(result);
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
          bull: [...bull].sort((a, b) => (b.trendStrength.bullScore - a.trendStrength.bullScore)),
          bear: [...bear].sort((a, b) => (b.trendStrength.bearScore - a.trendStrength.bearScore)),
        }));

        await delay(200);
      }

      setState(s => ({
        ...s,
        status:     'done',
        progress:   100,
        lastScanAt: new Date(),
        bull: [...bull].sort((a, b) => (b.trendStrength.bullScore - a.trendStrength.bullScore)),
        bear: [...bear].sort((a, b) => (b.trendStrength.bearScore - a.trendStrength.bearScore)),
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
