"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import type { Ref, RefObject } from "react";
import { PositionBoxPrimitive } from "./PositionBoxPrimitive";
import { IndicatorBandsPrimitive } from "./IndicatorBandsPrimitive";
import { addVolumePane, paintVolumePane, type VolumeSeries } from "./VolumePane";
import { SessionLevelsPrimitive, levelPillColumnPx } from "./SessionLevelsPrimitive";
import { DEFAULT_RIGHT_OFFSET_BARS, MIN_BAR_SPACING_PX, effectiveRightOffsetBars } from "@/lib/chart-chrome";
import { LevelCard, levelHitForTick, selectExportLevelPills } from "./LevelCard";
import { describeTrade } from "@/lib/describe";
import { useAccounts } from "@/lib/accounts-store";
import { formatPoints, formatPrice } from "@/lib/format";
import { getTheme, subscribeTheme } from "@/lib/theme";
import type { ChartTheme } from "@/lib/theme";
import { chartCrosshairLabel, chartTickLabel } from "@/lib/time";
import { TIMEFRAME_MINUTES, alignTradeToBars, defaultVisibleRange, fitWindow, includeInPriceRange, specFor, visibleLogicalBars } from "@/lib/trades";
import type { Candle, Timeframe, TradeRecord } from "@/lib/trades";
import type { Mark } from "@/lib/trade-marks";
import type { NeighbourTradeProjection } from "@/lib/neighbour-trades";
import { levelPills, tradeAnchors, type LevelLine, type LevelPill } from "@/lib/chart-levels";
import { computeExportDimensions } from "@/lib/chart-export";
import { resolveTapAction, type LevelHit } from "@/lib/level-hit-test";
import { usePrefs } from "@/lib/prefs";
import type { LevelLabelsMode } from "@/lib/prefs-sanitize";
import type { VwapBandPoint, VwapPoint } from "@/lib/chart-indicators";
import type { EmaPoint } from "@/lib/ema";
import { STRETCH_DEAD_ZONE_PX, isDoubleTap, stretchPriceRange, wheelToDragPx } from "@/lib/price-scale";
import type { PriceSpan, TapPoint } from "@/lib/price-scale";
import type { IndicatorFillSlot, IndicatorInstance, IndicatorLineSlot, IndicatorLineStyle } from "@/lib/indicator-kit";

type LWC = typeof import("lightweight-charts");
type IChartApi = import("lightweight-charts").IChartApi;
type CandleSeries = import("lightweight-charts").ISeriesApi<"Candlestick">;
type LineSeries = import("lightweight-charts").ISeriesApi<"Line">;
type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
type Time = import("lightweight-charts").Time;
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
  /** An open trade (R-03c) is drawn from its entry bar to the last loaded bar, with no exit. */
  trade: TradeRecord;
  /** The same bars Trade Detail uses for its observer findings. */
  bars: Candle[];
  timeframe: Timeframe;
  marks: readonly Mark[];
  /** LV-2: computed session levels as drawable lines. Empty hides them. */
  levels?: readonly LevelLine[];
  /** IND-1: session VWAP on the displayed bars. Empty hides it. */
  vwap?: readonly VwapPoint[];
  vwapBands?: readonly (readonly VwapBandPoint[])[];
  /** IN-2: true when Globex VWAP includes tolerated overnight gaps (HUD prefixes ≈). */
  vwapApproximate?: boolean;
  weeklyVwap?: readonly VwapPoint[];
  weeklyVwapBands?: readonly (readonly VwapBandPoint[])[];
  weeklyVwapApproximate?: boolean;
  vwapBandFill?: boolean;
  /** VOL-1: draw the volume band under the candles. The caller withholds it when the bars carry no real volume. */
  showVolume?: boolean;
  /** IN-3: the 200 EMA on the displayed bars (View → 200 EMA). Empty hides it. */
  ema?: readonly EmaPoint[];
  /** IN-3: the warm-up has gaps: the line is dashed and the HUD prefixes ≈. */
  emaApproximate?: boolean;
  zone: string;
  /** Shield / privacy: the on-chart pill shows R and points, never dollars (UX-71). */
  privacy: boolean;
  /** Element that shows OHLC while the crosshair is tracking. Written directly, not through React. */
  readout?: RefObject<HTMLElement | null>;
  /** Called shortly after every redraw, once an up-to-date screenshot can be taken. */
  onRendered?: () => void;
  /** Whether the visible range is still the fitted trade window. */
  onFitChange?: (fitted: boolean) => void;
  onExtensionChange?: (extension: ChartExtension) => void;
  /** K (#40): Invoked when user taps an archived neighbour trade box */
  onSelectNeighbour?: (tradeId: string) => void;
  /** K (#40): Optional neighbour trade projections to associate archived marks with tradeIds */
  neighbourTrades?: readonly NeighbourTradeProjection[];
  /** LB-5: label mode. Defaults to the `levelLabels` pref (`"tap"` out of the box). */
  levelLabelsMode?: LevelLabelsMode;
  /** LB-6: a tap on a level opens its card (`hit`); a tap elsewhere, a pan or a zoom sends `null`. */
  onSelectLevel?: (hit: LevelHit | null) => void;
  /** LB-B2: a focused level-list row (its tick) opens that level's card. Null when focus leaves. */
  highlightedLineTick?: number | null;
  /** IK-2: persisted style owners for each rendered canvas/series layer. */
  indicatorStyle?: {
    levels?: IndicatorInstance; vwap?: IndicatorInstance; weeklyVwap?: IndicatorInstance;
    ema?: IndicatorInstance; volume?: IndicatorInstance;
  };
  extraIndicatorLines?: readonly {
    id: string; label: string; points: readonly VwapPoint[]; approximate: boolean; style: IndicatorInstance;
  }[];
  extraIndicatorBands?: readonly {
    id: string; bands: readonly (readonly VwapBandPoint[])[]; approximate: boolean; style: IndicatorInstance;
  }[];
}

