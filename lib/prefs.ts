// Device preferences: Shield mode, visual tuning, display zone. Applied as CSS variables and data
// attributes on <html>, so every screen and the chart Canvas update live (Invariant 5).
import { useSyncExternalStore } from "react";
import { refreshTheme } from "./theme.ts";
import { DEFAULT_PREFS, sanitize } from "./prefs-sanitize.ts";
import type { Prefs } from "./prefs-sanitize.ts";
export { DEFAULT_PREFS, GOLD_PRESETS, sanitizePrefs } from "./prefs-sanitize.ts";
export type { GoldPreset, Palette, Prefs } from "./prefs-sanitize.ts";

export const PREFS_KEY = "mogmine-prefs-v1";

let prefs: Prefs = DEFAULT_PREFS;
let hydrated = false;
const listeners = new Set<() => void>();

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
