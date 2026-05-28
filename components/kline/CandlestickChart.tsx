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

// ── Types ─────────────────────────────────────────────────────────────────────

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

type Timeframe  = 'D' | 'W' | 'M';
type SubPanel   = 'MACD' | 'RSI' | 'KDJ';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(r => r.json());

function aggregateWeekly(candles: Candle[]): Candle[] {
  const weeks: Record<string, Candle> = {};
  for (const c of candles) {
    const d    = new Date(c.date!);
    const day  = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    const mon  = new Date(d);
    mon.setUTCDate(diff);
    const key  = mon.toISOString().slice(0, 10);
    if (!weeks[key]) {
      weeks[key] = { ...c, date: key };
    } else {
      weeks[key].high   = Math.max(weeks[key].high, c.high);
      weeks[key].low    = Math.min(weeks[key].low,  c.low);
      weeks[key].close  = c.close;
      weeks[key].volume = (weeks[key].volume ?? 0) + (c.volume ?? 0);
    }
  }
  return Object.values(weeks).sort((a, b) => a.date!.localeCompare(b.date!));
}

function aggregateMonthly(candles: Candle[]): Candle[] {
  const months: Record<string, Candle> = {};
  for (const c of candles) {
    const key = c.date!.slice(0, 7); // YYYY-MM
    if (!months[key]) {
      months[key] = { ...c, date: `${key}-01` };
    } else {
      months[key].high   = Math.max(months[key].high, c.high);
      months[key].low    = Math.min(months[key].low,  c.low);
      months[key].close  = c.close;
      months[key].volume = (months[key].volume ?? 0) + (c.volume ?? 0);
    }
  }
  return Object.values(months).sort((a, b) => a.date!.localeCompare(b.date!));
}

function smaSeries(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((s, v) => s + v, 0) / period;
  });
}

// ── Color config ──────────────────────────────────────────────────────────────

const CHART_BG    = '#08090E';
const GRID_COLOR  = '#1E2235';
const TEXT_COLOR  = '#8B8FA8';
const UP_COLOR    = '#FF4D6D';   // red = up (Taiwan convention)
const DOWN_COLOR  = '#00D4AA';   // green = down

// ── Main Component ────────────────────────────────────────────────────────────

