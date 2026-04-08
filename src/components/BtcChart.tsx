import { useEffect, useRef, useCallback } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';

export function BtcChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  const loadMarkers = useCallback(async (candles: ISeriesApi<'Candlestick'>) => {
    try {
      // Only BASELINE + LATE_ENTRY (top performers, less clutter)
      const [blRes, lateRes] = await Promise.all([
        fetch('/api/training-rounds/trades'),
        fetch('/api/strategies/LATE_ENTRY/trades'),
      ]);

      const markers: Array<{ time: number; up: boolean; won: boolean }> = [];
      const cutoff = Date.now() - 2 * 60 * 60 * 1000; // only last 2 hours

      if (blRes.ok) {
        const trades = await blRes.json() as Array<{
          round_start_time: string; hypothetical_decision: string;
          actual_result: string;
        }>;
        trades.forEach(t => {
          const ts = new Date(t.round_start_time).getTime();
          if (ts < cutoff) return;
          const dir = t.hypothetical_decision === 'BUY_UP' ? 'UP' : 'DOWN';
          markers.push({ time: Math.floor(ts / 1000), up: dir === 'UP', won: dir === t.actual_result });
        });
      }

      if (lateRes.ok) {
        const trades = await lateRes.json() as Array<{
          created_at: string; decision: string; pnl: number;
        }>;
        trades.forEach(t => {
          const ts = new Date(t.created_at + 'Z').getTime();
          if (ts < cutoff) return;
          const dir = t.decision === 'BUY_UP' ? 'UP' : 'DOWN';
          markers.push({ time: Math.floor(ts / 1000), up: dir === 'UP', won: t.pnl >= 0 });
        });
      }

      // Deduplicate — only 1 marker per minute
      const seen = new Set<number>();
      const deduped = markers.filter(m => {
        const key = Math.floor(m.time / 60) * 60;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (deduped.length === 0) return;

      const chartMarkers = deduped
        .sort((a, b) => a.time - b.time)
        .map(m => ({
          time: m.time as unknown as import('lightweight-charts').UTCTimestamp,
          position: m.up ? 'belowBar' as const : 'aboveBar' as const,
          color: m.won ? '#22c55e' : '#ef4444',
          shape: m.up ? 'arrowUp' as const : 'arrowDown' as const,
          text: '',
          size: 0,
        }));

      /* eslint-disable @typescript-eslint/no-explicit-any */
      if (markersPluginRef.current) {
        (markersPluginRef.current as any).setMarkers(chartMarkers);
      } else {
        markersPluginRef.current = (createSeriesMarkers as any)(candles, chartMarkers);
      }
      /* eslint-enable @typescript-eslint/no-explicit-any */
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#14141f' }, textColor: '#64748b', fontSize: 10 },
      grid: { vertLines: { color: '#1e1e30' }, horzLines: { color: '#1e1e30' } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#2a2a3d' },
      timeScale: { borderColor: '#2a2a3d', timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 300,
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });
    candleRef.current = candles;

    const ema5 = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const ema13 = chart.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=120')
      .then(r => r.json())
      .then((data: (string | number)[][]) => {
        const bars = data.map(k => ({
          time: (k[0] as number) / 1000 as unknown as import('lightweight-charts').UTCTimestamp,
          open: parseFloat(k[1] as string),
          high: parseFloat(k[2] as string),
          low: parseFloat(k[3] as string),
          close: parseFloat(k[4] as string),
        }));
        candles.setData(bars);
        const closes = bars.map(b => b.close);
        ema5.setData(computeEMA(closes, 5).map((v, i) => ({ time: bars[i]!.time, value: v })));
        ema13.setData(computeEMA(closes, 13).map((v, i) => ({ time: bars[i]!.time, value: v })));
        chart.timeScale().fitContent();
        loadMarkers(candles);
      })
      .catch(() => {});

    const markerInterval = setInterval(() => { if (candleRef.current) loadMarkers(candleRef.current); }, 30000);

    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const k = msg.k;
        if (!k) return;
        candles.update({
          time: (k.t / 1000) as unknown as import('lightweight-charts').UTCTimestamp,
          open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: parseFloat(k.c),
        });
      } catch {}
    };

    const onResize = () => { chart.applyOptions({ width: containerRef.current?.clientWidth ?? 600 }); };
    window.addEventListener('resize', onResize);
    return () => { ws.close(); chart.remove(); clearInterval(markerInterval); window.removeEventListener('resize', onResize); };
  }, [loadMarkers]);

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-2 overflow-hidden">
      <div className="text-[10px] text-[var(--color-text-dim)] px-2 pb-1 flex items-center justify-between">
        <span>BTCUSDT 1m</span>
        <span className="flex gap-3">
          <span style={{ color: '#f59e0b' }}>EMA5</span>
          <span style={{ color: '#8b5cf6' }}>EMA13</span>
          <span className="text-[#22c55e]">▲ Win</span>
          <span className="text-[#ef4444]">▼ Loss</span>
        </span>
      </div>
      <div ref={containerRef} />
    </div>
  );
}

function computeEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const mult = 2 / (period + 1);
  let ema = data[0] ?? 0;
  for (let i = 0; i < data.length; i++) {
    ema = i === 0 ? data[i]! : (data[i]! - ema) * mult + ema;
    result.push(ema);
  }
  return result;
}
