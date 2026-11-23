// Device preferences: Shield mode, visual tuning, display zone. Applied as CSS variables and data
// attributes on <html>, so every screen and the chart Canvas update live (Invariant 5).
import { useSyncExternalStore } from "react";
import { refreshTheme } from "./theme.ts";
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

export const PREFS_KEY = "mogmine-prefs-v1";
export const GOLD_PRESETS: GoldPreset[] = ["bullion", "champagne", "amber", "platinum"];

let prefs: Prefs = DEFAULT_PREFS;
let hydrated = false;
const listeners = new Set<() => void>();

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Validate a stored or imported prefs object. Used by the persistence adapter (#175) as well as hydration. */
export function sanitizePrefs(raw: unknown): Prefs {
  return sanitize(raw && typeof raw === "object" ? raw as Partial<Prefs> : {});
}

function sanitize(raw: Partial<Prefs>): Prefs {
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

function apply() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.goldPreset = prefs.goldPreset;
  root.dataset.palette = prefs.palette;
  root.dataset.shield = prefs.shield ? "on" : "off";
  root.style.setProperty("--gold-intensity", String(prefs.goldIntensity));
  root.style.setProperty("--position-box-opacity", String(prefs.boxOpacity));
  refreshTheme();
}

export function hydratePrefs() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    if (stored) prefs = sanitize(JSON.parse(stored) as Partial<Prefs>);
  } catch { /* defaults */ }
  apply();
  listeners.forEach((listener) => listener());
}

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = sanitize({ ...prefs, ...patch });
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* still applies for this session */ }
  apply();
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function usePrefs() {
  return useSyncExternalStore(subscribe, () => prefs, () => DEFAULT_PREFS);
}

export interface TuneRiskBudgetDisplay {
  label: string;
  valueText: string;
  inputValue: string;
  inputAriaLabel: string;
  isEditable: boolean;
  hint: string;
}

export function getTuneRiskBudgetDisplay(shield: boolean, riskBudgetUsd: number): TuneRiskBudgetDisplay {
  if (shield) {
    return {
      label: "Risk budget",
      valueText: "Hidden",
      inputValue: "Hidden",
      inputAriaLabel: "Risk budget (hidden while Shield mode is on)",
      isEditable: false,
      hint: "Used by manual entry to suggest stop distance and by Trade Detail risk chips. Turn Shield mode off to change the dollar amount.",
    };
  }
  return {
    label: "Risk budget ($ USD)",
    valueText: `$${riskBudgetUsd}`,
    inputValue: String(riskBudgetUsd),
    inputAriaLabel: "Risk budget in US dollars",
    isEditable: true,
    hint: "Used by manual entry to suggest stop distance and by Trade Detail risk chips (default $250).",
  };
}