export function CandlestickChart({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useSWR<KlineData>(
    `/api/kline/${symbol}`,
    fetcher,
    { revalidateOnFocus: false },
  );

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<unknown>(null);
  const candleSeriesRef   = useRef<unknown>(null);
  const volumeSeriesRef   = useRef<unknown>(null);
  const ma5Ref            = useRef<unknown>(null);
  const ma20Ref           = useRef<unknown>(null);
  const ma60Ref           = useRef<unknown>(null);
  const bbUpperRef        = useRef<unknown>(null);
  const bbLowerRef        = useRef<unknown>(null);
  const subChartRef       = useRef<unknown>(null);

  const [timeframe,   setTimeframe]   = useState<Timeframe>('D');
  const [subPanel,    setSubPanel]    = useState<SubPanel>('MACD');
  const [showMA5,     setShowMA5]     = useState(true);
  const [showMA20,    setShowMA20]    = useState(true);
  const [showMA60,    setShowMA60]    = useState(true);
  const [showBB,      setShowBB]      = useState(false);
  const [crosshairCandle, setCrosshairCandle] = useState<Candle | null>(null);
  const [crosshairSma5,   setCrosshairSma5]   = useState<number | null>(null);
  const [crosshairSma20,  setCrosshairSma20]  = useState<number | null>(null);
  const [crosshairSma60,  setCrosshairSma60]  = useState<number | null>(null);

  // Badge overlay positions
  const [patternPositions,  setPatternPositions]  = useState<{ pattern: DetectedPattern; x: number; y: number }[]>([]);
  const [breakoutPositions, setBreakoutPositions] = useState<{ signal: BreakoutSignal; x: number; y: number }[]>([]);

  // Get the display candles based on timeframe
  const getDisplayCandles = useCallback((): Candle[] => {
    if (!data?.candles) return [];
    if (timeframe === 'W') return aggregateWeekly(data.candles);
    if (timeframe === 'M') return aggregateMonthly(data.candles);
    return data.candles;
  }, [data, timeframe]);

  // ── Build and render chart ─────────────────────────────────────────────────
  useEffect(() => {
    if (!data || !chartContainerRef.current) return;

    let chart: ReturnType<typeof import('lightweight-charts')['createChart']>;

    import('lightweight-charts').then(({ createChart, CrosshairMode, LineStyle }) => {
      // Destroy previous instance
      if (chartRef.current) {
        (chartRef.current as ReturnType<typeof createChart>).remove();
        chartRef.current = null;
      }

      const container = chartContainerRef.current!;
      const candles   = getDisplayCandles();
      const closes    = candles.map(c => c.close);

      // ── Create chart ──────────────────────────────────────────────────────
      chart = createChart(container, {
        width:  container.clientWidth,
        height: 380,
        layout: {
          background:    { color: CHART_BG },
          textColor:     TEXT_COLOR,
          fontFamily:    "'IBM Plex Mono', monospace",
          fontSize:      11,
        },
        grid: {
          vertLines:   { color: GRID_COLOR },
          horzLines:   { color: GRID_COLOR },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: GRID_COLOR,
          scaleMargins: { top: 0.1, bottom: 0.3 },
        },
        timeScale: {
          borderColor:     GRID_COLOR,
          timeVisible:     true,
          secondsVisible:  false,
        },
      });

      chartRef.current = chart;

      // ── Candlestick series ────────────────────────────────────────────────
      const candleSeries = chart.addCandlestickSeries({
        upColor:          UP_COLOR,
        downColor:        DOWN_COLOR,
        borderUpColor:    UP_COLOR,
        borderDownColor:  DOWN_COLOR,
        wickUpColor:      UP_COLOR,
        wickDownColor:    DOWN_COLOR,
      });

      candleSeriesRef.current = candleSeries;

      const chartData = candles.map(c => ({
        time:  c.date as string,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }));
      candleSeries.setData(chartData);

      // ── Volume histogram ──────────────────────────────────────────────────
      const volSeries = chart.addHistogramSeries({
        color:       '#3D8EF840',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volSeries.setData(
        candles.map(c => ({
          time:  c.date as string,
          value: c.volume ?? 0,
          color: c.close >= c.open
            ? `${UP_COLOR}66`
            : `${DOWN_COLOR}66`,
        })),
      );
      volumeSeriesRef.current = volSeries;

      // ── MA lines ──────────────────────────────────────────────────────────
      const sma5vals  = smaSeries(closes, 5);
      const sma20vals = smaSeries(closes, 20);
      const sma60vals = smaSeries(closes, 60);

      function makeMASeries(color: string, visible: boolean) {
        const s = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        if (!visible) s.applyOptions({ visible: false });
        return s;
      }

      const ma5Series  = makeMASeries('#3D8EF8', showMA5);
      const ma20Series = makeMASeries('#F5B700', showMA20);
      const ma60Series = makeMASeries('#9B59B6', showMA60);

      ma5Series.setData(candles.map((c, i) => sma5vals[i]  != null ? { time: c.date as string, value: sma5vals[i]!  } : null).filter(Boolean) as never[]);
      ma20Series.setData(candles.map((c, i) => sma20vals[i] != null ? { time: c.date as string, value: sma20vals[i]! } : null).filter(Boolean) as never[]);
      ma60Series.setData(candles.map((c, i) => sma60vals[i] != null ? { time: c.date as string, value: sma60vals[i]! } : null).filter(Boolean) as never[]);

      ma5Ref.current  = ma5Series;
      ma20Ref.current = ma20Series;
      ma60Ref.current = ma60Series;

      // ── Bollinger bands ───────────────────────────────────────────────────
      if (data.indicators.bb && timeframe === 'D') {
        const bbUpper = chart.addLineSeries({
          color: '#8B8FA840', lineWidth: 1, lineStyle: LineStyle.Dashed,
          priceLineVisible: false, lastValueVisible: false,
        });
        const bbLower = chart.addLineSeries({
          color: '#8B8FA840', lineWidth: 1, lineStyle: LineStyle.Dashed,
          priceLineVisible: false, lastValueVisible: false,
        });
        bbUpper.applyOptions({ visible: showBB });
        bbLower.applyOptions({ visible: showBB });

        bbUpper.setData(
          data.indicators.bb.upper
            .map((v, i) => v != null ? { time: data.candles[i].date as string, value: v } : null)
            .filter(Boolean) as never[],
        );
        bbLower.setData(
          data.indicators.bb.lower
            .map((v, i) => v != null ? { time: data.candles[i].date as string, value: v } : null)
            .filter(Boolean) as never[],
        );
        bbUpperRef.current = bbUpper;
        bbLowerRef.current = bbLower;
      }

      // ── Breakout markers ──────────────────────────────────────────────────
      if (timeframe === 'D' && data.breakouts.length > 0) {
        const markers = data.breakouts.map(b => {
          const cfg = {
            '上漲趨勢突破': { color: '#3D8EF8', shape: 'arrowUp' as const, text: '趨勢↑' },
            '箱型整理突破': { color: '#F5B700', shape: 'arrowUp' as const, text: '箱型↑' },
            '下跌V轉突破':  { color: '#FF4D6D', shape: 'arrowUp' as const, text: 'V轉↑'  },
          }[b.type];
          return {
            time:     b.date as string,
            position: 'belowBar' as const,
            color:    cfg.color,
            shape:    cfg.shape,
            text:     cfg.text,
          };
        });
        candleSeries.setMarkers(markers);

        // Box boundary lines for 箱型 signals
        for (const b of data.breakouts.filter(x => x.type === '箱型整理突破')) {
          if (b.keyLevels.boxUpper) {
            chart.addLineSeries({
              color: '#F5B70060', lineWidth: 1, lineStyle: LineStyle.Dashed,
              priceLineVisible: false, lastValueVisible: false,
            }).setData([
              { time: data.candles[0].date as string, value: b.keyLevels.boxUpper },
              { time: b.date as string,                value: b.keyLevels.boxUpper },
            ]);
          }
          if (b.keyLevels.boxLower) {
            chart.addLineSeries({
              color: '#F5B70060', lineWidth: 1, lineStyle: LineStyle.Dashed,
              priceLineVisible: false, lastValueVisible: false,
            }).setData([
              { time: data.candles[0].date as string, value: b.keyLevels.boxLower },
              { time: b.date as string,                value: b.keyLevels.boxLower },
            ]);
          }
        }
      }

      // ── Crosshair → OHLCBar ───────────────────────────────────────────────
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData) {
          setCrosshairCandle(null);
          return;
        }
        const bar = param.seriesData.get(candleSeries) as { open: number; high: number; low: number; close: number } | undefined;
        if (!bar) return;

        const idx = candles.findIndex(c => c.date === (param.time as string));
        setCrosshairCandle({ ...bar, date: param.time as string, volume: candles[idx]?.volume });
        setCrosshairSma5(idx >= 0 ? (sma5vals[idx] ?? null) : null);
        setCrosshairSma20(idx >= 0 ? (sma20vals[idx] ?? null) : null);
        setCrosshairSma60(idx >= 0 ? (sma60vals[idx] ?? null) : null);

        // Update HTML badge positions
        if (timeframe === 'D') {
          const newPatterns = data.patterns.map(p => {
            const c = data.candles[p.candleIndex];
            if (!c) return null;
            const xCoord = chart.timeScale().timeToCoordinate(c.date as string);
            const yCoord = candleSeries.priceToCoordinate(c.high);
            if (xCoord == null || yCoord == null) return null;
            return { pattern: p, x: xCoord, y: yCoord };
          }).filter(Boolean) as { pattern: DetectedPattern; x: number; y: number }[];
          setPatternPositions(newPatterns);

          const newBreakouts = data.breakouts.map(b => {
            const xCoord = chart.timeScale().timeToCoordinate(b.date as string);
            const yCoord = candleSeries.priceToCoordinate(b.price);
            if (xCoord == null || yCoord == null) return null;
            return { signal: b, x: xCoord, y: yCoord };
          }).filter(Boolean) as { signal: BreakoutSignal; x: number; y: number }[];
          setBreakoutPositions(newBreakouts);
        }
      });

      // ── Sub-panel chart (MACD / RSI / KDJ) ───────────────────────────────
      const subContainer = document.getElementById(`sub-chart-${symbol}`);
      if (subContainer && timeframe === 'D') {
        if (subChartRef.current) {
          (subChartRef.current as ReturnType<typeof createChart>).remove();
          subChartRef.current = null;
        }

        const subChart = createChart(subContainer, {
          width:  subContainer.clientWidth,
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
          const histSeries = subChart.addHistogramSeries({ color: '#3D8EF860', priceLineVisible: false });
          histSeries.setData(
            data.candles.map((c, i) => histogram[i] != null
              ? { time: c.date as string, value: histogram[i]!, color: histogram[i]! >= 0 ? `${UP_COLOR}80` : `${DOWN_COLOR}80` }
              : null).filter(Boolean) as never[],
          );
          const macdSeries = subChart.addLineSeries({ color: '#3D8EF8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          macdSeries.setData(data.candles.map((c, i) => macdLine[i] != null ? { time: c.date as string, value: macdLine[i]! } : null).filter(Boolean) as never[]);
          const signalSeries = subChart.addLineSeries({ color: '#FF4D6D', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          signalSeries.setData(data.candles.map((c, i) => signalLine[i] != null ? { time: c.date as string, value: signalLine[i]! } : null).filter(Boolean) as never[]);
        }

        if (subPanel === 'RSI' && data.indicators.rsi14) {
          const rsiSeries = subChart.addLineSeries({ color: '#9B59B6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          rsiSeries.setData(data.candles.map((c, i) => data.indicators.rsi14[i] != null ? { time: c.date as string, value: data.indicators.rsi14[i]! } : null).filter(Boolean) as never[]);
          // Overbought/oversold lines
          const ob = subChart.addLineSeries({ color: '#FF4D6D60', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
          const os = subChart.addLineSeries({ color: '#00D4AA60', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
          const first = data.candles[0].date as string;
          const last  = data.candles[data.candles.length - 1].date as string;
          ob.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
          os.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
        }

        if (subPanel === 'KDJ' && data.indicators.kd) {
          const kSeries = subChart.addLineSeries({ color: '#3D8EF8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          const dSeries = subChart.addLineSeries({ color: '#FF4D6D', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
          kSeries.setData(data.candles.map((c, i) => data.indicators.kd.k[i] != null ? { time: c.date as string, value: data.indicators.kd.k[i]! } : null).filter(Boolean) as never[]);
          dSeries.setData(data.candles.map((c, i) => data.indicators.kd.d[i] != null ? { time: c.date as string, value: data.indicators.kd.d[i]! } : null).filter(Boolean) as never[]);
        }
      }

      // ── Resize observer ───────────────────────────────────────────────────
      const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth });
        if (subContainer && subChartRef.current) {
          (subChartRef.current as ReturnType<typeof createChart>).applyOptions({ width: subContainer.clientWidth });
        }
      });
      ro.observe(container);

      return () => {
        ro.disconnect();
      };
    });

    return () => {
      if (chartRef.current) {
        (chartRef.current as ReturnType<typeof import('lightweight-charts')['createChart']>).remove();
        chartRef.current = null;
      }
      if (subChartRef.current) {
        (subChartRef.current as ReturnType<typeof import('lightweight-charts')['createChart']>).remove();
        subChartRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, timeframe, subPanel]);

  // Toggle visibility without rebuilding chart
  useEffect(() => {
    if (ma5Ref.current)  (ma5Ref.current  as { applyOptions: (o: object) => void }).applyOptions({ visible: showMA5  });
    if (ma20Ref.current) (ma20Ref.current as { applyOptions: (o: object) => void }).applyOptions({ visible: showMA20 });
    if (ma60Ref.current) (ma60Ref.current as { applyOptions: (o: object) => void }).applyOptions({ visible: showMA60 });
  }, [showMA5, showMA20, showMA60]);

  useEffect(() => {
    if (bbUpperRef.current) (bbUpperRef.current as { applyOptions: (o: object) => void }).applyOptions({ visible: showBB });
    if (bbLowerRef.current) (bbLowerRef.current as { applyOptions: (o: object) => void }).applyOptions({ visible: showBB });
  }, [showBB]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <Skeleton style={{ height: 560, borderRadius: 8 }} />;
  if (error || !data) return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      無法載入K線資料
    </div>
  );

  const btnBase: React.CSSProperties = {
    padding:      '3px 10px',
    borderRadius: '4px',
    fontSize:     11,
    border:       '1px solid #1E2235',
    cursor:       'pointer',
    fontFamily:   "'IBM Plex Mono', monospace",
  };

  const activeBtn = (active: boolean): React.CSSProperties => ({
    ...btnBase,
    background: active ? '#1E2235' : 'transparent',
    color:      active ? '#fff'     : '#8B8FA8',
  });

  return (
    <div style={{ background: CHART_BG, borderRadius: 8, overflow: 'hidden', border: '1px solid #1E2235' }}>

      {/* ── OHLC bar ───────────────────────────────────────────────────────── */}
      <OHLCBar
        candle={crosshairCandle ?? (data.candles.length > 0 ? data.candles[data.candles.length - 1] : null)}
        sma5={crosshairSma5}
        sma20={crosshairSma20}
        sma60={crosshairSma60}
      />

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexWrap: 'wrap' }}>
        {/* Timeframe */}
        {(['D', 'W', 'M'] as Timeframe[]).map(tf => (
          <button key={tf} onClick={() => setTimeframe(tf)} style={activeBtn(timeframe === tf)}>{tf}</button>
        ))}

        <div style={{ flex: 1 }} />

        {/* MA toggles */}
        <button onClick={() => setShowMA5(!showMA5)}   style={{ ...activeBtn(showMA5),  color: showMA5  ? '#3D8EF8' : '#8B8FA8' }}>5MA</button>
        <button onClick={() => setShowMA20(!showMA20)} style={{ ...activeBtn(showMA20), color: showMA20 ? '#F5B700' : '#8B8FA8' }}>20MA</button>
        <button onClick={() => setShowMA60(!showMA60)} style={{ ...activeBtn(showMA60), color: showMA60 ? '#9B59B6' : '#8B8FA8' }}>60MA</button>
        <button onClick={() => setShowBB(!showBB)}     style={activeBtn(showBB)}>BB</button>
      </div>

      {/* ── Chart canvas (relative for overlay badges) ────────────────────── */}
      <div style={{ position: 'relative' }}>
        <div ref={chartContainerRef} style={{ width: '100%' }} />

        {/* HTML overlay badges */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {patternPositions.map((p, i) => (
            <PatternBadge key={i} pattern={p.pattern} x={p.x} y={p.y} />
          ))}
          {breakoutPositions.map((b, i) => (
            <BreakoutBadge key={i} signal={b.signal} x={b.x} y={b.y} />
          ))}
        </div>
      </div>

      {/* ── Sub-panel tabs ────────────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${GRID_COLOR}` }}>
        <div style={{ display: 'flex', gap: 0, padding: '4px 12px 0' }}>
          {(['MACD', 'RSI', 'KDJ'] as SubPanel[]).map(p => (
            <button
              key={p}
              onClick={() => setSubPanel(p)}
              style={{
                ...btnBase,
                border:       'none',
                borderBottom: subPanel === p ? '2px solid #3D8EF8' : '2px solid transparent',
                borderRadius: 0,
                background:   'transparent',
                color:        subPanel === p ? '#fff' : '#8B8FA8',
                padding:      '4px 12px',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div id={`sub-chart-${symbol}`} style={{ width: '100%' }} />
      </div>
    </div>
  );
}
