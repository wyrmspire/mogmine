// Strategy Lab client sync (docs/design-2026-11-24/09 §7.7, §11; SL-15b). Two hooks and their pure helpers:
// - useLabPersistence: local recipes and runs first, then the server copies merged in the background. Saves push
//   asynchronously; a failure (42P01, unavailable, signed out) is silent and the local copy stands.
// - useBarStoreAutoTopUp: fills the 1m bar store for recent sessions and for each real MES trade on open and on
//   every entry or time edit. Browser code never writes `mogmine_bars_1m`; the server does, through the archive job.
import { useEffect, useRef, useState } from "react";
import { sessionDate } from "../session.ts";
import type { TradeRecord } from "../trades.ts";
import { MINUTE_MS, sessionsForTrade } from "./bar-coverage.ts";
import {
  fillSessionBars, isCacheable, recentSessionDates, sessionWindow, defaultSessionCache, type BarLoaderDeps,
} from "./bars.ts";
import {
  createStrategyLabRemoteRepo, loadLocalRuns, RUN_STORE_LIMIT, saveLocalRun, type PersistedRun, type RunStorage,
  type StrategyLabRemoteRepo,
} from "./persistence.ts";
import { runSummaryLine } from "./results-view.ts";
import { type RecipeStore } from "./recipes-store.ts";
import type { Recipe } from "./types.ts";

const TOP_UP_CONCURRENCY = 2;
const OPEN_TRADE_LIMIT = 10;

// Pure helpers (no React, no network): exercised headlessly by the sync tests.

const recipeKey = (recipe: Pick<Recipe, "id" | "version">) => `${recipe.id}@${recipe.version}`;

/** Union by `id@version`. Local wins on a shared key, so a newer or edited local version is never dropped. */
export function mergeRecipeStores(local: RecipeStore, remote: RecipeStore): RecipeStore {
  const keys = new Set(local.recipes.map(recipeKey));
  return { recipes: [...local.recipes, ...remote.recipes.filter((recipe) => !keys.has(recipeKey(recipe)))] };
}

/** Union by run `id`, newest first, capped at the local store limit. Local wins on a shared id. */
export function mergeRunLists(local: readonly PersistedRun[], remote: readonly PersistedRun[]): PersistedRun[] {
  const byId = new Map<string, PersistedRun>();
  for (const run of [...remote, ...local]) byId.set(run.id, run);
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RUN_STORE_LIMIT);
}

/** The newest persisted run per recipe as a Recipes-tab summary line. */
export function persistedLastRuns(runs: readonly PersistedRun[]): Record<string, string> {
  const lines: Record<string, string> = {};
  for (const run of runs) lines[run.recipeId] ??= runSummaryLine(run.summary);
  return lines;
}

/** True when a persisted run exists for exactly this recipe version (the editor's "newestHasRuns"). */
export function runsCoverVersion(runs: readonly PersistedRun[], recipeId: string, version: number): boolean {
  return runs.some((run) => run.recipeId === recipeId && run.recipeVersion === version);
}

export function tradeSignature(trade: Pick<TradeRecord, "id" | "symbol" | "entry_time" | "exit_time">): string {
  return `${trade.id}|${trade.symbol}|${trade.entry_time}|${trade.exit_time ?? ""}`;
}

/** Signature per trade id. Notes and other fields are not part of it, so note edits never re-trigger a top-up. */
export function tradeSignatures(trades: readonly TradeRecord[]): Map<string, string> {
  return new Map(trades.map((trade) => [trade.id, tradeSignature(trade)]));
}

/** Sessions to top up for trades that are new or whose symbol or times changed since `seen`. */
export function sessionsForChangedTrades(seen: ReadonlyMap<string, string>, trades: readonly TradeRecord[], now = Date.now()): string[] {
  const dates: string[] = [];
  for (const trade of trades) {
    if (seen.get(trade.id) !== tradeSignature(trade)) dates.push(...sessionsForTrade(trade, now));
  }
  return [...new Set(dates)];
}

// Bar top-up runner (browser-side, device cache plus `mogmine_bars_1m` reads and Yahoo for gaps only).

/**
 * Tops up one session: device entry, then the server store for a settled session, then Yahoo for missing minutes
 * only, up to the current minute. Rerunning with full coverage makes zero network calls. Returns whether it changed.
 */
