// Pure preference sanitizers and defaults (no React, no window). Split out of lib/prefs.ts so server routes can import the command layer (#185a).
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS } from "./time.ts";
import { migrateLegacyIndicators, sanitizeIndicatorInstances } from "./indicator-kit.ts";
import type { IndicatorInstance } from "./indicator-kit.ts";

export type GoldPreset = "bullion" | "champagne" | "amber" | "platinum";
export type Palette = "classic" | "blue-orange";
/** Session VWAP anchor on the trade chart (IND-1, OD-18). "off" draws nothing. */
export type VwapAnchorPref = "off" | "rth" | "globex";
/** Level labels: "tap" reveals them on tap, "always" keeps the right-edge pills (D-D, LV-09). */
export type LevelLabelsMode = "tap" | "always";
/** Review card orientation for share exports (Q-5, DR-3). */
export type ReviewCardOrientation = "portrait" | "landscape";

export interface Prefs {
  /** Hide dollars and size everywhere; show R and points (UX-64). */
  shield: boolean;
  goldPreset: GoldPreset;
  goldIntensity: number;
  boxOpacity: number;
  palette: Palette;
  timeZone: string;
  showSamples: boolean;
  /** Review queue hides the outcome until the entry has been judged (docs/13 BET-03). */
  blindReview: boolean;
  /** Dollars risked per trade, used to suggest a stop distance (docs/12 LV-17). */
  riskBudgetUsd: number;
  /** Session VWAP anchor the trader last chose on the trade chart (IND-1). */
  vwapAnchor: VwapAnchorPref;
  /** Draw volume-weighted standard-deviation bands with session/weekly VWAP. */
  vwapBands?: boolean;
  /** Positive band multipliers; defaults to 1σ and 2σ. */
  vwapBandMultiples?: number[];
  /** Fill between each upper/lower band pair in the chart canvas. */
  vwapBandFill?: boolean;
  /** Sunday 18:00 ET anchored weekly VWAP. */
  weeklyVwap?: boolean;
  /** Level label mode on the trade chart (D-D). */
  levelLabels: LevelLabelsMode;
  /** Draw the 200 EMA on the trade chart (IN-3, D-G). */
  ema200: boolean;
  /** Volume pane under the trade chart (VOL-1). Shown only when the bars carry real volume. Optional in the type so existing Prefs literals still compile; sanitize always fills it. */
  showVolume?: boolean;
  /** Orientation of exported review cards (Q-5). */
  reviewCardOrientation: ReviewCardOrientation;
  /** Ordered indicator kit instances. Each owns its inputs, visibility and style (IK-2). */
  indicators: IndicatorInstance[];
}

export const DEFAULT_PREFS: Prefs = {
  shield: false,
  goldPreset: "bullion",
  goldIntensity: 0.76,
  boxOpacity: 0.28,
  palette: "classic",
  timeZone: DEFAULT_TIME_ZONE,
  showSamples: true,
  blindReview: false,
  riskBudgetUsd: 250,
  vwapAnchor: "off",
  vwapBands: true,
  vwapBandMultiples: [1, 2],
  vwapBandFill: false,
  weeklyVwap: false,
  levelLabels: "tap",
  ema200: false,
  showVolume: true,
  reviewCardOrientation: "portrait",
  indicators: migrateLegacyIndicators({}),
};

export const GOLD_PRESETS: GoldPreset[] = ["bullion", "champagne", "amber", "platinum"];

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Validate a stored or imported prefs object. Used by the persistence adapter (#175) as well as hydration. */
export function sanitizePrefs(raw: unknown): Prefs {
  return sanitize(raw && typeof raw === "object" ? raw as Partial<Prefs> : {});
}

export function sanitize(raw: Partial<Prefs>): Prefs {
  const multiples = Array.isArray(raw.vwapBandMultiples)
    ? [...new Set(raw.vwapBandMultiples.filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10))].sort((a, b) => a - b).slice(0, 4)
    : [];
  return {
    shield: raw.shield === true,
    goldPreset: GOLD_PRESETS.includes(raw.goldPreset as GoldPreset) ? raw.goldPreset as GoldPreset : DEFAULT_PREFS.goldPreset,
    goldIntensity: clamp(raw.goldIntensity, 0, 1, DEFAULT_PREFS.goldIntensity),
    boxOpacity: clamp(raw.boxOpacity, 0.15, 0.65, DEFAULT_PREFS.boxOpacity),
    palette: raw.palette === "blue-orange" ? "blue-orange" : "classic",
    timeZone: TIME_ZONE_OPTIONS.some((zone) => zone.id === raw.timeZone) ? raw.timeZone as string : DEFAULT_PREFS.timeZone,
    showSamples: raw.showSamples !== false,
    blindReview: raw.blindReview === true,
    riskBudgetUsd: clamp(raw.riskBudgetUsd, 10, 100_000, DEFAULT_PREFS.riskBudgetUsd),
    vwapAnchor: raw.vwapAnchor === "rth" || raw.vwapAnchor === "globex" ? raw.vwapAnchor : DEFAULT_PREFS.vwapAnchor,
    vwapBands: raw.vwapBands !== false,
    vwapBandMultiples: multiples.length ? multiples : [...DEFAULT_PREFS.vwapBandMultiples!],
    vwapBandFill: raw.vwapBandFill === true,
    weeklyVwap: raw.weeklyVwap === true,
    levelLabels: raw.levelLabels === "always" ? "always" : DEFAULT_PREFS.levelLabels,
    ema200: raw.ema200 === true,
    showVolume: raw.showVolume !== false,
    reviewCardOrientation: raw.reviewCardOrientation === "landscape" ? "landscape" : DEFAULT_PREFS.reviewCardOrientation,
    indicators: sanitizeIndicatorInstances(raw.indicators, raw),
  };
}
