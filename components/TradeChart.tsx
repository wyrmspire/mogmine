"use client";

import { useEffect, useImperativeHandle, useRef, useSyncExternalStore } from "react";
import type { Ref, RefObject } from "react";
import { PositionBoxPrimitive } from "./PositionBoxPrimitive";
import type { PositionBoxConfig } from "./PositionBoxPrimitive";
import { describeTrade } from "@/lib/describe";
import { formatPoints, formatPrice } from "@/lib/format";
import { getTheme, subscribeTheme } from "@/lib/theme";
import type { ChartTheme } from "@/lib/theme";
import { chartCrosshairLabel, chartTickLabel } from "@/lib/time";
import { TIMEFRAME_MINUTES, aggregateCandles, alignTradeToBars, defaultVisibleRange, fitWindow, includeInPriceRange, isScratch, specFor } from "@/lib/trades";
import type { Candle, Timeframe, TradeRecord } from "@/lib/trades";
import { buildHindsight } from "@/lib/hindsight";
import type { ChartDetailLevel } from "@/lib/hindsight";

type LWC = typeof import("lightweight-charts");
type IChartApi = import("lightweight-charts").IChartApi;
type CandleSeries = import("lightweight-charts").ISeriesApi<"Candlestick">;
type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
type Time = import("lightweight-charts").Time;
type IPriceLine = import("lightweight-charts").IPriceLine;
type AutoscaleInfoProvider = import("lightweight-charts").AutoscaleInfoProvider;

export interface ChartExtension {
  before: number;
  after: number;
  canBefore: boolean;
  canAfter: boolean;
}

