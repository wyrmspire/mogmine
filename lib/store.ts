// The journal on this device. Local-first: every change is in memory at once and on disk a moment later
// (UX-30, UX-31). Trades are stored without candles, so a keystroke in a note never rewrites megabytes;
// candles live in IndexedDB (lib/candles.ts).
import { useSyncExternalStore } from "react";
import { DEMO_TRADE_IDS, demoTrades } from "./fixtures.ts";
import { idbSet } from "./idb.ts";
import { annotationKey, candleCacheKey, candleSignature, deriveReviewStatus, keepInitialStop, normalizeTrade } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";
import { byNewest } from "./journal-backup.ts";
import type { LegacyTrade } from "./journal-backup.ts";
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";
export { candleCacheKey, candleSignature };
// The backup file lives in journal-backup.ts; re-exported so importers are unchanged (#190).
export { buildBackup, parseBackupFile } from "./journal-backup.ts";
export type { JournalBackup, ParseBackupResult } from "./journal-backup.ts";

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

/**
 * Whether a stored sample's annotations belong to the trader (issues #48, #62).
 *
 * 1. `annotations_modified: true` is the trader's. `updateTrade` sets it on any annotation change.
 * 2. `annotations_modified: false` stamped by an older fixture was never edited, so its annotations are
 *    that older fixture's defaults and may be refreshed.
 * 3. Otherwise (a legacy record without the flag, or one stamped by this same fixture) the annotations
 *    are untouched only when they equal a known default: this fixture's own, or `previous`, an older
 *    fixture the caller supplies. Anything else is the trader's and is kept. Unknown means keep, never overwrite.
 */
function annotationsModified(stored: TradeRecord, fixture: TradeRecord, previous?: TradeRecord): boolean {
  if (stored.annotations_modified === true) return true;
  if (stored.annotations_modified === false && stored.fixture_version !== fixture.fixture_version) return false;
  const defaults = [fixture, previous].flatMap((trade) => (trade ? [annotationKey(trade)] : []));
  return !defaults.includes(annotationKey(stored));
}

/**
 * Refresh a stored sample from the current fixture (issues #48, #62).
 *
 * Always replaced: the market facts (symbol, times, prices, size, style) and the fixture version, so an
 * old outcome never survives. Annotations are replaced by the fixture's defaults only while they are
 * untouched (see `annotationsModified`). Pass `previous` to recognise an older fixture's default notes.
 * Review fields (flags, blind review, review status) are the trader's and are always kept. Real trades
 * are never changed. First-time inserts use the fixture as a whole.
 */
export function applyFixtureRefresh(stored: TradeRecord, fixture: TradeRecord, previous?: TradeRecord): TradeRecord {
  if (!stored.is_sample) return stored;
  const modified = annotationsModified(stored, fixture, previous);
  return normalizeTrade({
    ...stored,
    ...(modified ? {} : pickAnnotations(fixture)),
    symbol: fixture.symbol,
    direction: fixture.direction,
    quantity: fixture.quantity,
    entry_time: fixture.entry_time,
    exit_time: fixture.exit_time,
    entry_price: fixture.entry_price,
    exit_price: fixture.exit_price,
    stop_loss_price: fixture.stop_loss_price,
    planned_target_price: fixture.planned_target_price,
    key_level_price: fixture.key_level_price,
    trade_style: fixture.trade_style,
    is_sample: true,
    flagged: stored.flagged,
    take_again: stored.take_again,
    take_again_at: stored.take_again_at,
    review_status: stored.review_status,
    candle_source: undefined,
    sparkline: [],
    fixture_version: fixture.fixture_version,
    annotations_modified: modified,
  });
}

function pickAnnotations(trade: TradeRecord) {
  return {
    playbook_id: trade.playbook_id,
    checklist_state: trade.checklist_state,
    note: trade.note,
    quick_tags: trade.quick_tags,
    pre_trade_thesis: trade.pre_trade_thesis,
    management_notes: trade.management_notes,
    post_exit_notes: trade.post_exit_notes,
  };
}


