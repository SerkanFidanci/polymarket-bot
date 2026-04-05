import { useEffect, useRef } from 'react';
import { createChart, type IChartApi, CandlestickSeries, LineSeries, ColorType } from 'lightweight-charts';

export function CandlestickChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  const ema5Ref = useRef<any>(null);
  const ema13Ref = useRef<any>(null);
  const vwapRef = useRef<any>(null);
  const lastKlineTime = useRef(0);

  // Initialize chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#636c7e',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1c2030' },
        horzLines: { color: '#1c2030' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: '#5c6bc0', width: 1, style: 2, labelBackgroundColor: '#5c6bc0' },
        horzLine: { color: '#5c6bc0', width: 1, style: 2, labelBackgroundColor: '#5c6bc0' },
      },
      rightPriceScale: {
        borderColor: '#2a2e3e',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#2a2e3e',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
      },
      autoSize: true,
    });

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    // EMA(5) - yellow
    const ema5 = chart.addSeries(LineSeries, {
      color: '#ffd54f',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // EMA(13) - orange
    const ema13 = chart.addSeries(LineSeries, {
      color: '#ff9800',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // VWAP - blue dashed
    const vwapLine = chart.addSeries(LineSeries, {
      color: '#42a5f5',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ema5Ref.current = ema5;
    ema13Ref.current = ema13;
    vwapRef.current = vwapLine;

    return () => {
      chart.remove();
    };
  }, []);

  // Update candles from kline data
  useEffect(() => {
    const interval = setInterval(() => {
      if (!candleSeriesRef.current) return;

      import('../websocket/BinanceWS.js').then(mod => {
        const klines = mod.binanceWS.klines;
        if (klines.length === 0) return;

        const candleData = klines.map(k => ({
          time: Math.floor(k.openTime / 1000) as any,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));

        const lastTime = klines[klines.length - 1]?.openTime ?? 0;
        if (lastTime !== lastKlineTime.current) {
          candleSeriesRef.current?.setData(candleData);
          lastKlineTime.current = lastTime;

          // EMA calculations
          const closes = klines.map(k => k.close);
          if (closes.length >= 5) {
            const ema5Data: any[] = [];
            const ema13Data: any[] = [];
            let e5 = closes[0]!;
            let e13 = closes[0]!;
            const m5 = 2 / 6;
            const m13 = 2 / 14;

            for (let i = 0; i < closes.length; i++) {
              e5 = (closes[i]! - e5) * m5 + e5;
              e13 = (closes[i]! - e13) * m13 + e13;
              const t = Math.floor(klines[i]!.openTime / 1000) as any;
              if (i >= 4) ema5Data.push({ time: t, value: e5 });
              if (i >= 12) ema13Data.push({ time: t, value: e13 });
            }
            ema5Ref.current?.setData(ema5Data);
            ema13Ref.current?.setData(ema13Data);
          }

          // VWAP
          if (klines.length >= 5) {
            let cumPV = 0, cumV = 0;
            const vwapData: any[] = [];
            for (let i = Math.max(0, klines.length - 30); i < klines.length; i++) {
              const k = klines[i]!;
              cumPV += k.close * k.volume;
              cumV += k.volume;
              if (cumV > 0) {
                vwapData.push({
                  time: Math.floor(k.openTime / 1000) as any,
                  value: cumPV / cumV,
                });
              }
            }
            vwapRef.current?.setData(vwapData);
          }
        } else {
          // Just update the last candle
          const last = klines[klines.length - 1]!;
          candleSeriesRef.current?.update({
            time: Math.floor(last.openTime / 1000) as any,
            open: last.open,
            high: last.high,
            low: last.low,
            close: last.close,
          });
        }
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">BTCUSDT</span>
          <span className="text-xs text-[var(--color-text-dim)]">1m</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] mono">
          <span className="text-[#ffd54f]">— EMA(5)</span>
          <span className="text-[#ff9800]">— EMA(13)</span>
          <span className="text-[#42a5f5]">- - VWAP</span>
        </div>
      </div>
      <div ref={containerRef} style={{ height: 400, width: '100%' }} />
    </div>
  );
}