export interface TradeChartHandle {
  /** Snap the view back to the padded trade window and clear ‹ 30 / 30 › extensions. */
  fit(): void;
  /** Widen one side by 30 bars of the current timeframe (issue #37). Returns how many bars were added. */
  extend(side: "before" | "after", bars?: number): { applied: number; remaining: boolean };
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
  /** Low hides after-exit dotted continuation and later-touch marks. Default Medium shows them. */
  detailLevel?: ChartDetailLevel;
  onExtensionChange?: (extension: ChartExtension) => void;
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
  extraBefore: number;
  extraAfter: number;
  baseFitRange: { from: number; to: number } | null;
  barCount: number;
  userPanned: boolean;
  programmaticRangeChange: boolean;
  savedTimeRange: { from: UTCTimestamp; to: UTCTimestamp } | null;
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

function reportExtension(state: Live, onExtensionChange?: (extension: ChartExtension) => void) {
  if (!state.baseFitRange) {
    onExtensionChange?.({ before: 0, after: 0, canBefore: false, canAfter: false });
    return;
  }
  const current = state.chart.timeScale().getVisibleLogicalRange();
  const currentFrom = current ? current.from : (state.baseFitRange.from - state.extraBefore);
  const currentTo = current ? current.to : (state.baseFitRange.to + state.extraAfter);
  onExtensionChange?.({
    before: state.extraBefore,
    after: state.extraAfter,
    canBefore: currentFrom > 0.5,
    canAfter: currentTo < state.barCount - 1.5,
  });
}

function setProgrammaticRange(state: Live, apply: () => void) {
  state.programmaticRangeChange = true;
  try {
    apply();
  } finally {
    // Lightweight-charts may notify after this call returns; keep the flag until the next task.
    queueMicrotask(() => { state.programmaticRangeChange = false; });
  }
}

export function TradeChart({ ref, trade, candles, baseTimeframe, timeframe, zone, privacy, readout, onRendered, onFitChange, onXrayChange, detailLevel = "medium", onExtensionChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => null);
  const latest = useRef({ trade, candles, baseTimeframe, timeframe, zone, privacy, theme, readout, onRendered, onFitChange, onXrayChange, detailLevel, onExtensionChange });
  const renderTimer = useRef<number | undefined>(undefined);
  const diagnosticTimeframe = TIMEFRAME_MINUTES[timeframe] <= TIMEFRAME_MINUTES[baseTimeframe] ? baseTimeframe : timeframe;
  const diagnosticWindow = fitWindow(trade.entry_time, trade.exit_time, diagnosticTimeframe);

  useEffect(() => { latest.current = { trade, candles, baseTimeframe, timeframe, zone, privacy, theme, readout, onRendered, onFitChange, onXrayChange, detailLevel, onExtensionChange }; });

  useImperativeHandle(ref, () => ({
    fit: () => {
      const l = live.current;
      if (!l || !l.baseFitRange) return;
      l.userPanned = true;
      l.extraBefore = 0;
      l.extraAfter = 0;
      l.chart.priceScale("right").applyOptions({ autoScale: true });
      l.fitRange = l.baseFitRange;
      setProgrammaticRange(l, () => { l.chart.timeScale().setVisibleLogicalRange(l.baseFitRange!); });
      latest.current.onFitChange?.(true);
      reportExtension(l, latest.current.onExtensionChange);
    },
    extend: (side, bars = 30) => {
      const l = live.current;
      if (!l?.baseFitRange || bars <= 0) return { applied: 0, remaining: false };
      l.userPanned = true;
      const current = l.chart.timeScale().getVisibleLogicalRange();
      const currentFrom = current?.from ?? (l.baseFitRange.from - l.extraBefore);
      const currentTo = current?.to ?? (l.baseFitRange.to + l.extraAfter);
      if (side === "after") {
        const room = Math.max(0, (l.barCount - 1) - currentTo);
        const applied = Math.min(bars, room);
        l.extraAfter += applied;
        const nextTo = Math.min(l.barCount - 1, currentTo + applied);
        const view = { from: currentFrom, to: nextTo };
        l.fitRange = view;
        setProgrammaticRange(l, () => { l.chart.timeScale().setVisibleLogicalRange(view); });
        reportExtension(l, latest.current.onExtensionChange);
        return { applied, remaining: room - applied > 0 };
      }
      const room = Math.max(0, currentFrom - 0);
      const applied = Math.min(bars, room);
      l.extraBefore += applied;
      const nextFrom = Math.max(0, currentFrom - applied);
      const view = { from: nextFrom, to: currentTo };
      l.fitRange = view;
      setProgrammaticRange(l, () => { l.chart.timeScale().setVisibleLogicalRange(view); });
      reportExtension(l, latest.current.onExtensionChange);
      return { applied, remaining: room - applied > 0 };
    },
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
    // A fill with no bar within tolerance is unresolved (issue #51): no box is drawn at a far-off bar.
    // When a fill snaps to a nearby bar rather than containing bar, alignment is approximate (issue #64 / OD-28).
    const alignment = alignTradeToBars(times, tr.entry_time, tr.exit_time, barTimeframe);
    const entryBar = alignment?.entryBar ?? null;
    l.primitive.setHidden(alignment == null);
    if (alignment) {
      const isLong = tr.direction === "LONG";
      const scratch = isScratch(tr);
      const showContinuation = p.detailLevel !== "low";
      const fact = showContinuation ? buildHindsight(tr, bars, barTimeframe) : null;
      const laterTouches = [fact?.target, fact?.stop].flatMap((touch) => touch ? [{ time: toTime(touch.time), kind: touch.kind }] : []);
      const config: PositionBoxConfig = {
        entryTime: toTime(alignment.entryBar), exitTime: toTime(alignment.exitBar),
        entryPrice: tr.entry_price, exitPrice: tr.exit_price,
        stopPrice: tr.stop_loss_price, targetPrice: tr.planned_target_price,
        isLong, scratch,
        profitColor: t.profit, riskColor: t.risk, mutedColor: t.textMuted,
        pillBackground: t.surface, textColor: t.textMuted,
        keyPrice: tr.key_level_price, keyColor: t.goldMid, opacity: t.boxOpacity,
        approximate: alignment.approximate,
        showContinuation,
        extendBackward: l.extraBefore > 0,
        laterTouches,
      };
      l.primitive.update(config);
    }

    // No axis tags: the fills say where the stop, target, entry and exit are, and the price scale
    // stays readable. Remove any lines left by an older build.
    l.lines.forEach((line) => l.series.removePriceLine(line));
    l.lines = [];

    // Recompute in bars for this timeframe. Coarser bars therefore show wider clock-time context.
    const fittedWindow = fitWindow(tr.entry_time, tr.exit_time, barTimeframe);
    const entryIndex = entryBar == null ? -1 : times.indexOf(entryBar);
    l.barCount = times.length;
    if (entryIndex >= 0) {
      const fitFrom = entryIndex - fittedWindow.beforeBars;
      l.baseFitRange = { from: fitFrom, to: fitFrom + fittedWindow.visibleBars };
      if (refit || dataChanged) {
        l.extraBefore = 0;
        l.extraAfter = 0;
        let applied = false;
        if (l.userPanned && l.savedTimeRange) {
          try {
            setProgrammaticRange(l, () => { l.chart.timeScale().setVisibleRange(l.savedTimeRange!); });
            applied = true;
          } catch {
            applied = false;
          }
        }
        if (!applied) {
          const wide = defaultVisibleRange(l.baseFitRange, l.barCount);
          l.fitRange = wide;
          setProgrammaticRange(l, () => { l.chart.timeScale().setVisibleLogicalRange(wide); });
        }
      }
    } else {
      // Nothing to fit around: show the whole candle set rather than a window around a missing bar.
      l.baseFitRange = null;
      l.fitRange = null;
      if (refit || dataChanged) {
        setProgrammaticRange(l, () => { l.chart.timeScale().fitContent(); });
      }
    }
    reportExtension(l, p.onExtensionChange);

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
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol)?.tickSize ?? 0.01 },
      });
      const primitive = new PositionBoxPrimitive({
        entryTime: 0 as UTCTimestamp, exitTime: 0 as UTCTimestamp, entryPrice: trade.entry_price, exitPrice: trade.exit_price,
        stopPrice: null, targetPrice: null, isLong: true, scratch: false,
        profitColor: "", riskColor: "", mutedColor: "", pillBackground: "", textColor: "", keyPrice: null, keyColor: "", opacity: 0,
        approximate: false,
      });
      series.attachPrimitive(primitive);
      const state: Live = {
        lwc, chart, series, primitive, lines: [],
        fitRange: null, renderedKey: "", touchTracking: false,
        xrayPinned: false, xrayKey: false, extraBefore: 0, extraAfter: 0,
        baseFitRange: null, barCount: 0,
        userPanned: false, programmaticRangeChange: false, savedTimeRange: null,
      };
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
        if (!range || !state.baseFitRange) return;
        if (!state.programmaticRangeChange) {
          state.userPanned = true;
        }
        const fitted = state.extraBefore === 0 && state.extraAfter === 0
          && Math.abs(range.from - state.baseFitRange.from) < 1.5 && Math.abs(range.to - state.baseFitRange.to) < 1.5;
        latest.current.onFitChange?.(fitted);
        reportExtension(state, latest.current.onExtensionChange);
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
    if (refit && live.current?.userPanned) {
      try {
        live.current.savedTimeRange = live.current.chart.timeScale().getVisibleRange() as { from: UTCTimestamp; to: UTCTimestamp } | null;
      } catch {
        live.current.savedTimeRange = null;
      }
    }
    previousTimeframe.current = timeframe;
    draw.current(refit);
  }, [trade, timeframe, zone, privacy, theme, baseTimeframe, detailLevel]);

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
