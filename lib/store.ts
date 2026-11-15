// The journal on this device. Local-first: every change is in memory at once and on disk a moment later
// (UX-30, UX-31). Trades are stored without candles, so a keystroke in a note never rewrites megabytes;
// candles live in IndexedDB (lib/candles.ts).
import { useSyncExternalStore } from "react";
import { DEMO_TRADE_IDS, demoTrades } from "./fixtures.ts";
import { idbSet } from "./idb.ts";
import type { Prefs } from "./prefs.ts";
import { annotationKey, candleCacheKey, candleSignature, deriveReviewStatus, normalizeTrade } from "./trades.ts";
import type { Candle, ChecklistItem, TradeDirection, TradeRecord } from "./trades.ts";
export { candleCacheKey, candleSignature };

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

export interface JournalBackup {
  app: "mogmine";
  version: 1;
  exportedAt: string;
  /** Backups store the trade journal only. Candles sit in IndexedDB and are re-fetched from Yahoo when a chart opens. */
  includesCandles: false;
  trades: TradeRecord[];
  prefs?: Partial<Prefs>;
}

export type ParseBackupResult =
  | { ok: true; trades: TradeRecord[]; prefs?: Partial<Prefs>; realCount: number; sampleCount: number; exportedAt: string | null }
  | { ok: false; error: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function sanitizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") return [];
    return [{ id: candidate.id, label: candidate.label, checked: candidate.checked === true }];
  });
}

function parseTradeItem(raw: unknown): TradeRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as LegacyTrade;
  if (
    typeof item.id !== "string" || !item.id.trim() ||
    typeof item.symbol !== "string" || !item.symbol.trim() ||
    !isValidTime(item.entry_time) ||
    !isValidTime(item.exit_time) ||
    !isFiniteNumber(item.entry_price) ||
    !isFiniteNumber(item.exit_price) ||
    (item.direction !== "LONG" && item.direction !== "SHORT")
  ) {
    return null;
  }
  const rest = { ...item };
  delete rest.candles;
  const isSample = typeof rest.is_sample === "boolean" ? rest.is_sample : DEMO_TRADE_IDS.has(item.id);
  const quickTags = Array.isArray(rest.quick_tags) ? rest.quick_tags.filter((tag): tag is string => typeof tag === "string") : [];
  const sparkline = Array.isArray(rest.sparkline) ? rest.sparkline.filter(isFiniteNumber) : [];
  const stopLoss = isFiniteNumber(rest.stop_loss_price) ? rest.stop_loss_price : null;
  const plannedTarget = isFiniteNumber(rest.planned_target_price) ? rest.planned_target_price : null;
  const keyLevel = isFiniteNumber(rest.key_level_price) ? rest.key_level_price : null;
  // A stored 0 or 1.5 is kept as it was saved. Its money reads as null rather than a rounded guess (issue #50).
  const quantity = isFiniteNumber(rest.quantity) ? rest.quantity : 1;
  return normalizeTrade({
    ...rest,
    id: item.id,
    symbol: item.symbol,
    direction: item.direction as TradeDirection,
    entry_time: item.entry_time,
    exit_time: item.exit_time,
    entry_price: item.entry_price,
    exit_price: item.exit_price,
    stop_loss_price: stopLoss,
    planned_target_price: plannedTarget,
    key_level_price: keyLevel,
    quantity,
    note: typeof rest.note === "string" ? rest.note : "",
    playbook_id: typeof rest.playbook_id === "string" ? rest.playbook_id : null,
    quick_tags: quickTags,
    checklist_state: sanitizeChecklist(rest.checklist_state),
    pre_trade_thesis: typeof rest.pre_trade_thesis === "string" ? rest.pre_trade_thesis : "",
    management_notes: typeof rest.management_notes === "string" ? rest.management_notes : "",
    post_exit_notes: typeof rest.post_exit_notes === "string" ? rest.post_exit_notes : "",
    flagged: rest.flagged === true,
    take_again: rest.take_again === "yes" || rest.take_again === "smaller" || rest.take_again === "pass" ? rest.take_again : null,
    take_again_at: typeof rest.take_again_at === "string" ? rest.take_again_at : null,
    is_sample: isSample,
    sparkline,
    candle_source: rest.candle_source === "Yahoo Finance" || rest.candle_source === "Demo fixture" ? rest.candle_source : undefined,
  });
}

/** Build a local backup payload of the trade journal and device preferences (no candles, no secrets). */
export function buildBackup(trades: TradeRecord[] = state.trades, prefs?: Prefs): JournalBackup {
  const cleanTrades = trades.map((trade) => {
    const rest: TradeRecord & { candles?: Candle[] } = { ...trade };
    delete rest.candles;
    return normalizeTrade({ ...rest, is_sample: rest.is_sample ?? DEMO_TRADE_IDS.has(trade.id) });
  });
  return {
    app: "mogmine",
    version: 1,
    exportedAt: new Date().toISOString(),
    includesCandles: false,
    trades: cleanTrades,
    ...(prefs ? { prefs } : {}),
  };
}

/** Validate and normalize a backup JSON string before touching the journal. */
export function parseBackupFile(rawText: string): ParseBackupResult {
  if (!rawText || !rawText.trim()) {
    return { ok: false, error: "This file is empty." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Not a valid JSON backup file." };
  }

  let rawTrades: unknown[];
  let rawPrefs: Partial<Prefs> | undefined;
  let exportedAt: string | null = null;

  if (Array.isArray(parsed)) {
    rawTrades = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if ("app" in obj && obj.app !== "mogmine") {
      return { ok: false, error: "This file is not a MogMine journal backup." };
    }
    if (!Array.isArray(obj.trades)) {
      return { ok: false, error: "Backup file is missing a trades list." };
    }
    rawTrades = obj.trades;
    if (obj.prefs && typeof obj.prefs === "object" && !Array.isArray(obj.prefs)) {
      rawPrefs = obj.prefs as Partial<Prefs>;
    }
    if (typeof obj.exportedAt === "string" && Number.isFinite(Date.parse(obj.exportedAt))) {
      exportedAt = obj.exportedAt;
    }
  } else {
    return { ok: false, error: "Not a recognized MogMine backup format." };
  }

  if (rawTrades.length === 0) {
    return { ok: false, error: "This backup file has no trades to restore." };
  }

  const trades: TradeRecord[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < rawTrades.length; i += 1) {
    const trade = parseTradeItem(rawTrades[i]);
    if (!trade) {
      return { ok: false, error: `Trade #${i + 1} in the file is missing required fields (id, symbol, side, times or prices).` };
    }
    if (!seenIds.has(trade.id)) {
      seenIds.add(trade.id);
      trades.push(trade);
    }
  }

  trades.sort(byNewest);
  const sampleCount = trades.filter((t) => t.is_sample).length;
  const realCount = trades.length - sampleCount;

  return { ok: true, trades, prefs: rawPrefs, realCount, sampleCount, exportedAt };
}

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
    // A trader's change to an annotation is theirs, so a later fixture refresh keeps it (issue #62).
    if (annotationKey(next) !== annotationKey(trade)) next.annotations_modified = true;
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