export async function topUpSessionBars(date: string, deps: BarLoaderDeps = {}): Promise<{ changed: boolean; bars: number }> {
  const now = (deps.now ?? Date.now)();
  const window = sessionWindow(date);
  const effectiveTo = Math.min(window.to, Math.floor(now / MINUTE_MS) * MINUTE_MS);
  if (effectiveTo <= window.from) return { changed: false, bars: 0 };
  const outcome = await fillSessionBars(window, effectiveTo, deps, deps.cache ?? defaultSessionCache, now);
  return { changed: outcome.changed, bars: outcome.bars.length };
}

/** Tops up several sessions with at most two in flight. Failures are silent: the lab shows whatever it has. */
export async function topUpSessionsForTradesAndOpen(dates: readonly string[], deps: BarLoaderDeps = {}): Promise<void> {
  const queue = [...new Set(dates)];
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const date = queue[next];
      next += 1;
      try { await topUpSessionBars(date, deps); } catch { /* silent: a later open retries */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TOP_UP_CONCURRENCY, queue.length) }, worker));
}

/** On opening Strategy Lab: the last five sessions, including today's in-progress one. */
export function topUpOnLabOpen(now: number = Date.now()): Promise<void> {
  return topUpSessionsForTradesAndOpen(recentSessionDates(sessionDate(now), 5));
}

const browserStorage = (): RunStorage | null => {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
};

/** Keeps the bar store topped up for the app. Runs on hydration (app open) and whenever a trade changes. */
export function useBarStoreAutoTopUp(trades: readonly TradeRecord[], hydrated: boolean, online: boolean): void {
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!hydrated || !online || typeof window === "undefined") return;
    const now = Date.now();
    let dates: string[];
    if (seen.current === null) {
      const today = sessionDate(now);
      const openTrades = trades.filter((trade) => !trade.is_sample).slice(0, OPEN_TRADE_LIMIT);
      dates = [
        ...recentSessionDates(today, 5).filter((date) => isCacheable(date, now)),
        ...openTrades.flatMap((trade) => sessionsForTrade(trade, now)),
      ];
    } else {
      dates = sessionsForChangedTrades(seen.current, trades, now);
    }
    seen.current = tradeSignatures(trades);
    if (dates.length) void topUpSessionsForTradesAndOpen(dates);
  }, [trades, hydrated, online]);
}

// Recipe and run sync.

export interface LabPersistenceOptions {
  getRecipes: () => RecipeStore;
  setRecipes: (store: RecipeStore) => void;
}

export interface LabPersistence {
  /** Local runs merged with the server copies, newest first. */
  runs: PersistedRun[];
  /** Pushes saved recipes to the server in the background. Local storage is already written by the caller. */
  persistRecipes: (recipes: readonly Recipe[]) => void;
  /** Saves a finished run locally at once, then pushes it in the background. */
  persistRun: (run: PersistedRun) => void;
}

/** The remote repository, created on first use in the browser and kept in the hook's ref. */
function remoteOf(ref: { current: StrategyLabRemoteRepo | null }): StrategyLabRemoteRepo {
  ref.current ??= createStrategyLabRemoteRepo();
  return ref.current;
}

export function useLabPersistence(options: LabPersistenceOptions): LabPersistence {
  const [runs, setRuns] = useState<PersistedRun[]>([]);
  const optionsRef = useRef(options);
  const repoRef = useRef<StrategyLabRemoteRepo | null>(null);
  useEffect(() => { optionsRef.current = options; });

  useEffect(() => {
    let alive = true;
    setRuns(loadLocalRuns(browserStorage()));
    void (async () => {
      const remote = remoteOf(repoRef);
      const recipes = await remote.listRecipes();
      if (alive && recipes.ok) {
        const current = optionsRef.current;
        current.setRecipes(mergeRecipeStores(current.getRecipes(), { recipes: recipes.value }));
      }
      const remoteRuns = await remote.listRuns();
      if (!alive || !remoteRuns.ok) return;
      const storage = browserStorage();
      let kept = loadLocalRuns(storage);
      for (const run of mergeRunLists(kept, remoteRuns.value).reverse()) {
        const saved = saveLocalRun(storage, run);
        if (saved.ok) kept = saved.value;
      }
      setRuns(kept);
    })();
    return () => { alive = false; };
  }, []);

  return {
    runs,
    persistRecipes(recipes) {
      for (const recipe of recipes) void remoteOf(repoRef).putRecipe(recipe);
    },
    persistRun(run) {
      const saved = saveLocalRun(browserStorage(), run);
      if (saved.ok) setRuns(saved.value);
      void remoteOf(repoRef).putRun(run);
    },
  };
}