function emptyJournal(): JournalState {
  return { trades: [...demoTrades].sort(byNewest), hydrated: false, saveState: "idle" };
}

const serverState: JournalState = emptyJournal();
let state: JournalState = emptyJournal();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
// Fields changed since the last successful write. A storage event may bring newer fields from another
// tab, but it must not erase work that is still waiting to be written in this one.
const pending = new Map<string, Partial<TradeRecord> | null>();

// Remote sync (#190). With NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase, real trades are copied to Supabase in the
// background; device storage above stays the offline copy and is always written first. Samples never sync.
function applyRemote(next: TradeRecord[]) {
  set({ trades: mergeIncoming(next.map((trade) => normalizeTrade(trade))) });
  persist();
}

function createTradeSync(overrides: Partial<CollectionSyncOptions<TradeRecord>> = {}): CollectionSync {
  return createCollectionSync<TradeRecord>({
    key: "trades",
    getLocal: () => state.trades,
    apply: applyRemote,
    include: (trade) => !trade.is_sample,
    ...overrides,
  });
}

let tradeSync: CollectionSync = createTradeSync();

function set(next: Partial<JournalState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function persist() {
  clearTimeout(saveTimer);
  set({ saveState: "saving" });
  saveTimer = setTimeout(flush, 180);
}

/** Write the current journal now. False means the in-memory session is still usable but not durable. */
export function flushJournal(): boolean {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trades));
    pending.clear();
    set({ saveState: "saved" });
    return true;
  } catch {
    set({ saveState: "error" });
    return false;
  }
}

function flush() { flushJournal(); }

function remember(id: string, patch: Partial<TradeRecord> | null) {
  if (patch === null) pending.set(id, null);
  else pending.set(id, { ...(pending.get(id) ?? {}), ...patch });
}

/**
 * Merge another tab's durable copy with this tab's unflushed work.
 *
 * Conflict rule: a pending local value wins for the same field. Unedited fields come from the incoming
 * record. A locally added or edited record survives an incoming deletion; a pending local deletion wins.
 */
function mergeIncoming(incoming: TradeRecord[]): TradeRecord[] {
  const merged = new Map(incoming.map((trade) => [trade.id, trade]));
  const local = new Map(state.trades.map((trade) => [trade.id, trade]));
  for (const [id, patch] of pending) {
    if (patch === null) {
      merged.delete(id);
      continue;
    }
    const base = merged.get(id) ?? local.get(id);
    if (base) merged.set(id, { ...base, ...patch });
  }
  return [...merged.values()].sort(byNewest);
}

function readStored(): TradeRecord[] | null {
  const current = localStorage.getItem(STORAGE_KEY);
  const raw = current ?? LEGACY_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as LegacyTrade[];
  if (!Array.isArray(parsed)) return null;
  return parsed.flatMap((item) => {
    // An open trade (R-03) has null exits. A closed or legacy record with a missing exit is still dropped.
    const exitOk = item?.status === "open" || (item?.exit_time && item.exit_price != null);
    if (!item?.id || !item.symbol || !item.entry_time || !exitOk || item.entry_price == null || !item.direction) return [];
    const { candles, ...rest } = item;
    let trade: TradeRecord;
    try {
      trade = normalizeTrade({ ...(rest as TradeRecord), is_sample: rest.is_sample ?? DEMO_TRADE_IDS.has(item.id) });
    } catch {
      return []; // status and exit fields disagree: drop this one record, keep the rest
    }
    // Refresh fixture-owned facts. Samples now carry a plan fixed at entry and an outcome walked from Yahoo bars;
    // stale device copies must not preserve the old impossible exits. Real trades are never changed.
    const currentDemo = demoById.get(trade.id);
    if (currentDemo && trade.is_sample) trade = applyFixtureRefresh(trade, currentDemo);
    // Yahoo candles from an older build are real market data: keep them only when their ticker
    // matches the current spec (OD-15). Skip samples so stale bars are not cached under the #29 signature.
    if (!current && candles?.length && rest.candle_source === "Yahoo Finance" && rest.yahoo_ticker === trade.yahoo_ticker && !trade.is_sample) {
      void idbSet(candleCacheKey(trade), { signature: candleSignature(trade), candles, source: "Yahoo Finance", baseTimeframe: "1m", fetchedAt: Date.now() });
    }
    return [trade];
  });
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
    // Another tab changed the journal: accept it, overlaid with fields still pending in this tab.
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const incoming = (JSON.parse(event.newValue) as TradeRecord[]).map((trade) => normalizeTrade(trade));
      set({ trades: mergeIncoming(incoming) });
      tradeSync.changed();
    } catch { /* keep ours */ }
  });
  tradeSync.start();
}

