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
import { TIMEFRAME_MINUTES, aggregateCandles, alignTradeToBars, defaultVisibleRange, fitWindow, includeInPriceRange, isScratch, specFor, visibleLogicalBars } from "@/lib/trades";
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
  /** Low hides after-exit dotted continuation and later-touch marks. Default Medium shows them. */
  detailLevel?: ChartDetailLevel;
  onExtensionChange?: (extension: ChartExtension) => void;
}

interface Live {
  lwc: LWC;
  host: HTMLDivElement;
  chart: IChartApi;
  series: CandleSeries;
  primitive: PositionBoxPrimitive;
  lines: IPriceLine[];
  fitRange: { from: number; to: number } | null;
  renderedKey: string;
  extraBefore: number;
  extraAfter: number;
  baseFitRange: { from: number; to: number } | null;
  barCount: number;
  userPanned: boolean;
  programmaticRangeChange: boolean;
  programmaticClearTimer: number | undefined;
  holdTimer: number | undefined;
  viewSettleTimer: number | undefined;
  heldDefaultRange: { from: number; to: number } | null;
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
  apply();
  // Lightweight-charts often adjusts the range after setData / layout on a later frame.
  // Keep the flag long enough that those echoes are not treated as a user pan.
  window.clearTimeout(state.programmaticClearTimer);
  state.programmaticClearTimer = window.setTimeout(() => {
    state.programmaticRangeChange = false;
  }, 160);
}

function writeVisibleCount(state: Live, range: { from: number; to: number } | null) {
  if (!range) {
    delete state.host.dataset.visibleCount;
    return;
  }
  state.host.dataset.visibleCount = String(Math.round(visibleLogicalBars(range)));
}

function applyHeldDefaultRange(state: Live, range: { from: number; to: number }) {
  state.heldDefaultRange = range;
  state.fitRange = range;
  const apply = () => {
    if (state.heldDefaultRange !== range || state.userPanned) return;
    setProgrammaticRange(state, () => { state.chart.timeScale().setVisibleLogicalRange(range); });
    writeVisibleCount(state, range);
  };
  apply();
  requestAnimationFrame(() => {
    apply();
    requestAnimationFrame(apply);
  });
  window.clearTimeout(state.holdTimer);
  state.holdTimer = window.setTimeout(apply, 80);
}

