'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import useSWR from 'swr';
import { Skeleton } from '@/components/ui/Skeleton';
import { OHLCBar }       from './OHLCBar';
import { PatternBadge }  from './PatternBadge';
import { BreakoutBadge } from './BreakoutBadge';
import type { Candle }          from '@/types';
import type { DetectedPattern } from '@/lib/patterns';
import type { BreakoutSignal }  from '@/lib/breakouts';

interface KlineData {
  candles:    Candle[];
  indicators: {
    sma5:    (number | null)[];
    sma20:   (number | null)[];
    sma60:   (number | null)[];
    rsi14:   (number | null)[];
    macd:    { macdLine: (number | null)[]; signalLine: (number | null)[]; histogram: (number | null)[] };
    kd:      { k: (number | null)[]; d: (number | null)[] };
    bb:      { upper: (number | null)[]; lower: (number | null)[]; middle: (number | null)[] };
  };
  breakouts:  BreakoutSignal[];
  patterns:   DetectedPattern[];
  score:      unknown;
}

type Timeframe = 'D' | 'W' | 'M';
type SubPanel  = 'MACD' | 'RSI' | 'KDJ';

const fetcher = (url: string) => fetch(url).then(r => r.json());

function aggregateWeekly(candles: Candle[]): Candle[] {
  const weeks: Record<string, Candle> = {};
  for (const c of candles) {
    const d = new Date(c.date!);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d); mon.setUTCDate(diff);
    const key = mon.toISOString().slice(0, 10);
    if (!weeks[key]) { weeks[key] = { ...c, date: key }; }
    else {
      weeks[key].high  = Math.max(weeks[key].high, c.high);
      weeks[key].low   = Math.min(weeks[key].low,  c.low);
      weeks[key].close = c.close;
      weeks[key].volume = (weeks[key].volume ?? 0) + (c.volume ?? 0);
    }
  }
  return Object.values(weeks).sort((a, b) => a.date!.localeCompare(b.date!));
}

function aggregateMonthly(candles: Candle[]): Candle[] {
  const months: Record<string, Candle> = {};
  for (const c of candles) {
    const key = c.date!.slice(0, 7);
    if (!months[key]) { months[key] = { ...c, date: `${key}-01` }; }
    else {
      months[key].high  = Math.max(months[key].high, c.high);
      months[key].low   = Math.min(months[key].low,  c.low);
      months[key].close = c.close;
      months[key].volume = (months[key].volume ?? 0) + (c.volume ?? 0);
    }
  }
  return Object.values(months).sort((a, b) => a.date!.localeCompare(b.date!));
}

function smaSeries(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    return values.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0) / period;
  });
}

const CHART_BG   = '#08090E';
const GRID_COLOR = '#1E2235';
const TEXT_COLOR = '#8B8FA8';
const UP_COLOR   = '#FF4D6D';
const DOWN_COLOR = '#00D4AA';

