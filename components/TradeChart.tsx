"use client";

import { useEffect, useImperativeHandle, useRef, useSyncExternalStore } from "react";
import type { Ref, RefObject } from "react";
import { PositionBoxPrimitive } from "./PositionBoxPrimitive";
import type { PositionBoxConfig } from "./PositionBoxPrimitive";
import { describeTrade } from "@/lib/describe";
import { approx, formatMoney, formatPoints, formatPrice, formatR } from "@/lib/format";
import { getTheme, subscribeTheme } from "@/lib/theme";
import type { ChartTheme } from "@/lib/theme";
import { chartCrosshairLabel, chartTickLabel } from "@/lib/time";
import { TIMEFRAME_MINUTES, aggregateCandles, exitFlagReason, excursions, fitWindow, includeInPriceRange, isScratch, mergeAxisTags, plannedR, rMultiple, snapToBar, specFor, tickDecimals, toTicks, tradePnl, tradePoints } from "@/lib/trades";
import type { Candle, Timeframe, TradeRecord } from "@/lib/trades";

type LWC = typeof import("lightweight-charts");
type IChartApi = import("lightweight-charts").IChartApi;
type CandleSeries = import("lightweight-charts").ISeriesApi<"Candlestick">;
type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
type Time = import("lightweight-charts").Time;
type IPriceLine = import("lightweight-charts").IPriceLine;
type AutoscaleInfoProvider = import("lightweight-charts").AutoscaleInfoProvider;

export interface TradeChartHandle {
  /** Snap the view back to the padded trade window. */
  fit(): void;
  /** The chart as an image, primitives included (B-61). Null until the chart is ready. */
  screenshot(): HTMLCanvasElement | null;
  setXray(on: boolean): void;
}

interface Props {
  ref?: Ref<TradeChartHandle>;
  trade: TradeRecord;
  candles: Candle[];
  /** Minutes per bar of `candles` (1 unless Yahoo no longer serves 1m for this trade). */
  baseTimeframe: Timeframe;
  timeframe: Timeframe;
  zone: string;
  /** Shield / privacy: the on-chart pill shows R and points, never dollars (UX-71). */
  privacy: boolean;
  /** Element that shows OHLC while the crosshair is tracking. Written directly, not through React. */
  readout?: RefObject<HTMLElement | null>;
  /** Called shortly after every redraw, once an up-to-date screenshot can be taken. */
  onRendered?: () => void;
  /** Whether the visible range is still the fitted trade window. */
  onFitChange?: (fitted: boolean) => void;
  /** Whether X-Ray mode is currently active (button, touch tracking, or hold X). */
  onXrayChange?: (active: boolean) => void;
}