export function TradeChart({ ref, trade, candles, baseTimeframe, timeframe, zone, privacy, readout, onRendered, onFitChange, detailLevel = "medium", onExtensionChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => null);
  const latest = useRef({ trade, candles, baseTimeframe, timeframe, zone, privacy, theme, readout, onRendered, onFitChange, detailLevel, onExtensionChange });
  const renderTimer = useRef<number | undefined>(undefined);
  const diagnosticTimeframe = TIMEFRAME_MINUTES[timeframe] <= TIMEFRAME_MINUTES[baseTimeframe] ? baseTimeframe : timeframe;
  const diagnosticWindow = fitWindow(trade.entry_time, trade.exit_time, diagnosticTimeframe);

  useEffect(() => { latest.current = { trade, candles, baseTimeframe, timeframe, zone, privacy, theme, readout, onRendered, onFitChange, detailLevel, onExtensionChange }; });

  useImperativeHandle(ref, () => ({
    fit: () => {
      const l = live.current;
      if (!l || !l.baseFitRange) return;
      l.userPanned = true;
      l.heldDefaultRange = null;
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
      l.heldDefaultRange = null;
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
        textColor: t.textMuted,
        keyPrice: tr.key_level_price, opacity: t.boxOpacity,
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
          applyHeldDefaultRange(l, defaultVisibleRange(l.baseFitRange, l.barCount));
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
        profitColor: "", riskColor: "", mutedColor: "", textColor: "", keyPrice: null, opacity: 0,
        approximate: false,
      });
      series.attachPrimitive(primitive);
      const state: Live = {
        lwc, host, chart, series, primitive, lines: [],
        fitRange: null, renderedKey: "", extraBefore: 0, extraAfter: 0,
        baseFitRange: null, barCount: 0,
        userPanned: false, programmaticRangeChange: false,
        programmaticClearTimer: undefined, holdTimer: undefined, viewSettleTimer: undefined,
        heldDefaultRange: null, savedTimeRange: null,
      };
      live.current = state;
      draw.current(true);

      chart.subscribeCrosshairMove((param) => {
        const bar = param.time != null && param.point ? param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined : undefined;
        const target = latest.current.readout?.current;
        if (target) {
          const symbol = latest.current.trade.symbol;
          target.textContent = bar ? `O ${formatPrice(bar.open, symbol)}  H ${formatPrice(bar.high, symbol)}  L ${formatPrice(bar.low, symbol)}  C ${formatPrice(bar.close, symbol)}  ·  ${formatPoints(bar.close - latest.current.trade.entry_price, symbol)} vs entry` : "";
          target.parentElement?.toggleAttribute("data-tracking", !!bar);
        }
      });

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (!range || !state.baseFitRange) return;
        if (!state.programmaticRangeChange) {
          const wanted = state.heldDefaultRange;
          const matchesDefault = wanted != null
            && Math.abs(range.from - wanted.from) < 1
            && Math.abs(range.to - wanted.to) < 1;
          if (wanted && !state.userPanned && !matchesDefault) {
            // The library overwrote the range after setData or a resize; put the default trade window back.
            setProgrammaticRange(state, () => { state.chart.timeScale().setVisibleLogicalRange(wanted); });
            writeVisibleCount(state, wanted);
          } else if (!matchesDefault) {
            state.userPanned = true;
            state.heldDefaultRange = null;
            writeVisibleCount(state, range);
          }
        } else {
          writeVisibleCount(state, range);
        }
        // A user-driven range change settles into a new view: let listeners (the Trade Card,
        // issue #87) rebuild from it once the drag or pinch stops moving. Programmatic echoes
        // from setData / fit are not view changes.
        if (!state.programmaticRangeChange) {
          window.clearTimeout(state.viewSettleTimer);
          state.viewSettleTimer = window.setTimeout(() => latest.current.onRendered?.(), 300);
        }
        const fitted = state.extraBefore === 0 && state.extraAfter === 0
          && Math.abs(range.from - state.baseFitRange.from) < 1.5 && Math.abs(range.to - state.baseFitRange.to) < 1.5;
        latest.current.onFitChange?.(fitted);
        reportExtension(state, latest.current.onExtensionChange);
      });

      const markUserPan = () => {
        state.userPanned = true;
        state.heldDefaultRange = null;
      };
      // A tap is not a pan: only an actual drag (or a wheel / pinch, which move the range) marks
      // one, so tapping the chart never drops the fitted default window (review follow-up to #82).
      const panStart = new Map<number, { x: number; y: number }>();
      const PAN_DRAG_PX = 6;
      const onPointerDown = (event: PointerEvent) => {
        panStart.set(event.pointerId, { x: event.clientX, y: event.clientY });
      };
      const onPointerMove = (event: PointerEvent) => {
        const start = panStart.get(event.pointerId);
        if (!start) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > PAN_DRAG_PX) {
          panStart.delete(event.pointerId);
          markUserPan();
        }
      };
      const onPointerEnd = (event: PointerEvent) => {
        panStart.delete(event.pointerId);
      };
      host.addEventListener("wheel", markUserPan, { passive: true });
      host.addEventListener("pointerdown", onPointerDown);
      host.addEventListener("pointermove", onPointerMove);
      host.addEventListener("pointerup", onPointerEnd);
      host.addEventListener("pointercancel", onPointerEnd);

      const resize = new ResizeObserver(() => {
        chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
        if (!state.userPanned && state.heldDefaultRange) {
          setProgrammaticRange(state, () => { state.chart.timeScale().setVisibleLogicalRange(state.heldDefaultRange!); });
          writeVisibleCount(state, state.heldDefaultRange);
        }
      });
      resize.observe(host);
      host.dataset.ready = "true";
      cleanup = () => {
        window.clearTimeout(renderTimer.current);
        window.clearTimeout(state.programmaticClearTimer);
        window.clearTimeout(state.holdTimer);
        window.clearTimeout(state.viewSettleTimer);
        host.removeEventListener("wheel", markUserPan);
        host.removeEventListener("pointerdown", onPointerDown);
        host.removeEventListener("pointermove", onPointerMove);
        host.removeEventListener("pointerup", onPointerEnd);
        host.removeEventListener("pointercancel", onPointerEnd);
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
