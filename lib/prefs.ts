// Device preferences: Shield mode, visual tuning, display zone. Applied as CSS variables and data
// attributes on <html>, so every screen and the chart Canvas update live (Invariant 5).
import { useSyncExternalStore } from "react";
import { refreshTheme } from "./theme.ts";
import { DEFAULT_PREFS, sanitize } from "./prefs-sanitize.ts";
import type { Prefs } from "./prefs-sanitize.ts";
import { createSingletonSync } from "./persistence/singleton-sync.ts";
import type { SingletonSync, SingletonSyncOptions } from "./persistence/singleton-sync.ts";
export { DEFAULT_PREFS, GOLD_PRESETS, sanitizePrefs } from "./prefs-sanitize.ts";
export type { GoldPreset, Palette, Prefs } from "./prefs-sanitize.ts";

export const PREFS_KEY = "mogmine-prefs-v1";

let prefs: Prefs = DEFAULT_PREFS;
let hydrated = false;
const listeners = new Set<() => void>();

// Remote sync (#191): with NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase the preferences follow the trader across devices.
// The device copy (PREFS_KEY) is always written first; the syncer is background only.
function writeCache() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* still applies for this session */ }
}

function applyRemote(next: Prefs) {
  prefs = sanitize(next);
  writeCache();
  apply();
  listeners.forEach((listener) => listener());
}

function createPrefsSync(overrides: Partial<SingletonSyncOptions<Prefs>> = {}): SingletonSync {
  return createSingletonSync<Prefs>({ key: "prefs", getLocal: () => prefs, apply: applyRemote, unedited: DEFAULT_PREFS, ...overrides });
}

let prefsSync: SingletonSync = createPrefsSync();

// Cross-tab (docs/26 §8.4 #7): another open tab writes PREFS_KEY; adopt its copy so this tab never overwrites it.
let storageListener: ((event: StorageEvent) => void) | null = null;

function listenForStorage() {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    if (event.key !== PREFS_KEY) return;
    try {
      prefs = event.newValue ? sanitize(JSON.parse(event.newValue) as Partial<Prefs>) : DEFAULT_PREFS;
      apply();
      listeners.forEach((listener) => listener());
      prefsSync.changed();
    } catch { /* malformed: keep this tab's copy */ }
  };
  window.addEventListener("storage", storageListener);
}

function stopListeningForStorage() {
  if (storageListener && typeof window !== "undefined") window.removeEventListener?.("storage", storageListener);
  storageListener = null;
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
  listenForStorage();
  prefsSync.start();
}

export function getPrefs(): Prefs {
  return prefs;
}

export function setPrefs(patch: Partial<Prefs>) {
  prefs = sanitize({ ...prefs, ...patch });
  writeCache();
  apply();
  listeners.forEach((listener) => listener());
  prefsSync.changed();
}

/** Test hook: restore the unhydrated defaults and a fresh (disabled by default) syncer. */
export function resetPrefsForTests() {
  stopListeningForStorage();
  prefsSync.dispose();
  prefsSync = createPrefsSync();
  prefs = DEFAULT_PREFS;
  hydrated = false;
}

/** Test hook: swap the syncer's adapter, storage or timers. Returns the syncer under test. */
export function configurePrefsSyncForTests(overrides: Partial<SingletonSyncOptions<Prefs>>): SingletonSync {
  prefsSync.dispose();
  prefsSync = createPrefsSync(overrides);
  return prefsSync;
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
      label: "Default R size",
      valueText: "Hidden",
      inputValue: "Hidden",
      inputAriaLabel: "Default R size (hidden while Shield mode is on)",
      isEditable: false,
      hint: "Used for accounts without their own R size. Turn Shield mode off to change the dollar amount.",
    };
  }
  return {
    label: "Default R size ($ USD)",
    valueText: `$${riskBudgetUsd}`,
    inputValue: String(riskBudgetUsd),
    inputAriaLabel: "Default R size in US dollars",
    isEditable: true,
    hint: "Used for accounts without their own R size and trades with no account (default $250).",
  };
}
