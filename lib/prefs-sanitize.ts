// Pure preference sanitizers and defaults (no React, no window). Split out of lib/prefs.ts so server routes can import the command layer (#185a).
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS } from "./time.ts";

export type GoldPreset = "bullion" | "champagne" | "amber" | "platinum";
export type Palette = "classic" | "blue-orange";
/** Session VWAP anchor on the trade chart (IND-1, OD-18). "off" draws nothing. */
export type VwapAnchorPref = "off" | "rth" | "globex";
/** Session VWAP standard-deviation bands on the trade chart. */
export type VwapBandsMode = "off" | "1sd" | "2sd";
/** Level labels: "tap" reveals them on tap, "always" keeps the right-edge pills (D-D, LV-09). */
export type LevelLabelsMode = "tap" | "always";
/** Review card orientation for share exports (Q-5, DR-3). */
export type ReviewCardOrientation = "portrait" | "landscape";

export interface CurrentFocusPreference {
  text: string;
  sessionDate: string;
  sourceReviewId: string;
  sourceAccountId: string | null;
  pinnedAt: string;
}

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
  /** Session VWAP standard-deviation band visibility ("off" | "1sd" | "2sd"). */
  vwapBands: VwapBandsMode;
  /** Level label mode on the trade chart (D-D). */
  levelLabels: LevelLabelsMode;
  /** Draw the 200 EMA on the trade chart (IN-3, D-G). */
  ema200: boolean;
  /** Volume pane under the trade chart (VOL-1). Shown only when the bars carry real volume. Optional in the type so existing Prefs literals still compile; sanitize always fills it. */
  showVolume?: boolean;
  /** Orientation of exported review cards (Q-5). */
  reviewCardOrientation: ReviewCardOrientation;
  /** Account-scoped, remotely synced focus pins. `*` is the all-accounts scope. */
  currentFocusByAccount?: Record<string, CurrentFocusPreference>;
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
  riskBudgetUsd: 300,
  vwapAnchor: "off",
  vwapBands: "1sd",
  levelLabels: "tap",
  ema200: false,
  showVolume: true,
  reviewCardOrientation: "portrait",
  currentFocusByAccount: {},
};

export const GOLD_PRESETS: GoldPreset[] = ["bullion", "champagne", "amber", "platinum"];

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function sanitizeCurrentFocus(raw: unknown): Record<string, CurrentFocusPreference> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, CurrentFocusPreference> = {};
  for (const [scope, candidate] of Object.entries(raw)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || (!scope.trim())) continue;
    const value = candidate as Partial<CurrentFocusPreference>;
    if (typeof value.text !== "string" || !value.text.trim() || typeof value.sessionDate !== "string" ||
      typeof value.sourceReviewId !== "string" || typeof value.pinnedAt !== "string") continue;
    result[scope.slice(0, 200)] = {
      text: value.text.replace(/\s+/g, " ").trim().slice(0, 500),
      sessionDate: value.sessionDate.slice(0, 10),
      sourceReviewId: value.sourceReviewId.slice(0, 300),
      sourceAccountId: typeof value.sourceAccountId === "string" ? value.sourceAccountId.slice(0, 200) : null,
      pinnedAt: value.pinnedAt,
    };
  }
  return result;
}

/** Validate a stored or imported prefs object. Used by the persistence adapter (#175) as well as hydration. */
export function sanitizePrefs(raw: unknown): Prefs {
  return sanitize(raw && typeof raw === "object" ? raw as Partial<Prefs> : {});
}

export function sanitize(raw: Partial<Prefs>): Prefs {
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
    vwapBands: raw.vwapBands === "off" || raw.vwapBands === "1sd" || raw.vwapBands === "2sd" ? raw.vwapBands : DEFAULT_PREFS.vwapBands,
    levelLabels: raw.levelLabels === "always" ? "always" : DEFAULT_PREFS.levelLabels,
    ema200: raw.ema200 === true,
    showVolume: raw.showVolume !== false,
    reviewCardOrientation: raw.reviewCardOrientation === "landscape" ? "landscape" : DEFAULT_PREFS.reviewCardOrientation,
    currentFocusByAccount: sanitizeCurrentFocus(raw.currentFocusByAccount),
  };
}