export function CandlestickChart({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useSWR<KlineData>(
    `/api/kline/${symbol}`, fetcher, { revalidateOnFocus: false },
  );

  const containerRef  = useRef<HTMLDivElement>(null);
  const subRef        = useRef<HTMLDivElement>(null);
  const chartRef      = useRef<unknown>(null);
  const subChartRef   = useRef<unknown>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>('D');
  const [subPanel,  setSubPanel]  = useState<SubPanel>('MACD');
  const [showMA5,   setShowMA5]   = useState(true);
  const [showMA20,  setShowMA20]  = useState(true);
  const [showMA60,  setShowMA60]  = useState(true);
  const [showBB,    setShowBB]    = useState(false);

  const [crosshairCandle, setCrosshairCandle] = useState<Candle | null>(null);
  const [crossSma5,  setCrossSma5]  = useState<number | null>(null);
  const [crossSma20, setCrossSma20] = useState<number | null>(null);
  const [crossSma60, setCrossSma60] = useState<number | null>(null);

  const [patternPos,  setPatternPos]  = useState<{ pattern: DetectedPattern; x: number; y: number }[]>([]);
  const [breakoutPos, setBreakoutPos] = useState<{ signal: BreakoutSignal;  x: number; y: number }[]>([]);

  const getCandles = useCallback((): Candle[] => {
    if (!data?.candles) return [];
    if (timeframe === 'W') return aggregateWeekly(data.candles);
    if (timeframe === 'M') return aggregateMonthly(data.candles);
    return data.candles;
  }, [data, timeframe]);

  useEffect(() => {
    if (!data || !containerRef.current) return;

    // Destroy previous charts
    if (chartRef.current)    { (chartRef.current    as { remove: () => void }).remove(); chartRef.current    = null; }
    if (subChartRef.current) { (subChartRef.current as { remove: () => void }).remove(); subChartRef.current = null; }

    import('lightweight-charts').then((lc) => {
      const {
        createChart,
        CandlestickSeries,
        HistogramSeries,
        LineSeries,
        CrosshairMode,
        LineStyle,
      } = lc;

      const container = containerRef.current!;
      const candles   = getCandles();
      const closes    = candles.map(c => c.close);

      // ── Main chart ────────────────────────────────────────────────────────
      const chart = createChart(container, {
        width:  container.clientWidth,
        height: 380,
        layout: {
          background:  { color: CHART_BG },
          textColor:   TEXT_COLOR,
          fontFamily:  "'IBM Plex Mono', monospace",
          fontSize:    11,
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR },
        },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: {
          borderColor:  GRID_COLOR,
          scaleMargins: { top: 0.1, bottom: 0.3 },
        },
        timeScale: { borderColor: GRID_COLOR, timeVisible: true, secondsVisible: false },
      });
      chartRef.current = chart;

      // ── Candlestick ───────────────────────────────────────────────────────
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor:         UP_COLOR,
        downColor:       DOWN_COLOR,
        borderUpColor:   UP_COLOR,
        borderDownColor: DOWN_COLOR,
        wickUpColor:     UP_COLOR,
        wickDownColor:   DOWN_COLOR,
      });
      candleSeries.setData(candles.map(c => ({
        time: c.date as string, open: c.open, high: c.high, low: c.low, close: c.close,
      })));

      // ── Volume ────────────────────────────────────────────────────────────
      const volSeries = chart.addSeries(HistogramSeries, {
        color:        `${UP_COLOR}40`,
        priceFormat:  { type: 'volume' as const },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volSeries.setData(candles.map(c => ({
        time:  c.date as string,
        value: c.volume ?? 0,
        color: c.close >= c.open ? `${UP_COLOR}66` : `${DOWN_COLOR}66`,
      })));

      // ── MA lines ──────────────────────────────────────────────────────────
      const sma5vals  = smaSeries(closes, 5);
      const sma20vals = smaSeries(closes, 20);
      const sma60vals = smaSeries(closes, 60);

      const makeMA = (color: string, visible: boolean) => {
        const s = chart.addSeries(LineSeries, {
          color, lineWidth: 1,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        if (!visible) s.applyOptions({ visible: false });
        return s;
      };

      const ma5s  = makeMA('#3D8EF8', showMA5);
      const ma20s = makeMA('#F5B700', showMA20);
      const ma60s = makeMA('#9B59B6', showMA60);

      const toLine = (vals: (number | null)[]) =>
        candles.map((c, i) => vals[i] != null ? { time: c.date as string, value: vals[i]! } : null).filter(Boolean) as { time: string; value: number }[];

      ma5s.setData(toLine(sma5vals));
      ma20s.setData(toLine(sma20vals));
      ma60s.setData(toLine(sma60vals));

      // ── Bollinger ─────────────────────────────────────────────────────────
      if (data.indicators.bb && timeframe === 'D') {
        const bbU = chart.addSeries(LineSeries, { color: '#8B8FA840', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
        const bbL = chart.addSeries(LineSeries, { color: '#8B8FA840', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
        bbU.applyOptions({ visible: showBB });
        bbL.applyOptions({ visible: showBB });
        bbU.setData(data.indicators.bb.upper.map((v, i) => v != null ? { time: data.candles[i].date as string, value: v } : null).filter(Boolean) as { time: string; value: number }[]);
        bbL.setData(data.indicators.bb.lower.map((v, i) => v != null ? { time: data.candles[i].date as string, value: v } : null).filter(Boolean) as { time: string; value: number }[]);
      }

      // ── Breakout markers ──────────────────────────────────────────────────
      if (timeframe === 'D' && data.breakouts.length > 0) {
        const markerMap = {
          '上漲趨勢突破': { color: '#3D8EF8', text: '趨勢↑' },
          '箱型整理突破': { color: '#F5B700', text: '箱型↑' },
          '下跌V轉突破':  { color: '#FF4D6D', text: 'V轉↑'  },
        } as const;
        candleSeries.setMarkers(data.breakouts.map(b => ({
          time:     b.date as string,
          position: 'belowBar' as const,
          shape:    'arrowUp' as const,
          color:    markerMap[b.type].color,
          text:     markerMap[b.type].text,
        })));

        // Box lines for 箱型
        for (const b of data.breakouts.filter(x => x.type === '箱型整理突破')) {
          for (const lvl of [b.keyLevels.boxUpper, b.keyLevels.boxLower]) {
            if (!lvl) continue;
            chart.addSeries(LineSeries, { color: '#F5B70060', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false })
              .setData([
                { time: data.candles[0].date as string, value: lvl },
                { time: b.date as string,                value: lvl },
              ]);
          }
        }
      }

      // ── Crosshair ─────────────────────────────────────────────────────────
      chart.subscribeCrosshairMove((param) => {
        if (!param.time) { setCrosshairCandle(null); return; }
        const bar = param.seriesData?.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
        if (!bar) return;
        const idx = candles.findIndex(c => c.date === (param.time as string));
        setCrosshairCandle({ ...bar, date: param.time as string, volume: candles[idx]?.volume });
        setCrossSma5(idx >= 0 ? (sma5vals[idx] ?? null)  : null);
        setCrossSma20(idx >= 0 ? (sma20vals[idx] ?? null) : null);
        setCrossSma60(idx >= 0 ? (sma60vals[idx] ?? null) : null);

        // Badge positions
        if (timeframe === 'D') {
          setPatternPos(data.patterns.map(p => {
            const c = data.candles[p.candleIndex];
            if (!c) return null;
            const x = chart.timeScale().timeToCoordinate(c.date as string);
            const y = candleSeries.priceToCoordinate(c.high);
            if (x == null || y == null) return null;
            return { pattern: p, x, y };
          }).filter(Boolean) as { pattern: DetectedPattern; x: number; y: number }[]);

          setBreakoutPos(data.breakouts.map(b => {
            const x = chart.timeScale().timeToCoordinate(b.date as string);
            const y = candleSeries.priceToCoordinate(b.price);
            if (x == null || y == null) return null;
            return { signal: b, x, y };
          }).filter(Boolean) as { signal: BreakoutSignal; x: number; y: number }[]);
        }
      });

      // ── Sub-panel ─────────────────────────────────────────────────────────
      const subEl = subRef.current;
      if (subEl && timeframe === 'D') {
        const subChart = createChart(subEl, {
          width:  subEl.clientWidth,
          height: 120,
          layout: { background: { color: CHART_BG }, textColor: TEXT_COLOR, fontSize: 10 },
          grid:   { vertLines: { color: GRID_COLOR }, horzLines: { color: GRID_COLOR } },
          crosshair: { mode: CrosshairMode.Normal },
          rightPriceScale: { borderColor: GRID_COLOR, scaleMargins: { top: 0.1, bottom: 0.1 } },
          timeScale: { borderColor: GRID_COLOR, visible: false },
        });
        subChartRef.current = subChart;

        if (subPanel === 'MACD' && data.indicators.macd) {
          const { macdLine, signalLine, histogram } = data.indicators.macd;
          const hist = subChart.addSeries(HistogramSeries, { color: '#3D8EF860', priceLineVisible: false });
          hist.setData(data.candles.map((c, i) => histogram[i] != null ? { time: c.date as string, value: histogram[i]!, color: histogram[i]! >= 0 ? `${UP_COLOR}80` : `${DOWN_COLOR}80` } : null).filter(Boolean) as { time: string; value: number; color: string }[]);
          const ml = subChart.addSeries(LineSeries, { color: '#3D8EF8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          ml.setData(data.candles.map((c, i) => macdLine[i] != null ? { time: c.date as string, value: macdLine[i]! } : null).filter(Boolean) as { time: string; value: number }[]);
          const sl = subChart.addSeries(LineSeries, { color: '#FF4D6D', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          sl.setData(data.candles.map((c, i) => signalLine[i] != null ? { time: c.date as string, value: signalLine[i]! } : null).filter(Boolean) as { time: string; value: number }[]);
        }

        if (subPanel === 'RSI' && data.indicators.rsi14) {
          const rs = subChart.addSeries(LineSeries, { color: '#9B59B6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          rs.setData(data.candles.map((c, i) => data.indicators.rsi14[i] != null ? { time: c.date as string, value: data.indicators.rsi14[i]! } : null).filter(Boolean) as { time: string; value: number }[]);
          const first = data.candles[0].date as string;
          const last  = data.candles[data.candles.length - 1].date as string;
          subChart.addSeries(LineSeries, { color: '#FF4D6D60', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }).setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
          subChart.addSeries(LineSeries, { color: '#00D4AA60', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false }).setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
        }

        if (subPanel === 'KDJ' && data.indicators.kd) {
          const ks = subChart.addSeries(LineSeries, { color: '#3D8EF8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          const ds = subChart.addSeries(LineSeries, { color: '#FF4D6D', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          ks.setData(data.candles.map((c, i) => data.indicators.kd.k[i] != null ? { time: c.date as string, value: data.indicators.kd.k[i]! } : null).filter(Boolean) as { time: string; value: number }[]);
          ds.setData(data.candles.map((c, i) => data.indicators.kd.d[i] != null ? { time: c.date as string, value: data.indicators.kd.d[i]! } : null).filter(Boolean) as { time: string; value: number }[]);
        }
      }

      // ── Resize ────────────────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth });
        if (subEl && subChartRef.current) (subChartRef.current as { applyOptions: (o: object) => void }).applyOptions({ width: subEl.clientWidth });
      });
      ro.observe(container);
      return () => ro.disconnect();
    });

    return () => {
      if (chartRef.current)    { (chartRef.current    as { remove: () => void }).remove(); chartRef.current    = null; }
      if (subChartRef.current) { (subChartRef.current as { remove: () => void }).remove(); subChartRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, timeframe, subPanel]);

  if (isLoading) return <Skeleton style={{ height: 560, borderRadius: 8 }} />;
  if (error || !data) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      無法載入K線資料
    </div>
  );

  const btnBase: React.CSSProperties = { padding: '3px 10px', borderRadius: '4px', fontSize: 11, border: '1px solid #1E2235', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace" };
  const activeBtn = (on: boolean, color?: string): React.CSSProperties => ({ ...btnBase, background: on ? '#1E2235' : 'transparent', color: on ? (color ?? '#fff') : '#8B8FA8' });

  return (
    <div style={{ background: CHART_BG, borderRadius: 8, overflow: 'hidden', border: '1px solid #1E2235' }}>
      <OHLCBar
        candle={crosshairCandle ?? (data.candles.length > 0 ? data.candles[data.candles.length - 1] : null)}
        sma5={crossSma5} sma20={crossSma20} sma60={crossSma60}
      />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexWrap: 'wrap' }}>
        {(['D', 'W', 'M'] as Timeframe[]).map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)} style={activeBtn(timeframe === tf)}>{tf}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowMA5(!showMA5)}   style={activeBtn(showMA5,  '#3D8EF8')}>5MA</button>
        <button onClick={() => setShowMA20(!showMA20)} style={activeBtn(showMA20, '#F5B700')}>20MA</button>
        <button onClick={() => setShowMA60(!showMA60)} style={activeBtn(showMA60, '#9B59B6')}>60MA</button>
        <button onClick={() => setShowBB(!showBB)}     style={activeBtn(showBB)}>BB</button>
      </div>

      {/* Chart + overlays */}
      <div style={{ position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%' }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {patternPos.map((p, i)  => <PatternBadge  key={i} pattern={p.pattern} x={p.x} y={p.y} />)}
          {breakoutPos.map((b, i) => <BreakoutBadge key={i} signal={b.signal}   x={b.x} y={b.y} />)}
        </div>
      </div>

      {/* Sub-panel */}
      <div style={{ borderTop: `1px solid ${GRID_COLOR}` }}>
        <div style={{ display: 'flex', padding: '4px 12px 0' }}>
          {(['MACD', 'RSI', 'KDJ'] as SubPanel[]).map(p => (
            <button key={p} onClick={() => setSubPanel(p)} style={{ ...btnBase, border: 'none', borderBottom: subPanel === p ? '2px solid #3D8EF8' : '2px solid transparent', borderRadius: 0, background: 'transparent', color: subPanel === p ? '#fff' : '#8B8FA8', padding: '4px 12px' }}>{p}</button>
          ))}
        </div>
        <div ref={subRef} style={{ width: '100%' }} />
      </div>
    </div>
  );
}