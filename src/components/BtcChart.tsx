import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType, CandlestickSeries, LineSeries } from 'lightweight-charts';

export function BtcChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema5Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema13Ref = useRef<ISeriesApi<'Line'> | null>(null);

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
    ema5Ref.current = ema5;
    ema13Ref.current = ema13;

    // Fetch initial klines
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

        // Compute EMAs
        const closes = bars.map(b => b.close);
        const ema5Data = computeEMA(closes, 5).map((v, i) => ({ time: bars[i]!.time, value: v }));
        const ema13Data = computeEMA(closes, 13).map((v, i) => ({ time: bars[i]!.time, value: v }));
        ema5.setData(ema5Data);
        ema13.setData(ema13Data);
        chart.timeScale().fitContent();
      })
      .catch(() => {});

    // Live updates via WS
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const k = msg.k;
        if (!k) return;
        candles.update({
          time: (k.t / 1000) as unknown as import('lightweight-charts').UTCTimestamp,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
        });
      } catch {}
    };

    const onResize = () => { chart.applyOptions({ width: containerRef.current?.clientWidth ?? 600 }); };
    window.addEventListener('resize', onResize);

    return () => { ws.close(); chart.remove(); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-2 overflow-hidden">
      <div className="text-[10px] text-[var(--color-text-dim)] px-2 pb-1 flex items-center justify-between">
        <span>BTCUSDT 1m</span>
        <span className="flex gap-2">
          <span style={{ color: '#f59e0b' }}>EMA5</span>
          <span style={{ color: '#8b5cf6' }}>EMA13</span>
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