interface Live {
  lwc: LWC;
  chart: IChartApi;
  series: CandleSeries;
  primitive: PositionBoxPrimitive;
  lines: IPriceLine[];
  fitRange: { from: number; to: number } | null;
  renderedKey: string;
  touchTracking: boolean;
  xrayPinned: boolean;
  xrayKey: boolean;
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

function signedLevel(points: number, symbol: string) {
  const decimals = Math.max(2, tickDecimals(specFor(symbol).tickSize));
  return `${points < 0 ? "−" : "+"}${Math.abs(points).toFixed(decimals)}`;
}


export function TradeChart({ ref, trade, candles, baseTimeframe, timeframe, zone, privacy, readout, onRendered, onFitChange, onXrayChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => null);
  const latest = useRef({ trade, candles, baseTimeframe, timeframe, zone, privacy, theme, readout, onRendered, onFitChange, onXrayChange });
  const renderTimer = useRef<number | undefined>(undefined);
  const diagnosticTimeframe = TIMEFRAME_MINUTES[timeframe] <= TIMEFRAME_MINUTES[baseTimeframe] ? baseTimeframe : timeframe;
  const diagnosticWindow = fitWindow(trade.entry_time, trade.exit_time, diagnosticTimeframe);

  useEffect(() => { latest.current = { trade, candles, baseTimeframe, timeframe, zone, privacy, theme, readout, onRendered, onFitChange, onXrayChange }; });

  useImperativeHandle(ref, () => ({
    fit: () => { const l = live.current; if (l?.fitRange) { l.chart.priceScale("right").applyOptions({ autoScale: true }); l.chart.timeScale().setVisibleLogicalRange(l.fitRange); } },
    screenshot: () => live.current?.chart.takeScreenshot(true, false) ?? null,
    setXray: (on: boolean) => { const l = live.current; if (l) { l.xrayPinned = on; const active = on || l.touchTracking || l.xrayKey; l.primitive.setXray(active); latest.current.onXrayChange?.(active); } },
  }), []);

  // Draws the current props onto the existing chart. Switching timeframe only swaps data: the chart
  // is never rebuilt, so it is fast (UX-02) and the Position Box is re-snapped to the new bars (UX-20).
  const draw = useRef((refit: boolean) => {
    const l = live.current;
    const p = latest.current;
    if (!l || !p.theme) return;
    const t: ChartTheme = p.theme;
    const { trade: tr } = p;
    const baseMinutes = TIMEFRAME_MINUTES[p.baseTimeframe];
    const bars = TIMEFRAME_MINUTES[p.timeframe] <= baseMinutes ? p.candles : aggregateCandles(p.candles, p.timeframe);
    if (!bars.length) return;
    const barTimeframe = TIMEFRAME_MINUTES[p.timeframe] <= baseMinutes ? p.baseTimeframe : p.timeframe;

    l.chart.applyOptions({
      layout: { background: { type: l.lwc.ColorType.Solid, color: t.chartBg }, textColor: t.chartAxis },
      grid: { vertLines: { color: t.chartGrid }, horzLines: { color: t.chartGrid } },
      rightPriceScale: { borderColor: t.chartBorder },
      timeScale: { borderColor: t.chartBorder, tickMarkFormatter: (time: Time, type: number) => chartTickLabel(time as number, type, p.zone) },
      localization: { timeFormatter: (time: Time) => chartCrosshairLabel(time as number, p.zone) },
      crosshair: { vertLine: { color: t.crosshair, labelBackgroundColor: t.elevated }, horzLine: { color: t.crosshair, labelBackgroundColor: t.elevated } },
    });
    l.series.applyOptions({
      upColor: t.candleUp,
      downColor: t.candleDown,
      wickUpColor: t.candleUp,
      wickDownColor: t.candleDown,
      // The series owns autoscale, so merge these trade prices into the candle range as well as
      // exposing them from the primitive. Planned TP, SL and the actual exit must never be clipped.
      autoscaleInfoProvider: ((baseImplementation) => {
        const base = baseImplementation();
        const priceRange = includeInPriceRange(base?.priceRange ?? null, [tr.entry_price, tr.exit_price, tr.stop_loss_price, tr.planned_target_price]);
        return priceRange ? { ...(base ?? {}), priceRange } : base;
      }) satisfies AutoscaleInfoProvider,
    });

    const dataKey = `${p.timeframe}|${bars.length}|${bars[0].time}|${bars[bars.length - 1].time}`;
    const dataChanged = dataKey !== l.renderedKey;
    if (dataChanged) {
      l.series.setData(bars.map((bar) => ({ time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
      l.renderedKey = dataKey;
    }

    // Fill times are snapped to their bar before they reach the time scale (B-23).
    const times = bars.map((bar) => bar.time);
    const entryMs = Date.parse(tr.entry_time);
    const exitMs = Date.parse(tr.exit_time);
    const entryBar = snapToBar(times, entryMs, barTimeframe);
    const exitBar = snapToBar(times, exitMs, barTimeframe);
    const isLong = tr.direction === "LONG";
    const pnl = tradePnl(tr);
    const r = rMultiple(tr);
    const points = formatPoints(tradePoints(tr), tr.symbol);
    const ex = excursions(tr, p.candles, baseMinutes);
    const scratch = isScratch(tr);
    const sign = isLong ? 1 : -1;
    const maePoints = ex ? (ex.maePrice - tr.entry_price) * sign : null;
    const mfePoints = ex ? (ex.mfePrice - tr.entry_price) * sign : null;
    const maePrice = maePoints != null && maePoints < 0 ? ex!.maePrice : null;
    const mfePrice = mfePoints != null && mfePoints > 0 ? ex!.mfePrice : null;
    const near = (price: number | null, level: number | null) => (
      price != null && level != null && Math.abs(toTicks(price, tr.symbol) - toTicks(level, tr.symbol)) <= 2
    );
    const plan = plannedR(tr);
    const config: PositionBoxConfig = {
      entryTime: toTime(entryBar), exitTime: toTime(exitBar),
      entryPrice: tr.entry_price, exitPrice: tr.exit_price,
      stopPrice: tr.stop_loss_price, targetPrice: tr.planned_target_price,
      maePrice, mfePrice, isLong, scratch,
      pill: p.privacy ? (r != null ? `${formatR(r)} · ${points}` : points) : (r != null ? `${formatR(r)} · ${formatMoney(pnl)}` : formatMoney(pnl)),
      pillTone: scratch ? "neutral" : pnl > 0 ? "profit" : pnl < 0 ? "risk" : "neutral",
      profitColor: t.profit, riskColor: t.risk, profitTextColor: t.profitText, riskTextColor: t.lossText,
      frameColor: t.boxActual, planColor: t.boxPlanned, mutedColor: t.textMuted,
      pillBackground: t.surface, textColor: t.textPrimary, opacity: t.boxOpacity,
      stopLabel: tr.stop_loss_price != null ? "SL (initial)" : "",
      targetLabel: tr.planned_target_price != null ? (plan != null ? `TP ${formatR(plan)}` : "TP") : "",
      exitReason: exitFlagReason(tr),
      maeLabel: maePrice != null && !near(maePrice, tr.stop_loss_price) && !near(maePrice, tr.exit_price) ? `MAE ${approx(signedLevel(maePoints!, tr.symbol))}` : null,
      mfeLabel: mfePrice != null && !near(mfePrice, tr.planned_target_price) && !near(mfePrice, tr.exit_price) ? `MFE ${approx(signedLevel(mfePoints!, tr.symbol))}` : null,
    };
    l.primitive.update(config);

    // Axis tags for the selected trade only; merge titles when prices coincide (SL · OUT).
    l.lines.forEach((line) => l.series.removePriceLine(line));
    l.lines = [];
    for (const tag of mergeAxisTags([
      { price: tr.stop_loss_price, color: t.risk, title: "SL" },
      { price: tr.planned_target_price, color: t.profit, title: "TP" },
      { price: tr.entry_price, color: t.boxActual, title: "IN" },
      { price: tr.exit_price, color: t.boxActual, title: "OUT" },
      { price: tr.key_level_price, color: t.goldMid, title: "KEY", lineVisible: true },
    ], tr.symbol)) {
      l.lines.push(l.series.createPriceLine({
        price: tag.price, color: tag.color, title: tag.title,
        lineStyle: l.lwc.LineStyle.Dotted, lineWidth: 1, lineVisible: tag.lineVisible, axisLabelVisible: true,
      }));
    }

    // Recompute in bars for this timeframe. Coarser bars therefore show wider clock-time context.
    const fittedWindow = fitWindow(tr.entry_time, tr.exit_time, barTimeframe);
    const entryIndex = times.indexOf(entryBar);
    const fitFrom = entryIndex - fittedWindow.beforeBars;
    l.fitRange = { from: fitFrom, to: fitFrom + fittedWindow.visibleBars };
    if (refit || dataChanged) l.chart.timeScale().setVisibleLogicalRange(l.fitRange);

    window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => latest.current.onRendered?.(), 260);
  });

  // Build the chart once per trade and candle set.
  useEffect(() => {
    let alive = true;
    let cleanup = () => {};
    void (async () => {
      const host = hostRef.current;
      if (!host) return;
      const lwc = await import("lightweight-charts");
      if (!alive) return;
      const chart = lwc.createChart(host, {
        width: host.clientWidth,
        height: host.clientHeight,
        layout: { fontSize: 11, attributionLogo: true },
        rightPriceScale: { scaleMargins: { top: 0.14, bottom: 0.12 } },
        timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 0 },
        // A vertical swipe that starts on the chart scrolls the page (UX-41). The chart owns pinch (UX-44).
        handleScroll: { vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      });
      const series = chart.addSeries(lwc.CandlestickSeries, {
        borderVisible: false, priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol).tickSize },
      });
      const primitive = new PositionBoxPrimitive({
        entryTime: 0 as UTCTimestamp, exitTime: 0 as UTCTimestamp, entryPrice: trade.entry_price, exitPrice: trade.exit_price,
        stopPrice: null, targetPrice: null, maePrice: null, mfePrice: null, isLong: true, scratch: false, pill: "", pillTone: "neutral",
        profitColor: "", riskColor: "", frameColor: "", planColor: "", mutedColor: "", pillBackground: "", textColor: "", opacity: 0,
        stopLabel: "", targetLabel: "", exitReason: null, maeLabel: null, mfeLabel: null,
      });
      series.attachPrimitive(primitive);
      const state: Live = { lwc, chart, series, primitive, lines: [], fitRange: null, renderedKey: "", touchTracking: false, xrayPinned: false, xrayKey: false };
      live.current = state;
      draw.current(true);

      const applyXray = () => {
        const active = state.xrayPinned || state.touchTracking || state.xrayKey;
        primitive.setXray(active);
        latest.current.onXrayChange?.(active);
      };
      let lastPointer = "mouse";
      const onPointer = (event: PointerEvent) => { lastPointer = event.pointerType; };
      host.addEventListener("pointerdown", onPointer, true);

      // X-Ray rides on the library's own tracking mode: while a finger is scrubbing the crosshair the
      // boxes fade and the readout shows the bar (UX-42). No competing long-press handler.
      chart.subscribeCrosshairMove((param) => {
        const bar = param.time != null && param.point ? param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined : undefined;
        const target = latest.current.readout?.current;
        if (target) {
          const symbol = latest.current.trade.symbol;
          target.textContent = bar ? `O ${formatPrice(bar.open, symbol)}  H ${formatPrice(bar.high, symbol)}  L ${formatPrice(bar.low, symbol)}  C ${formatPrice(bar.close, symbol)}  ·  ${formatPoints(bar.close - latest.current.trade.entry_price, symbol)} vs entry` : "";
          target.parentElement?.toggleAttribute("data-tracking", !!bar);
        }
        const tracking = !!bar && lastPointer === "touch";
        if (tracking !== state.touchTracking) { state.touchTracking = tracking; applyXray(); }
      });

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || !state.fitRange) return;
        latest.current.onFitChange?.(Math.abs(range.from - state.fitRange.from) < 1.5 && Math.abs(range.to - state.fitRange.to) < 1.5);
      });

      // Desktop: hold X for X-Ray (UX-69).
      const typing = (event: KeyboardEvent) => Boolean(document.querySelector('[role="dialog"]')) || (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)));
      const onKeyDown = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "x" && !event.metaKey && !event.ctrlKey && !typing(event)) { state.xrayKey = true; applyXray(); } };
      const onKeyUp = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "x") { state.xrayKey = false; applyXray(); } };
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);

      const resize = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth, height: host.clientHeight }));
      resize.observe(host);
      host.dataset.ready = "true";
      cleanup = () => {
        window.clearTimeout(renderTimer.current);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        host.removeEventListener("pointerdown", onPointer, true);
        resize.disconnect();
        live.current = null;
        chart.remove();
        delete host.dataset.ready;
      };
    })();
    return () => { alive = false; cleanup(); };
    // The chart is rebuilt only for a different trade or candle set; everything else redraws in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id, candles]);

  // Redraw in place. Only a timeframe change re-fits; edits, theme and zone changes keep the zoom.
  const previousTimeframe = useRef(timeframe);
  useEffect(() => {
    const refit = previousTimeframe.current !== timeframe;
    previousTimeframe.current = timeframe;
    draw.current(refit);
  }, [trade, timeframe, zone, privacy, theme, baseTimeframe]);

  return <div
    ref={hostRef}
    className="chart-host"
    role="img"
    aria-label={`${describeTrade(trade, zone, privacy)} Candlestick chart with the position box.`}
    data-timeframe={diagnosticTimeframe}
    data-visible-bars={diagnosticWindow.visibleBars.toFixed(3)}
    data-trade-share={(diagnosticWindow.holdBars / diagnosticWindow.visibleBars).toFixed(4)}
  />;
}
