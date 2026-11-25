// VOL-1: volume pane data. Pure helpers, no chart library and no I/O. Display only: volume analysis
// (profiles, relative volume, delta) belongs to Strategy Lab and is not built here.
import type { ChartTheme } from "./theme.ts";
import type { Candle } from "./trades.ts";

/** Fallbacks when the theme omits the volume tokens (literal themes). 08 candle colours at alpha 0.35. */
export const VOLUME_UP_FALLBACK = "rgba(34, 184, 143, 0.35)";
export const VOLUME_DOWN_FALLBACK = "rgba(236, 86, 100, 0.35)";

export interface VolumeHistogramPoint {
  /** Bar open time, UTC milliseconds (same as the candle it belongs to). */
  time: number;
  value: number;
  color: string;
}

/**
 * True only when the window carries real traded volume. Missing (NaN, negative), all-zero and the
 * legacy placeholder `1` on every bar all mean "not real": the chart then hides the pane and VWAP is
 * withheld rather than equal-weighting bars (VOL-1).
 */
export function hasRealVolume(bars: readonly Candle[]): boolean {
  if (bars.length === 0) return false;
  let traded = false;
  let placeholder = true;
  for (const { volume } of bars) {
    if (!Number.isFinite(volume) || volume < 0) return false;
    if (volume > 0) traded = true;
    if (volume !== 1) placeholder = false;
  }
  return traded && !placeholder;
}

/** One histogram point per bar: up-coloured when the bar closed at or above its open, else down. */
export function volumeHistogramData(bars: readonly Candle[], theme: Pick<ChartTheme, "volumeUp" | "volumeDown">): VolumeHistogramPoint[] {
  const up = theme.volumeUp ?? VOLUME_UP_FALLBACK;
  const down = theme.volumeDown ?? VOLUME_DOWN_FALLBACK;
  return bars.map((bar) => ({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? up : down,
  }));
}

/** Share of the pane height the volume histogram may use: ~16% on phone-height charts, ~20% on desktop. */
export function volumeShare(heightPx: number): number {
  return Number.isFinite(heightPx) && heightPx > 0 && heightPx < 420 ? 0.16 : 0.2;
}

/** Scale margins that pin the histogram to the bottom of the pane. */
export function volumeScaleMargins(heightPx: number): { top: number; bottom: number } {
  return { top: 1 - volumeShare(heightPx), bottom: 0 };
}

/** Bottom margin for the candle scale so candles sit above the volume band. */
export function candleBottomMargin(heightPx: number, volumeVisible: boolean): number {
  return volumeVisible ? volumeShare(heightPx) + 0.03 : 0.12;
}
