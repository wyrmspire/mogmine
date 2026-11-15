"use client";

import { useEffect, useRef } from "react";
import { PositionBoxPrimitive } from "./PositionBoxPrimitive";
import { formatPrice } from "@/lib/format";
import { getTheme } from "@/lib/theme";
import { chartCrosshairLabel, chartTickLabel } from "@/lib/time";
import { aggregateCandles, fitPadding, snapToBar, specFor } from "@/lib/trades";
import type { Candle, Timeframe, TradeRecord } from "@/lib/trades";

interface Props {
  trade: TradeRecord;
  candles: Candle[];
  timeframe: Timeframe;
  zone: string;
  onSnapshot: (canvas: HTMLCanvasElement) => void;
}

export function TradeChart({ trade, candles, timeframe, zone, onSnapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    void (async () => {
      const host = hostRef.current;
      if (!host) return;
      const { CandlestickSeries, ColorType, LineStyle, createChart, createSeriesMarkers } = await import("lightweight-charts");
      type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
      type Time = import("lightweight-charts").Time;
      if (!alive) return;

      const theme = getTheme();
      const bars = aggregateCandles(candles, timeframe);
      if (!bars.length) return;
      const chart = createChart(host, {
        width: host.clientWidth,
        height: host.clientHeight,
        layout: { background: { type: ColorType.Solid, color: theme.chartBg }, textColor: theme.chartAxis, fontSize: 11 },
        grid: { vertLines: { color: theme.chartGrid }, horzLines: { color: theme.chartGrid } },
        rightPriceScale: { borderColor: theme.chartBorder, scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderColor: theme.chartBorder, timeVisible: true, secondsVisible: false, rightOffset: 2, tickMarkFormatter: (time: Time, tickMarkType: number) => chartTickLabel(time as number, tickMarkType, zone) },
        localization: { timeFormatter: (time: Time) => chartCrosshairLabel(time as number, zone) },
        crosshair: { vertLine: { color: theme.crosshair }, horzLine: { color: theme.crosshair } },
        handleScroll: { vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: theme.candleUp, downColor: theme.candleDown, wickUpColor: theme.candleUp, wickDownColor: theme.candleDown, borderVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol).tickSize },
      });
      const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
      series.setData(bars.map((bar) => ({ time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));

      // Fill times are snapped to their bar before they reach the time scale (B-23).
      const times = bars.map((bar) => bar.time);
      const entryMs = Date.parse(trade.entry_time);
      const exitMs = Date.parse(trade.exit_time);
      const entryTime = toTime(snapToBar(times, entryMs, timeframe));
      const exitTime = toTime(snapToBar(times, exitMs, timeframe));
      const outcomeIsProfit = (trade.exit_price - trade.entry_price) * (trade.direction === "LONG" ? 1 : -1) >= 0;
      const primitive = new PositionBoxPrimitive({
        entryTime, exitTime, entryPrice: trade.entry_price, exitPrice: trade.exit_price,
        riskPrice: trade.stop_loss_price ?? trade.entry_price,
        targetPrice: trade.planned_target_price ?? trade.exit_price,
        profitColor: trade.planned_target_price == null && !outcomeIsProfit ? theme.risk : theme.profit,
        riskColor: theme.risk, accent: theme.goldMid, opacity: theme.boxOpacity,
      });
      series.attachPrimitive(primitive);

      createSeriesMarkers(series, [
        { time: entryTime, position: trade.direction === "LONG" ? "belowBar" : "aboveBar", color: theme.goldMid, shape: trade.direction === "LONG" ? "arrowUp" : "arrowDown", text: "ENTRY" },
        { time: exitTime, position: trade.direction === "LONG" ? "aboveBar" : "belowBar", color: theme.textPrimary, shape: trade.direction === "LONG" ? "arrowDown" : "arrowUp", text: "EXIT" },
      ]);
      if (trade.stop_loss_price != null) series.createPriceLine({ price: trade.stop_loss_price, color: theme.risk, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "STOP" });
      if (trade.planned_target_price != null) series.createPriceLine({ price: trade.planned_target_price, color: theme.profit, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "TARGET" });
      if (trade.key_level_price != null) series.createPriceLine({ price: trade.key_level_price, color: theme.goldMid, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "KEY" });

      const pad = fitPadding(trade.trade_style);
      const from = toTime(snapToBar(times, entryMs - pad.before * 60_000, timeframe));
      const to = toTime(snapToBar(times, exitMs + pad.after * 60_000, timeframe));
      const fit = () => chart.timeScale().setVisibleRange({ from, to });
      fit();
      const resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
      resize.observe(host);
      const snapshotTimer = window.setTimeout(() => alive && onSnapshot(chart.takeScreenshot(true)), 220);
      host.dataset.ready = "true";
      host.addEventListener("mogmine-fit", fit);
      cleanup = () => { window.clearTimeout(snapshotTimer); resize.disconnect(); host.removeEventListener("mogmine-fit", fit); chart.remove(); delete host.dataset.ready; };
    })();
    return () => { alive = false; cleanup(); };
  }, [trade, candles, timeframe, zone, onSnapshot]);

  return <div ref={hostRef} className="chart-host" role="img" aria-label={`${trade.direction === "LONG" ? "Long" : "Short"} ${trade.symbol}, entered at ${formatPrice(trade.entry_price, trade.symbol)}, exited at ${formatPrice(trade.exit_price, trade.symbol)}. Candlestick chart with entry, exit, risk and target.`} />;
}