/** What one paint of the level primitive needs from the latest props. */
interface LevelPaint {
  levels: readonly LevelLine[];
  theme: ChartTheme;
  bars: Candle[];
  timeframe: Timeframe;
  trade: TradeRecord;
  style?: IndicatorInstance;
}

/** Pushes pills and a mode to the level primitive. Shared by the live draw and the export snapshot (D-E). */
function paintLevels(state: Live, paint: LevelPaint, mode: LevelLabelsMode, pills: readonly LevelPill[]) {
  const { trade: tr, bars } = paint;
  const slot = paint.style?.style.rays;
  const line = slot?.kind === "line" ? slot : undefined;
  state.levelsPrimitive.update(line?.visible === false ? [] : paint.levels, paint.theme, TIMEFRAME_MINUTES[paint.timeframe] * 60_000, line?.visible === false ? [] : pills, {
    lastBarTime: bars[bars.length - 1].time, mode, symbol: tr.symbol, entryPrice: tr.entry_price,
    lineStyle: line?.style, lineWidth: line?.width, color: line && line.color !== "theme:role" ? indicatorColor(line.color, paint.theme, "levels") : null, labels: paint.style?.labels,
  });
}

function indicatorColor(color: string | undefined, theme: ChartTheme, fallback: "vwap" | "weekly" | "ema" | "levels" | "volume") {
  if (color?.startsWith("#")) return color;
  const key = color?.slice(6);
  if (key === "vwap") return theme.vwap;
  if (key === "ema") return theme.ema200 ?? "#38bdf8";
  if (key === "support") return theme.levelSupport;
  if (key === "resistance") return theme.levelResistance;
  if (key === "gold") return theme.goldMid;
  if (fallback === "weekly") return theme.weeklyVwap ?? theme.vwap;
  if (fallback === "ema") return theme.ema200 ?? "#38bdf8";
  if (fallback === "levels") return theme.levelNeutral;
  return fallback === "volume" ? theme.textMuted : theme.vwap;
}

function lineSlot(instance: IndicatorInstance | undefined, key = "main"): IndicatorLineSlot | undefined {
  const slot = instance?.style[key];
  return slot?.kind === "line" ? slot : undefined;
}

function fillSlot(instance: IndicatorInstance | undefined, key: string): IndicatorFillSlot | undefined {
  const slot = instance?.style[key];
  return slot?.kind === "fill" || slot?.kind === "background" ? slot : undefined;
}

function lwcLineStyle(lwc: LWC, style: IndicatorLineStyle | undefined) {
  return style === "dotted" ? lwc.LineStyle.Dotted : style === "dashed" ? lwc.LineStyle.Dashed : lwc.LineStyle.Solid;
}

interface Live {
  lwc: LWC;
  host: HTMLDivElement;
  chart: IChartApi;
  series: CandleSeries;
  /** VOL-1: volume band, added before the candles so it draws underneath them. */
  volumeSeries: VolumeSeries;
  primitive: PositionBoxPrimitive;
  levelsPrimitive: SessionLevelsPrimitive;
  indicatorBandsPrimitive: IndicatorBandsPrimitive;
  /** Labels of the pills drawn this frame: they size the `rightOffset` reserve (OD-55a). */
  levelLabels: string[];
  levelRightOffset: number;
  vwapSeries: LineSeries;
  renderedVwap: readonly VwapPoint[] | null;
  weeklyVwapSeries: LineSeries;
  renderedWeeklyVwap: readonly VwapPoint[] | null;
  emaSeries: LineSeries;
  renderedEma: readonly EmaPoint[] | null;
  extraSeries: Map<string, { series: LineSeries; rendered: readonly VwapPoint[] | null; label: string; approximate: boolean; labels: boolean }>;
  fitRange: { from: number; to: number } | null;
  renderedBars: Candle[];
  renderedTimeframe: Timeframe | null;
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
}

const toTime = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/**
 * OD-55a: reserve the bars the pill column needs past the last bar, so pills never sit on candles.
 * Changes only the right edge: the visible logical range is put back, so fitted bars do not move.
 * Memoised on the offset, so a range echo from this call cannot start another.
 */
function applyLevelRightOffset(state: Live) {
  const timeScale = state.chart.timeScale();
  const range = timeScale.getVisibleLogicalRange();
  const bars = range ? visibleLogicalBars(range) : 0;
  const barSpacing = bars > 0 ? timeScale.width() / bars : 0;
  const offset = effectiveRightOffsetBars(state.levelLabels.length, levelPillColumnPx(state.levelLabels), barSpacing);
  if (offset === state.levelRightOffset) return;
  state.levelRightOffset = offset;
  setProgrammaticRange(state, () => {
    timeScale.applyOptions({ rightOffset: offset });
    if (range) timeScale.setVisibleLogicalRange(range);
  });
}

