"use client";

import { useEffect, useRef } from "react";
import { PositionBoxPrimitive } from "./PositionBoxPrimitive";
import { Timeframe, TradeRecord, price, visibleWindow } from "@/lib/trades";

interface Props {
  trade: TradeRecord;
  timeframe: Timeframe;
  onSnapshot: (canvas: HTMLCanvasElement) => void;
}

function nearestBarTime(times: number[], instant: number) {
  return times.reduce((best, current) => Math.abs(current - instant) < Math.abs(best - instant) ? current : best, times[0]);
}

export function TradeChart({ trade, timeframe, onSnapshot }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    void (async () => {
      const host = hostRef.current;
      if (!host) return;
      const {
        CandlestickSeries,
        ColorType,
        LineStyle,
        createChart,
        createSeriesMarkers,
      } = await import("lightweight-charts");
      if (!alive) return;

      const bars = visibleWindow(trade, timeframe);
      const chart = createChart(host, {
        width: host.clientWidth,
        height: host.clientHeight,
        layout: { background: { type: ColorType.Solid, color: "#090b11" }, textColor: "#8e95a9", fontSize: 11 },
        grid: { vertLines: { color: "#171b26" }, horzLines: { color: "#171b26" } },
        rightPriceScale: { borderColor: "#252a36", scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderColor: "#252a36", timeVisible: true, secondsVisible: false, rightOffset: 2 },
        crosshair: { vertLine: { color: "#676f82" }, horzLine: { color: "#676f82" } },
        handleScroll: { vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#18b995", downColor: "#ef5a67", wickUpColor: "#18b995", wickDownColor: "#ef5a67", borderVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: 0.25 },
      });
      const data = bars.map((bar) => ({
        time: Math.floor(bar.time / 1000) as import("lightweight-charts").UTCTimestamp,
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
      }));
      series.setData(data);

      const times = bars.map((bar) => bar.time);
      const entryMs = nearestBarTime(times, Date.parse(trade.entry_time));
      const exitMs = nearestBarTime(times, Date.parse(trade.exit_time));
      const entryTime = Math.floor(entryMs / 1000) as import("lightweight-charts").UTCTimestamp;
      const exitTime = Math.floor(exitMs / 1000) as import("lightweight-charts").UTCTimestamp;
      const style = getComputedStyle(document.documentElement);
      const alpha = Number.parseFloat(style.getPropertyValue("--position-box-opacity")) || 0.28;
      const profit = style.getPropertyValue("--profit-emerald-rgb").trim() || "16, 185, 129";
      const risk = style.getPropertyValue("--risk-crimson-rgb").trim() || "239, 68, 68";
      const accent = style.getPropertyValue("--gold-mid").trim() || "#d4af37";
      const riskPrice = trade.stop_loss_price ?? trade.entry_price;
      const targetPrice = trade.planned_target_price ?? trade.exit_price;
      const outcomeIsProfit = (trade.exit_price - trade.entry_price) * (trade.direction === "LONG" ? 1 : -1) >= 0;
      const outcomeFill = trade.planned_target_price == null && !outcomeIsProfit ? `rgba(${risk}, ${alpha})` : `rgba(${profit}, ${alpha})`;
      const primitive = new PositionBoxPrimitive({
        entryTime, exitTime, entryPrice: trade.entry_price, exitPrice: trade.exit_price,
        riskPrice, targetPrice,
        profitFill: outcomeFill, riskFill: `rgba(${risk}, ${alpha})`, accent,
      });
      series.attachPrimitive(primitive);

      createSeriesMarkers(series, [
        { time: entryTime, position: trade.direction === "LONG" ? "belowBar" : "aboveBar", color: "#d4af37", shape: trade.direction === "LONG" ? "arrowUp" : "arrowDown", text: "ENTRY" },
        { time: exitTime, position: trade.direction === "LONG" ? "aboveBar" : "belowBar", color: "#f4f5f7", shape: trade.direction === "LONG" ? "arrowDown" : "arrowUp", text: "EXIT" },
      ]);
      if (trade.stop_loss_price != null) series.createPriceLine({ price: trade.stop_loss_price, color: "#ef4444", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "STOP" });
      if (trade.planned_target_price != null) series.createPriceLine({ price: trade.planned_target_price, color: "#10b981", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "TARGET" });
      if (trade.key_level_price != null) series.createPriceLine({ price: trade.key_level_price, color: accent, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "KEY" });

      const fit = () => chart.timeScale().setVisibleRange({ from: data[0].time, to: data[data.length - 1].time });
      fit();
      const resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
      resize.observe(host);
      const snapshotTimer = window.setTimeout(() => alive && onSnapshot(chart.takeScreenshot(true)), 220);
      host.dataset.ready = "true";
      host.addEventListener("mogmine-fit", fit);
      cleanup = () => { window.clearTimeout(snapshotTimer); resize.disconnect(); host.removeEventListener("mogmine-fit", fit); chart.remove(); };
    })();
    return () => { alive = false; cleanup(); };
  }, [trade, timeframe, onSnapshot]);

  return <div ref={hostRef} className="chart-host" aria-label={`${trade.direction === "LONG" ? "Long" : "Short"} ${trade.symbol}, entered at ${price(trade.entry_price)}, exited at ${price(trade.exit_price)}. Interactive candlestick chart with entry, exit, risk and target.`} />;
}
