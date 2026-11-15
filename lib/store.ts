// The journal on this device. Local-first: every change is in memory at once and on disk a moment later
// (UX-30, UX-31). Trades are stored without candles, so a keystroke in a note never rewrites megabytes;
// candles live in IndexedDB (lib/candles.ts).
import { useSyncExternalStore } from "react";
import { DEMO_TRADE_IDS, demoTrades } from "./fixtures.ts";
import { idbSet } from "./idb.ts";
import { deriveReviewStatus, normalizeTrade } from "./trades.ts";
import type { Candle, TradeRecord } from "./trades.ts";

const STORAGE_KEY = "mogmine-trades-v3";
const demoById = new Map(demoTrades.map((trade) => [trade.id, trade]));
// Older builds stored trades with their candles inline. They are read once and left untouched,
// so going back to an older build still finds its data.
const LEGACY_KEYS = ["mogmine-trades-v2", "mogmine-trades-v1"];

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface JournalState {
  trades: TradeRecord[];
  /** False until device storage has been read. Lists show skeletons, not sample data, until then. */
  hydrated: boolean;
  saveState: SaveState;
}

const byNewest = (a: TradeRecord, b: TradeRecord) => Date.parse(b.entry_time) - Date.parse(a.entry_time);

const serverState: JournalState = { trades: [...demoTrades].sort(byNewest), hydrated: false, saveState: "idle" };
let state: JournalState = serverState;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function set(next: Partial<JournalState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function persist() {
  clearTimeout(saveTimer);
  set({ saveState: "saving" });
  saveTimer = setTimeout(flush, 180);
}

function flush() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trades));
    set({ saveState: "saved" });
  } catch {
    set({ saveState: "error" });
  }
}

type LegacyTrade = Partial<TradeRecord> & { candles?: Candle[] };

function readStored(): TradeRecord[] | null {
  const current = localStorage.getItem(STORAGE_KEY);
  const raw = current ?? LEGACY_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as LegacyTrade[];
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((item) => {
    if (!item?.id || !item.symbol || !item.entry_time || !item.exit_time || item.entry_price == null || item.exit_price == null || !item.direction) return [];
    const { candles, ...rest } = item;
    let trade = normalizeTrade({ ...(rest as TradeRecord), is_sample: rest.is_sample ?? DEMO_TRADE_IDS.has(item.id) });
    // Samples seeded before issue #28 may be stored without a target. Bring only that fixture field
    // forward so every sample has the planned TP that its Position Box is meant to demonstrate.
    const currentDemo = demoById.get(trade.id);
    if (currentDemo && trade.planned_target_price == null) trade = { ...trade, planned_target_price: currentDemo.planned_target_price };
    // Yahoo candles from an older build are real market data: keep them (they expire at the source).
    if (!current && candles?.length && rest.candle_source === "Yahoo Finance") {
      void idbSet(trade.id, { signature: candleSignature(trade), candles, source: "Yahoo Finance", baseTimeframe: "1m", fetchedAt: Date.now() });
    }
    return [trade];
  });
}

export function candleSignature(trade: Pick<TradeRecord, "symbol" | "entry_time" | "exit_time">) {
  return `${trade.symbol}|${trade.entry_time}|${trade.exit_time}`;
}

/** Read device storage once. Safe to call repeatedly. */
export function hydrateJournal() {
  if (state.hydrated || typeof window === "undefined") return;
  let trades = state.trades;
  let saveState: SaveState = "saved";
  try {
    const stored = readStored();
    if (stored) {
      const known = new Set(stored.map((trade) => trade.id));
      trades = [...stored, ...demoTrades.filter((trade) => !known.has(trade.id))].sort(byNewest);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
  } catch {
    saveState = "error"; // Storage is blocked: the session still works, and the header says it is not saved.
  }
  set({ trades, hydrated: true, saveState });
  window.addEventListener("pagehide", flush);
  window.addEventListener("storage", (event) => {
    // Another tab changed the journal: take its copy rather than overwrite it later.
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { set({ trades: (JSON.parse(event.newValue) as TradeRecord[]).map((trade) => normalizeTrade(trade)).sort(byNewest) }); } catch { /* keep ours */ }
  });
}

export function addTrade(trade: TradeRecord) {
  set({ trades: [trade, ...state.trades].sort(byNewest) });
  persist();
}

/** Column-scoped update: only the named fields change (B-47). */
export function updateTrade(id: string, patch: Partial<TradeRecord>) {
  let changed = false;
  const trades = state.trades.map((trade) => {
    if (trade.id !== id) return trade;
    changed = true;
    const next = { ...trade, ...patch };
    next.review_status = deriveReviewStatus(next);
    return next;
  });
  if (!changed) return;
  set({ trades });
  persist();
}

export function removeTrade(id: string) {
  const removed = state.trades.find((trade) => trade.id === id);
  if (!removed) return null;
  set({ trades: state.trades.filter((trade) => trade.id !== id) });
  persist();
  return removed;
}

export function getTrade(id: string) {
  return state.trades.find((trade) => trade.id === id);
}

export function getJournal() {
  return state;
}

/** Replace the whole journal from a backup file. */
export function replaceTrades(trades: TradeRecord[]) {
  set({ trades: [...trades].sort(byNewest) });
  persist();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useJournal() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