/** Where the box ends: the exit, or for an open trade the last loaded bar (R-03c). Never "now" or a guess. */
function boxEnd(trade: Pick<TradeRecord, "entry_time" | "exit_time">, bars: Candle[]): string {
  if (trade.exit_time != null) return trade.exit_time;
  const last = bars.length ? bars[bars.length - 1].time : Date.parse(trade.entry_time);
  return new Date(Math.max(last, Date.parse(trade.entry_time))).toISOString();
}

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

// UX-E4: resize the chart for the >= 2x export bitmap, then put the same logical and price view back.
type ExportView = { logical: { from: number; to: number } | null; auto: boolean; prices: PriceSpan | null };
function sizeForExport(l: Live, width: number, height: number, view: ExportView) {
  setProgrammaticRange(l, () => {
    l.chart.resize(width, height);
    if (view.logical) l.chart.timeScale().setVisibleLogicalRange(view.logical);
    l.chart.priceScale("right").applyOptions({ autoScale: view.auto });
    if (!view.auto && view.prices) l.chart.priceScale("right").setVisibleRange(view.prices);
  });
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

const NO_LEVELS: readonly LevelLine[] = [];
const NO_VWAP: readonly VwapPoint[] = [];
const NO_VWAP_BANDS: readonly (readonly VwapBandPoint[])[] = [];
const NO_EMA: readonly EmaPoint[] = [];
const NO_EXTRA_LINES: readonly NonNullable<Props["extraIndicatorLines"]>[number][] = [];
const NO_EXTRA_BANDS: readonly NonNullable<Props["extraIndicatorBands"]>[number][] = [];

export function TradeChart({ ref, trade, bars, timeframe, marks, levels = NO_LEVELS, vwap = NO_VWAP, vwapBands = NO_VWAP_BANDS, vwapApproximate = false, weeklyVwap = NO_VWAP, weeklyVwapBands = NO_VWAP_BANDS, weeklyVwapApproximate = false, vwapBandFill = false, showVolume = false, ema = NO_EMA, emaApproximate = false, zone, privacy, readout, onRendered, onFitChange, onExtensionChange, onSelectNeighbour, neighbourTrades, levelLabelsMode, onSelectLevel, highlightedLineTick = null, indicatorStyle, extraIndicatorLines = NO_EXTRA_LINES, extraIndicatorBands = NO_EXTRA_BANDS }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => null);
  const prefs = usePrefs();
  const accounts = useAccounts();
  const levelMode: LevelLabelsMode = levelLabelsMode ?? prefs.levelLabels;
  // The open level card (LB-6). `fromList`: opened by a focused list row, so leaving the row closes it.
  const [openLevel, setOpenLevel] = useState<{ hit: LevelHit; fromList: boolean } | null>(null);
  const latest = useRef({ trade, bars, timeframe, marks, levels, vwap, vwapBands, vwapApproximate, weeklyVwap, weeklyVwapBands, weeklyVwapApproximate, vwapBandFill, showVolume, ema, emaApproximate, zone, privacy, theme, readout, onRendered, onFitChange, onExtensionChange, onSelectNeighbour, neighbourTrades, levelMode, onSelectLevel, indicatorStyle, extraIndicatorLines, extraIndicatorBands });
  const renderTimer = useRef<number | undefined>(undefined);
  const diagnosticWindow = fitWindow(trade.entry_time, boxEnd(trade, bars), timeframe);

  useEffect(() => { latest.current = { trade, bars, timeframe, marks, levels, vwap, vwapBands, vwapApproximate, weeklyVwap, weeklyVwapBands, weeklyVwapApproximate, vwapBandFill, showVolume, ema, emaApproximate, zone, privacy, theme, readout, onRendered, onFitChange, onExtensionChange, onSelectNeighbour, neighbourTrades, levelMode, onSelectLevel, indicatorStyle, extraIndicatorLines, extraIndicatorBands }; });
  const closeLevel = useCallback(() => {
    setOpenLevel(null);
    latest.current.onSelectLevel?.(null);
  }, []);
  // LB-B2: a focused or hovered level-list row opens that level's card. Leaving the row closes it again.
  useEffect(() => {
    // Next frame, so a quick blur-then-focus between rows settles on the last row only.
    const frame = requestAnimationFrame(() => {
      if (highlightedLineTick == null) { setOpenLevel((open) => (open?.fromList ? null : open)); return; }
      const l = live.current;
      if (!l) return;
      const hit = levelHitForTick(latest.current.levels, highlightedLineTick, l.host.clientWidth / 2, (price) => l.series.priceToCoordinate(price));
      setOpenLevel(hit ? { hit, fromList: true } : null);
    });
    return () => cancelAnimationFrame(frame);
  }, [highlightedLineTick]);

  useImperativeHandle(ref, () => ({
    fit: () => {
      const l = live.current;
      if (!l || !l.baseFitRange) return;
      l.userPanned = true;
      l.heldDefaultRange = null;
      l.extraBefore = 0;
      l.extraAfter = 0;
      l.chart.priceScale("right").applyOptions({ autoScale: true });
      l.host.dataset.priceScale = "auto";
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
    screenshot: () => {
      const l = live.current;
      if (!l) return null;
      const p = latest.current;
      if (!p.theme || !p.bars.length || !p.levels.length || p.levelMode !== "tap") return l.chart.takeScreenshot(true, false);
      // D-E: the PNG carries at most four labelled groups. Live "tap" mode is restored before this returns.
      const paint: LevelPaint = { levels: p.levels, theme: p.theme, bars: p.bars, timeframe: p.timeframe, trade: p.trade, style: p.indicatorStyle?.levels };
      const livePills = levelPills(p.levels, tradeAnchors(p.trade), p.trade.symbol, p.trade.entry_price);
      const exportPills = selectExportLevelPills(livePills, p.trade.entry_price, p.trade.key_level_price ?? null);
      paintLevels(l, paint, "always", exportPills);
      l.levelLabels = exportPills.map((pill) => pill.label);
      applyLevelRightOffset(l);
      const exp = computeExportDimensions(l.host.clientWidth, l.host.clientHeight, window.devicePixelRatio || 1);
      const view: ExportView = { logical: l.chart.timeScale().getVisibleLogicalRange(), auto: l.chart.priceScale("right").options().autoScale, prices: l.chart.priceScale("right").getVisibleRange() };
      l.primitive.setExportMode(true);
      try {
        if (exp.resize) sizeForExport(l, exp.width, exp.height, view);
        return l.chart.takeScreenshot(true, false);
      } finally {
        l.primitive.setExportMode(false);
        if (exp.resize) sizeForExport(l, l.host.clientWidth, l.host.clientHeight, view);
        paintLevels(l, paint, "tap", livePills);
        l.levelLabels = [];
        applyLevelRightOffset(l);
      }
    },
  }), []);

  // Draws the current props onto the existing chart. Switching timeframe only swaps data: the chart
  // is never rebuilt, so it is fast (UX-02) and the Position Box is re-snapped to the new bars (UX-20).
  const draw = useRef(() => {
    const l = live.current;
    const p = latest.current;
    if (!l || !p.theme) return;
    const t: ChartTheme = p.theme;
    const { trade: tr, bars, timeframe: barTimeframe } = p;
    if (!bars.length) return;

    l.chart.applyOptions({
      layout: { background: { type: l.lwc.ColorType.Solid, color: t.chartBg }, textColor: t.chartAxis, fontFamily: t.fontMono },
      grid: { vertLines: { color: t.gridV }, horzLines: { color: t.gridH } },
      rightPriceScale: { borderColor: t.chartBorder },
      timeScale: { borderColor: t.chartBorder, tickMarkFormatter: (time: Time, type: number) => chartTickLabel(time as number, type, p.zone) },
      localization: { timeFormatter: (time: Time) => chartCrosshairLabel(time as number, p.zone) },
      crosshair: { vertLine: { color: t.crosshair, labelBackgroundColor: t.crosshairLabel }, horzLine: { color: t.crosshair, labelBackgroundColor: t.crosshairLabel } },
    });
    l.series.applyOptions({
      upColor: t.candleUp,
      downColor: t.candleDown,
      wickUpColor: t.candleUp,
      wickDownColor: t.candleDown,
      // Keep recorded fill, stop and target prices in view even when a missing bar prevents anchoring a mark.
      autoscaleInfoProvider: ((baseImplementation) => {
        const base = baseImplementation();
        const priceRange = includeInPriceRange(base?.priceRange ?? null, [tr.entry_price, tr.exit_price, tr.stop_loss_price, tr.planned_target_price]);
        return priceRange ? { ...(base ?? {}), priceRange } : base;
      }) satisfies AutoscaleInfoProvider,
    });

    const timeScale = l.chart.timeScale();
    const timeframeChanged = barTimeframe !== l.renderedTimeframe;
    const dataChanged = bars !== l.renderedBars || timeframeChanged;
    // An append keeps existing logical indices. A different timeframe or a corrected timestamp
    // needs time anchors to preserve a manual view across the new indices.
    const sameIndices = !timeframeChanged && (!dataChanged || l.renderedBars.every((bar, index) => bar.time === bars[index]?.time));
    const timelineChanged = !sameIndices || bars.length !== l.renderedBars.length;
    const logicalRange = timelineChanged && l.userPanned && sameIndices ? timeScale.getVisibleLogicalRange() : null;
    const timeRange = timelineChanged && l.userPanned && !sameIndices ? timeScale.getVisibleRange() : null;
    if (dataChanged) {
      setProgrammaticRange(l, () => {
        l.series.setData(bars.map((bar) => ({ time: toTime(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close })));
      });
      l.renderedBars = bars;
      l.renderedTimeframe = barTimeframe;
    }
    // VOL-1: the volume band repaints with the bars, its toggle and the theme. It sets the candle margins too.
    const volumeStyle = fillSlot(p.indicatorStyle?.volume, "bars");
    setProgrammaticRange(l, () => { paintVolumePane(l.chart, l.volumeSeries, bars, t, p.showVolume, l.host.clientHeight, volumeStyle ? {
      color: volumeStyle.color === "theme:volume" ? undefined : indicatorColor(volumeStyle.color, t, "volume"), opacity: volumeStyle.opacity,
    } : undefined); });

    if (timeframeChanged) {
      l.extraBefore = 0;
      l.extraAfter = 0;
    }

    // Fill times are snapped to their bar before they reach the time scale (B-23).
    const times = bars.map((bar) => bar.time);
    // A fill with no bar within tolerance is unresolved (issue #51): no box is drawn at a far-off bar.
    // When a fill snaps to a nearby bar rather than containing bar, alignment is approximate (issue #64 / OD-28).
    const end = boxEnd(tr, bars);
    const alignment = alignTradeToBars(times, tr.entry_time, end, barTimeframe);
    const entryBar = alignment?.entryBar ?? null;
    l.primitive.update(p.marks, t, p.neighbourTrades);
    const pills = p.levels.length ? levelPills(p.levels, tradeAnchors(tr), tr.symbol, tr.entry_price) : [];
    paintLevels(l, { levels: p.levels, theme: t, bars, timeframe: barTimeframe, trade: tr, style: p.indicatorStyle?.levels }, p.levelMode, pills);
    // Tap mode draws no pills, so only the breathing room applies (LB-6, F-10).
    l.levelLabels = p.levelMode === "tap" ? [] : pills.map((pill) => pill.label);
    applyLevelRightOffset(l);
    const vwapStyle = lineSlot(p.indicatorStyle?.vwap);
    l.vwapSeries.applyOptions({ color: indicatorColor(vwapStyle?.color, t, "vwap"), visible: p.vwap.length > 0 && vwapStyle?.visible !== false, lineWidth: (vwapStyle?.width ?? 1) as 1 | 2 | 3 | 4, lineStyle: lwcLineStyle(l.lwc, p.vwapApproximate ? "dashed" : vwapStyle?.style) });
    if (l.renderedVwap !== p.vwap) {
      // Points sit on displayed bar times only, so the time scale gains no new indices.
      setProgrammaticRange(l, () => { l.vwapSeries.setData(p.vwap.map((point) => ({ time: toTime(point.time), value: point.value }))); });
      l.renderedVwap = p.vwap;
    }
    const weeklyStyle = lineSlot(p.indicatorStyle?.weeklyVwap);
    const weeklyColor = indicatorColor(weeklyStyle?.color, t, "weekly");
    l.weeklyVwapSeries.applyOptions({ color: weeklyColor, visible: p.weeklyVwap.length > 0 && weeklyStyle?.visible !== false, lineWidth: (weeklyStyle?.width ?? 1) as 1 | 2 | 3 | 4, lineStyle: lwcLineStyle(l.lwc, p.weeklyVwapApproximate ? "dashed" : weeklyStyle?.style ?? "dashed") });
    if (l.renderedWeeklyVwap !== p.weeklyVwap) {
      setProgrammaticRange(l, () => { l.weeklyVwapSeries.setData(p.weeklyVwap.map((point) => ({ time: toTime(point.time), value: point.value }))); });
      l.renderedWeeklyVwap = p.weeklyVwap;
    }
    const vwapBandsStyle = lineSlot(p.indicatorStyle?.vwap, "bands");
    const vwapFillStyle = fillSlot(p.indicatorStyle?.vwap, "bandFill");
    const weeklyBandsStyle = lineSlot(p.indicatorStyle?.weeklyVwap, "bands");
    const weeklyFillStyle = fillSlot(p.indicatorStyle?.weeklyVwap, "bandFill");
    l.indicatorBandsPrimitive.update([
      { bands: vwapBandsStyle?.visible === false ? [] : p.vwapBands, color: indicatorColor(vwapBandsStyle?.color, t, "vwap"), width: vwapBandsStyle?.width, style: p.vwapApproximate ? "dashed" : vwapBandsStyle?.style, fillOpacity: vwapFillStyle ? (vwapFillStyle.visible ? vwapFillStyle.opacity : 0) : p.vwapBandFill ? 0.1 : 0 },
      { bands: weeklyBandsStyle?.visible === false ? [] : p.weeklyVwapBands, color: indicatorColor(weeklyBandsStyle?.color, t, "weekly"), width: weeklyBandsStyle?.width, style: p.weeklyVwapApproximate ? "dashed" : weeklyBandsStyle?.style, fillOpacity: weeklyFillStyle ? (weeklyFillStyle.visible ? weeklyFillStyle.opacity : 0) : p.vwapBandFill ? 0.1 : 0 },
      ...p.extraIndicatorBands.map((extra) => {
        const line = lineSlot(extra.style, "bands");
        const fill = fillSlot(extra.style, "bandFill");
        return { bands: line?.visible === false ? [] : extra.bands, color: indicatorColor(line?.color, t, "vwap"), width: line?.width, style: extra.approximate ? "dashed" as const : line?.style, fillOpacity: fill?.visible ? fill.opacity : 0 };
      }),
    ]);
    // IN-3: the 200 EMA is 1 px and dashed while approximate. Like VWAP, it never sets the price scale.
    const emaStyle = lineSlot(p.indicatorStyle?.ema);
    l.emaSeries.applyOptions({ color: indicatorColor(emaStyle?.color, t, "ema"), visible: p.ema.length > 0 && emaStyle?.visible !== false, lineWidth: (emaStyle?.width ?? 1) as 1 | 2 | 3 | 4, lineStyle: lwcLineStyle(l.lwc, p.emaApproximate ? "dashed" : emaStyle?.style) });
    if (l.renderedEma !== p.ema) {
      setProgrammaticRange(l, () => { l.emaSeries.setData(p.ema.map((point) => ({ time: toTime(point.time), value: point.value }))); });
      l.renderedEma = p.ema;
    }
    const wantedExtra = new Set(p.extraIndicatorLines.map(({ id }) => id));
    for (const [id, item] of l.extraSeries) {
      if (!wantedExtra.has(id)) { l.chart.removeSeries(item.series); l.extraSeries.delete(id); }
    }
    for (const extra of p.extraIndicatorLines) {
      let item = l.extraSeries.get(extra.id);
      if (!item) {
        const series = l.chart.addSeries(l.lwc.LineSeries, {
          lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => null,
          priceFormat: { type: "price", precision: 2, minMove: specFor(tr.symbol)?.tickSize ?? 0.01 },
        });
        item = { series, rendered: null, label: extra.label, approximate: extra.approximate, labels: extra.style.labels };
        l.extraSeries.set(extra.id, item);
      }
      const style = lineSlot(extra.style);
      item.label = extra.label;
      item.approximate = extra.approximate;
      item.labels = extra.style.labels;
      item.series.applyOptions({ color: indicatorColor(style?.color, t, extra.style.indicatorId === "ema" ? "ema" : "vwap"), visible: style?.visible !== false, lineWidth: (style?.width ?? 1) as 1 | 2 | 3 | 4, lineStyle: lwcLineStyle(l.lwc, extra.approximate ? "dashed" : style?.style) });
      if (item.rendered !== extra.points) {
        setProgrammaticRange(l, () => { item!.series.setData(extra.points.map((point) => ({ time: toTime(point.time), value: point.value }))); });
        item.rendered = extra.points;
      }
    }

    // Recompute in bars for this timeframe. Coarser bars therefore show wider clock-time context.
    const fittedWindow = fitWindow(tr.entry_time, end, barTimeframe);
    const entryIndex = entryBar == null ? -1 : times.indexOf(entryBar);
    l.barCount = times.length;
    if (entryIndex >= 0) {
      const fitFrom = entryIndex - fittedWindow.beforeBars;
      l.baseFitRange = { from: fitFrom, to: fitFrom + fittedWindow.visibleBars };
    } else {
      // Nothing to fit around: show the whole candle set rather than a window around a missing bar.
      l.baseFitRange = null;
      l.fitRange = null;
    }
    if (timelineChanged) {
      if (logicalRange) {
        setProgrammaticRange(l, () => timeScale.setVisibleLogicalRange(logicalRange));
      } else if (timeRange) {
        setProgrammaticRange(l, () => timeScale.setVisibleRange(timeRange));
      } else if (l.baseFitRange) {
        applyHeldDefaultRange(l, defaultVisibleRange(l.baseFitRange, l.barCount));
      } else {
        setProgrammaticRange(l, () => timeScale.fitContent());
      }
    }
    reportExtension(l, p.onExtensionChange);

    window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => latest.current.onRendered?.(), 260);
  });

  // Keep the same chart while new candle sets arrive for this trade.
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
        layout: { fontSize: 11, attributionLogo: false }, // licence notice lives on Tune (UX-E5, D-V4)
        rightPriceScale: { scaleMargins: { top: 0.14, bottom: 0.12 } },
        timeScale: { timeVisible: true, secondsVisible: false, rightOffset: DEFAULT_RIGHT_OFFSET_BARS, minBarSpacing: MIN_BAR_SPACING_PX },
        // A vertical swipe that starts on the chart scrolls the page (UX-41). The chart owns pinch (UX-44).
        handleScroll: { vertTouchDrag: false },
        handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      });
      const volumeSeries = addVolumePane(chart, lwc);
      const series = chart.addSeries(lwc.CandlestickSeries, {
        borderVisible: false, priceLineVisible: false, lastValueVisible: false,
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol)?.tickSize ?? 0.01 },
      });
      // Levels attach first so their rays sit under the Position Box.
      const levelsPrimitive = new SessionLevelsPrimitive();
      series.attachPrimitive(levelsPrimitive);
      const indicatorBandsPrimitive = new IndicatorBandsPrimitive();
      series.attachPrimitive(indicatorBandsPrimitive);
      const primitive = new PositionBoxPrimitive();
      series.attachPrimitive(primitive);
      // VWAP never widens the price scale: the trade's candles set it (docs/12 §5 rule for overlays).
      const vwapSeries = chart.addSeries(lwc.LineSeries, {
        // No axis tag: the series' last value is the session close, not the line in view. The crosshair readout shows it.
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol)?.tickSize ?? 0.01 },
      });
      const weeklyVwapSeries = chart.addSeries(lwc.LineSeries, {
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol)?.tickSize ?? 0.01 },
      });
      // IN-3: the 200 EMA never widens the price scale either (its warm-up can reach far from the trade).
      const emaSeries = chart.addSeries(lwc.LineSeries, {
        lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
        priceFormat: { type: "price", precision: 2, minMove: specFor(trade.symbol)?.tickSize ?? 0.01 },
      });
      const state: Live = {
        lwc, host, chart, series, volumeSeries, primitive, levelsPrimitive, indicatorBandsPrimitive, levelLabels: [], levelRightOffset: DEFAULT_RIGHT_OFFSET_BARS, vwapSeries, renderedVwap: null,
        weeklyVwapSeries, renderedWeeklyVwap: null,
        emaSeries, renderedEma: null, extraSeries: new Map(),
        fitRange: null, renderedBars: [], renderedTimeframe: null, extraBefore: 0, extraAfter: 0,
        baseFitRange: null, barCount: 0,
        userPanned: false, programmaticRangeChange: false,
        programmaticClearTimer: undefined, holdTimer: undefined, viewSettleTimer: undefined,
        heldDefaultRange: null,
      };
      live.current = state;
      draw.current();

      chart.subscribeCrosshairMove((param) => {
        const bar = param.time != null && param.point ? param.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined : undefined;
        const target = latest.current.readout?.current;
        if (target) {
          const symbol = latest.current.trade.symbol;
          const vwapAt = bar ? param.seriesData.get(vwapSeries) as { value?: number } | undefined : undefined;
          const vwapText = vwapAt?.value != null && latest.current.indicatorStyle?.vwap?.labels !== false ? `  ·  VWAP ${latest.current.vwapApproximate ? "≈ " : ""}${formatPrice(vwapAt.value, symbol)}` : "";
          const weeklyAt = bar ? param.seriesData.get(weeklyVwapSeries) as { value?: number } | undefined : undefined;
          const weeklyText = weeklyAt?.value != null && latest.current.indicatorStyle?.weeklyVwap?.labels !== false ? `  ·  W VWAP ${latest.current.weeklyVwapApproximate ? "≈ " : ""}${formatPrice(weeklyAt.value, symbol)}` : "";
          const emaAt = bar ? param.seriesData.get(emaSeries) as { value?: number } | undefined : undefined;
          const emaText = emaAt?.value != null && latest.current.indicatorStyle?.ema?.labels !== false ? `  ·  ${latest.current.indicatorStyle?.ema?.params.length ?? 200} EMA ${latest.current.emaApproximate ? "≈ " : ""}${formatPrice(emaAt.value, symbol)}` : "";
          const extraText = bar ? [...state.extraSeries.values()].flatMap((item) => {
            const at = param.seriesData.get(item.series) as { value?: number } | undefined;
            return at?.value == null || !item.labels ? [] : [`  ·  ${item.label} ${item.approximate ? "≈ " : ""}${formatPrice(at.value, symbol)}`];
          }).join("") : "";
          target.textContent = bar ? `O ${formatPrice(bar.open, symbol)}  H ${formatPrice(bar.high, symbol)}  L ${formatPrice(bar.low, symbol)}  C ${formatPrice(bar.close, symbol)}  ·  ${formatPoints(bar.close - latest.current.trade.entry_price, symbol)} vs entry${vwapText}${weeklyText}${emaText}${extraText}` : "";
          target.parentElement?.toggleAttribute("data-tracking", !!bar);
        }
      });

      // Priority (docs/03 §3): neighbour trade box, then level ray or zone, then dismiss an open card.
      const onChartClick = (param: import("lightweight-charts").MouseEventParams<Time>) => {
        if (!param.point) return;
        const hitTradeId = state.primitive.hitTestTradeId(param.point.x, param.point.y)
          ?? state.primitive.hitTest(param.point.x, param.point.y)?.externalId
          ?? (param.hoveredObjectId as string | undefined);
        const action = resolveTapAction(hitTradeId ?? null, state.levelsPrimitive.hitTestLevel(param.point.x, param.point.y));
        if (action.kind === "neighbour") latest.current.onSelectNeighbour?.(action.tradeId);
        const hit = action.kind === "level" ? action.hit : null;
        setOpenLevel(hit ? { hit, fromList: false } : null);
        latest.current.onSelectLevel?.(hit);
      };
      // A pan, zoom or wheel closes an open card (LB-6).
      const dismissLevel = () => {
        setOpenLevel(null);
        latest.current.onSelectLevel?.(null);
      };
      chart.subscribeClick(onChartClick);

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
          // A user zoom or pan closes an open level card (LB-6).
          dismissLevel();
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
        dismissLevel();
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

      // Price-axis stretch (docs/20 §3). The library's own axis drag works for a mouse, but on touch
      // it treats a vertical drag as page scroll (we keep vertTouchDrag off for UX-41). So a transparent
      // grip sits over the price scale only, with touch-action: none, and drives the scale itself for
      // touch, pen and mouse alike. Double-tap or double-click resets to auto-fit. The chart pane,
      // pinch and horizontal pan are untouched.
      const grip = gripRef.current;
      const priceScale = () => chart.priceScale("right");
      const placeGrip = () => {
        if (!grip) return;
        let width = 0;
        let axisHeight = 0;
        try { width = priceScale().width(); axisHeight = chart.timeScale().height(); } catch { width = 0; }
        grip.style.width = `${width}px`;
        grip.style.height = `${Math.max(0, host.clientHeight - axisHeight)}px`;
      };
      const settleView = () => {
        window.clearTimeout(state.viewSettleTimer);
        state.viewSettleTimer = window.setTimeout(() => latest.current.onRendered?.(), 300);
      };
      const tickSize = () => specFor(latest.current.trade.symbol)?.tickSize ?? 0.01;
      const visiblePrices = (): PriceSpan | null => {
        const range = priceScale().getVisibleRange();
        if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from === range.to) return null;
        return { from: Math.min(range.from, range.to), to: Math.max(range.from, range.to) };
      };
      let drag: { id: number; y: number; start: PriceSpan; moved: boolean } | null = null;
      let lastTap: TapPoint | null = null;
      const onGripDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (drag) return; // a second finger on the axis is ignored
        event.preventDefault();
        const tap = { time: event.timeStamp, x: event.clientX, y: event.clientY };
        if (isDoubleTap(lastTap, tap)) {
          lastTap = null;
          priceScale().setAutoScale(true);
          host.dataset.priceScale = "auto";
          settleView();
          return;
        }
        lastTap = tap;
        const start = visiblePrices();
        if (!start) return;
        drag = { id: event.pointerId, y: event.clientY, start, moved: false };
        try { grip?.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
      };
      const onGripMove = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dy = event.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) < STRETCH_DEAD_ZONE_PX) return;
        event.preventDefault();
        drag.moved = true;
        lastTap = null;
        priceScale().setVisibleRange(stretchPriceRange(drag.start, dy, grip?.clientHeight ?? host.clientHeight, tickSize()));
        host.dataset.priceScale = "manual";
      };
      const onGripEnd = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.id) return;
        const moved = drag.moved;
        drag = null;
        if (moved) settleView();
      };
      const onGripWheel = (event: WheelEvent) => {
        event.preventDefault();
        const start = visiblePrices();
        if (!start) return;
        priceScale().setVisibleRange(stretchPriceRange(start, wheelToDragPx(event.deltaY), grip?.clientHeight ?? host.clientHeight, tickSize()));
        host.dataset.priceScale = "manual";
        settleView();
      };
      grip?.addEventListener("pointerdown", onGripDown);
      grip?.addEventListener("pointermove", onGripMove);
      grip?.addEventListener("pointerup", onGripEnd);
      grip?.addEventListener("pointercancel", onGripEnd);
      grip?.addEventListener("wheel", onGripWheel, { passive: false });
      host.dataset.priceScale = "auto";
      placeGrip();
      requestAnimationFrame(placeGrip);
      // A separate listener, after the user-pan logic above: zoom changes bar spacing, so the pill reserve follows.
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        applyLevelRightOffset(state);
        requestAnimationFrame(placeGrip);
      });

      const resize = new ResizeObserver(() => {
        chart.applyOptions({ width: host.clientWidth, height: host.clientHeight });
        const p = latest.current;
        if (p.theme) {
          const style = fillSlot(p.indicatorStyle?.volume, "bars");
          paintVolumePane(chart, state.volumeSeries, p.bars, p.theme, p.showVolume, host.clientHeight, style ? { color: style.color === "theme:volume" ? undefined : indicatorColor(style.color, p.theme, "volume"), opacity: style.opacity } : undefined);
        }
        applyLevelRightOffset(state);
        requestAnimationFrame(placeGrip);
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
        grip?.removeEventListener("pointerdown", onGripDown);
        grip?.removeEventListener("pointermove", onGripMove);
        grip?.removeEventListener("pointerup", onGripEnd);
        grip?.removeEventListener("pointercancel", onGripEnd);
        grip?.removeEventListener("wheel", onGripWheel);
        chart.unsubscribeClick(onChartClick);
        resize.disconnect();
        live.current = null;
        chart.remove();
        delete host.dataset.ready;
      };
    })();
    return () => { alive = false; cleanup(); };
    // The chart is rebuilt only for a different trade or instrument.
  }, [trade.id, trade.symbol]);

  // Redraw in place for candle refreshes, timeframe changes, edits and appearance changes.
  useEffect(() => {
    draw.current();
  }, [trade, bars, timeframe, marks, levels, vwap, vwapBands, weeklyVwap, weeklyVwapBands, vwapBandFill, showVolume, ema, emaApproximate, zone, privacy, theme, neighbourTrades, levelMode, indicatorStyle, extraIndicatorLines, extraIndicatorBands]);

  return <><div
    ref={hostRef}
    className="chart-host"
    role="img"
    aria-label={`${describeTrade(trade, zone, privacy, { accounts: accounts.accounts, prefs })} Candlestick chart with the position box.`}
    data-timeframe={timeframe}
    data-visible-bars={diagnosticWindow.visibleBars.toFixed(3)}
    data-trade-share={(diagnosticWindow.holdBars / diagnosticWindow.visibleBars).toFixed(4)}
  />
  {/* Drag up or down to stretch the price scale; double-tap to auto-fit (docs/20 §3). */}
  <div ref={gripRef} className="price-axis-grip" aria-hidden="true" title="Drag to stretch the price scale. Double-click to auto-fit." />
  {openLevel && <LevelCard hit={openLevel.hit} symbol={trade.symbol} onClose={closeLevel} />}
  </>;
}
