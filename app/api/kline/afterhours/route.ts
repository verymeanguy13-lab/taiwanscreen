// app/api/kline/afterhours/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { queryUnsafe, sql } from '@/lib/db';
import type { Candle } from '@/types';
import { computeScore } from '@/lib/scoring';
import { isMarketOpen, fetchLivePricesBatch, inferExchange } from '@/lib/twseLive';

const DIMENSION_LABELS: Record<string, string> = {
  trend: '趨勢強勢', momentum: '動能強勁', volume: '量能放大',
  chips: '籌碼買超', pattern: '型態突破', sentiment: '情緒偏多',
};

async function buildFreshCache(side: 'bull' | 'bear') {
  const stockRows = await queryUnsafe<{ symbol: string; name_zh: string; sector: string }>(
    `SELECT DISTINCT s.symbol, s.name_zh, COALESCE(s.sector, '') AS sector
     FROM stocks s
     INNER JOIN daily_prices dp ON dp.symbol = s.symbol
     WHERE dp.date >= CURRENT_DATE - INTERVAL '5 days'`,
    [],
  );

  const allPriceRows = await queryUnsafe<{
    symbol: string; date: string;
    open: string; high: string; low: string; close: string; volume: string;
  }>(
    `SELECT symbol, date, open, high, low, close, volume
     FROM daily_prices
     WHERE date >= CURRENT_DATE - INTERVAL '90 days'
     ORDER BY symbol, date ASC`,
    [],
  );

  const pricesBySymbol = new Map<string, Candle[]>();
  for (const row of allPriceRows) {
    if (!pricesBySymbol.has(row.symbol)) pricesBySymbol.set(row.symbol, []);
    pricesBySymbol.get(row.symbol)!.push({
      open: Number(row.open), high: Number(row.high),
      low: Number(row.low), close: Number(row.close),
      volume: Number(row.volume), date: String(row.date),
    });
  }

  const results: any[] = [];

  for (const { symbol, name_zh, sector } of stockRows) {
    try {
      const candles = pricesBySymbol.get(symbol);
      if (!candles || candles.length < 20) continue;

      const last5 = candles.slice(-5);
      const avg5vol = last5.reduce((s, c) => s + (c.volume ?? 0), 0) / 5;
      const latestVol = candles[candles.length - 1].volume ?? 0;
      if (avg5vol < 1000) continue;
      if (latestVol < 500) continue;

      const { overall, technicalReading, dimensions } = computeScore(candles);
      const isBull = overall >= 55;
      const isBear = overall < 40;
      if (side === 'bull' && !isBull) continue;
      if (side === 'bear' && !isBear) continue;

      const latestCandle = candles[candles.length - 1];
      const prevCandle   = candles[candles.length - 2];
      const changePercent = prevCandle?.close
        ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
        : 0;

      const topDimension = Object.entries(dimensions)
        .sort(([, a], [, b]) => b.score - a.score)[0];

      results.push({
        symbol, name_zh, sector,
        price: latestCandle.close,
        changePercent: Math.round(changePercent * 100) / 100,
        volume: latestVol,
        confidence: overall, matrixScore: overall,
        signalLabel: DIMENSION_LABELS[topDimension?.[0]] ?? technicalReading,
        isLivePrice: false,
      });
    } catch { continue; }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return { top100: results.slice(0, 100), totalScanned: stockRows.length };
}

async function buildLiveRescore(side: 'bull' | 'bear') {
  const cached = await sql`
    SELECT results, scanned FROM afterhours_cache WHERE side = ${side}
  `;
  if (cached.length === 0) return buildFreshCache(side);

  const cachedSymbols: string[] = (cached[0].results as any[]).map((r: any) => r.symbol);
  const totalScanned = cached[0].scanned as number;
  if (cachedSymbols.length === 0) return { top100: [], totalScanned };

  const placeholders = cachedSymbols.map((_, i) => `$${i + 1}`).join(', ');
  const allPriceRows = await queryUnsafe<{
    symbol: string; date: string;
    open: string; high: string; low: string; close: string; volume: string;
  }>(
    `SELECT symbol, date, open, high, low, close, volume
     FROM daily_prices
     WHERE symbol IN (${placeholders})
       AND date >= CURRENT_DATE - INTERVAL '90 days'
     ORDER BY symbol, date ASC`,
    cachedSymbols,
  );

  const pricesBySymbol = new Map<string, Candle[]>();
  for (const row of allPriceRows) {
    if (!pricesBySymbol.has(row.symbol)) pricesBySymbol.set(row.symbol, []);
    pricesBySymbol.get(row.symbol)!.push({
      open: Number(row.open), high: Number(row.high),
      low: Number(row.low), close: Number(row.close),
      volume: Number(row.volume), date: String(row.date),
    });
  }

  const stockMeta = new Map<string, { name_zh: string; sector: string }>();
  for (const r of cached[0].results as any[]) {
    stockMeta.set(r.symbol, { name_zh: r.name_zh, sector: r.sector ?? '' });
  }

  const liveMap = await fetchLivePricesBatch(
    cachedSymbols.map(symbol => ({ symbol, exchange: inferExchange(symbol) }))
  );

  const results: any[] = [];

  for (const symbol of cachedSymbols) {
    try {
      const candles = pricesBySymbol.get(symbol);
      if (!candles || candles.length < 20) continue;

      const liveQuote = liveMap.get(symbol);
      const meta = stockMeta.get(symbol) ?? { name_zh: symbol, sector: '' };

      const liveCandles = [...candles];
      if (liveQuote?.isLive) {
        const last = { ...liveCandles[liveCandles.length - 1] };
        last.close = liveQuote.price;
        if (liveQuote.price > last.high) last.high = liveQuote.price;
        if (liveQuote.price < last.low)  last.low  = liveQuote.price;
        liveCandles[liveCandles.length - 1] = last;
      }

      const { overall, technicalReading, dimensions } = computeScore(liveCandles);
      const isBull = overall >= 55;
      const isBear = overall < 40;
      if (side === 'bull' && !isBull) continue;
      if (side === 'bear' && !isBear) continue;

      const latestCandle = liveCandles[liveCandles.length - 1];
      const prevCandle   = liveCandles[liveCandles.length - 2];
      const changePercent = prevCandle?.close
        ? ((latestCandle.close - prevCandle.close) / prevCandle.close) * 100
        : 0;

      const topDimension = Object.entries(dimensions)
        .sort(([, a], [, b]) => b.score - a.score)[0];

      results.push({
        symbol, name_zh: meta.name_zh, sector: meta.sector,
        price: latestCandle.close,
        changePercent: Math.round(changePercent * 100) / 100,
        volume: latestCandle.volume ?? 0,
        confidence: overall, matrixScore: overall,
        signalLabel: DIMENSION_LABELS[topDimension?.[0]] ?? technicalReading,
        isLivePrice: liveQuote?.isLive ?? false,
      });
    } catch { continue; }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return { top100: results.slice(0, 100), totalScanned };
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const side    = (searchParams.get('side') ?? 'bull') as 'bull' | 'bear';
  const rebuild = searchParams.get('rebuild') === 'true';
  const marketOpen = isMarketOpen();
  const today = new Date(new Date().getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // ── CASE A: Market closed ─────────────────────────────────────────────
    if (!marketOpen) {
      if (!rebuild) {
        const cached = await sql`
          SELECT results, scanned FROM afterhours_cache
          WHERE side = ${side} AND cached_at::date = ${today}::date
        `;
        if (cached.length > 0) {
          return NextResponse.json({
            results: cached[0].results,
            totalScanned: cached[0].scanned,
            isLive: false, liveAt: null, marketOpen: false,
          }, { headers: { 'Cache-Control': 's-maxage=43200, stale-while-revalidate=3600' } });
        }
      }

      const { top100, totalScanned } = await buildFreshCache(side);
      await sql`
        INSERT INTO afterhours_cache (side, results, scanned)
        VALUES (${side}, ${JSON.stringify(top100)}, ${totalScanned})
        ON CONFLICT (side) DO UPDATE SET
          results = EXCLUDED.results, scanned = EXCLUDED.scanned, cached_at = NOW()
      `;
      return NextResponse.json({
        results: top100, totalScanned,
        isLive: false, liveAt: null, marketOpen: false,
      }, { headers: { 'Cache-Control': 's-maxage=43200, stale-while-revalidate=3600' } });
    }

    // ── CASE B: Market open ───────────────────────────────────────────────
    if (!rebuild) {
      const FIVE_MIN_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const liveCached = await sql`
        SELECT results, scanned, cached_at FROM afterhours_live_cache
        WHERE side = ${side} AND cached_at > ${FIVE_MIN_AGO}
      `;
      if (liveCached.length > 0) {
        return NextResponse.json({
          results: liveCached[0].results,
          totalScanned: liveCached[0].scanned,
          isLive: true,
          liveAt: (liveCached[0].cached_at as Date).toISOString(),
          marketOpen: true,
        });
      }
    }

    const liveAt = new Date().toISOString();
    const { top100, totalScanned } = await buildLiveRescore(side);
    await sql`
      INSERT INTO afterhours_live_cache (side, results, scanned, cached_at)
      VALUES (${side}, ${JSON.stringify(top100)}, ${totalScanned}, NOW())
      ON CONFLICT (side) DO UPDATE SET
        results = EXCLUDED.results, scanned = EXCLUDED.scanned, cached_at = NOW()
    `;
    return NextResponse.json({
      results: top100, totalScanned,
      isLive: true, liveAt, marketOpen: true,
    });

  } catch (err) {
    console.error('[afterhours] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}