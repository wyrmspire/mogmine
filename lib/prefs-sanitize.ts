// Pure preference sanitizers and defaults (no React, no window). Split out of lib/prefs.ts so server routes can import the command layer (#185a).
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS } from "./time.ts";

export type GoldPreset = "bullion" | "champagne" | "amber" | "platinum";
export type Palette = "classic" | "blue-orange";

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
};

export const GOLD_PRESETS: GoldPreset[] = ["bullion", "champagne", "amber", "platinum"];

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

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
  };
}
