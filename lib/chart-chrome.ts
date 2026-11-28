// Chart chrome constants and the right-edge offset rule (08-visual-quality §2 F-10, §7.3 UX-E5, §8 D-V4).
// Pure: no DOM, no lightweight-charts runtime. The pill-column maths stays in SessionLevelsPrimitive.ts.

import { computeLevelRightOffsetBars } from "../components/SessionLevelsPrimitive.ts";
import { THIN_BAR_SPACING_PX } from "./chart-thin-width.ts";

/**
 * TradingView attribution. The lightweight-charts licence (Apache 2.0) requires attribution, so the
 * in-chart logo is switched off (`attributionLogo: false`) and this notice is shown on Tune instead (D-V4).
 */
export const TRADINGVIEW_ATTRIBUTION = {
  label: "TradingView Lightweight Charts™",
  href: "https://www.tradingview.com/lightweight-charts/",
  notice: "Candlestick charts powered by TradingView Lightweight Charts™ (Apache License 2.0).",
} as const;

/** Breathing room, in bars, between the newest bar and the right price axis (F-10). */
export const DEFAULT_RIGHT_OFFSET_BARS = 2;

/**
 * Smallest CSS spacing the chart will use while continuously zooming out.
 *
 * This is intentionally approximately one pixel: the chart must keep fitting more history as the
 * user pinches out, TradingView-style. The old 3px floor made zooming stop abruptly on phones and
 * is retired by D-014/RM-E2.
 */
export const MIN_BAR_SPACING_PX = THIN_BAR_SPACING_PX;

/**
 * Right offset in bars: the larger of the breathing room and the bars the level pill column needs.
 * With no pills the column needs 0 bars, so the result is the breathing room. With no measurable
 * bar spacing yet (a zero-width or empty chart) it falls back to the breathing room.
 */
export function effectiveRightOffsetBars(pillCount: number, pillColumnWidthPx: number, barSpacing: number): number {
  if (!(barSpacing > 0)) return DEFAULT_RIGHT_OFFSET_BARS;
  const pillOffset = computeLevelRightOffsetBars(pillCount, pillColumnWidthPx, barSpacing);
  return Math.max(DEFAULT_RIGHT_OFFSET_BARS, pillOffset);
}
