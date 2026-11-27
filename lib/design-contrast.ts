/**
 * Shared dark-surface contrast semantics (DS-01 / DS-12).
 *
 * Keep primary text and chart paint decisions separate. These values are for
 * secondary UI copy and exported-card fallbacks, where a CSS cascade is not
 * available. The CSS tokens in app/globals.css intentionally mirror them.
 */
export const DESIGN_CONTRAST = {
  textMuted: "#A3ABBD",
  textFaint: "#8B93A7",
  chartAxis: "#8B93A7",
  lossText: "#FF7B85",
} as const;