export function addTrade(trade: TradeRecord) {
  remember(trade.id, trade);
  set({ trades: [trade, ...state.trades.filter((item) => item.id !== trade.id)].sort(byNewest) });
  persist();
  tradeSync.changed();
}

/** Add a trade and confirm the device write before the caller reports success or clears its draft. */
export function addTradeAndFlush(trade: TradeRecord): boolean {
  addTrade(trade);
  return flushJournal();
}

/** Column-scoped update: only the named fields change (B-47). */
export function updateTrade(id: string, patch: Partial<TradeRecord>) {
  let changed = false;
  const trades = state.trades.map((trade) => {
    if (trade.id !== id) return trade;
    changed = true;
    const next = { ...trade, ...patch };
    // A trader's change to an annotation is theirs, so a later fixture refresh keeps it (issue #62).
    if (annotationKey(next) !== annotationKey(trade)) next.annotations_modified = true;
    next.review_status = deriveReviewStatus(next);
    remember(id, Object.fromEntries(
      Object.keys(next)
        .filter((key) => next[key as keyof TradeRecord] !== trade[key as keyof TradeRecord])
        .map((key) => [key, next[key as keyof TradeRecord]]),
    ) as Partial<TradeRecord>);
    return next;
  });
  if (!changed) return;
  set({ trades });
  persist();
  tradeSync.changed();
}

export function removeTrade(id: string) {
  const removed = state.trades.find((trade) => trade.id === id);
  if (!removed) return null;
  remember(id, null);
  set({ trades: state.trades.filter((trade) => trade.id !== id) });
  persist();
  tradeSync.changed();
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
  // A restore never overwrites an initial stop this device already froze for the same trade (R-10).
  const current = new Map(state.trades.map((trade) => [trade.id, trade]));
  const replacements = trades.map((trade) => keepInitialStop(trade, current.get(trade.id))).sort(byNewest);
  const replacementIds = new Set(replacements.map((trade) => trade.id));
  for (const id of current.keys()) if (!replacementIds.has(id)) remember(id, null);
  for (const trade of replacements) remember(trade.id, trade);
  set({ trades: replacements });
  persist();
  tradeSync.changed();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Test hook: restore the unhydrated demo journal and the default (disabled) trade syncer. */
export function resetJournalForTests() {
  clearTimeout(saveTimer);
  pending.clear();
  state = emptyJournal();
  tradeSync.dispose();
  tradeSync = createTradeSync();
}

/** Test hook: swap the trade syncer's adapter, storage or timers. Returns the syncer under test. */
export function configureTradeSyncForTests(overrides: Partial<CollectionSyncOptions<TradeRecord>>): CollectionSync {
  tradeSync.dispose();
  tradeSync = createTradeSync(overrides);
  return tradeSync;
}

/** Test hook: read the in-memory journal after hydrate/persist. */
export function getJournalState() {
  return state;
}

export function useJournal() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
