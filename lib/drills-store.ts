// CD-2b: local store for drill answers (docs/23 §4.4, OD-46). Shaped like lib/plans-store.ts:
// localStorage key `mogmine-drills-v1`, in-memory cache, useSyncExternalStore, sanitizing, backup.
// Answers are append-only history: every answer is kept (§4), and none is ever written to `take_again`.
// Invariant 7: every record carries `user_id`.
import { useSyncExternalStore } from "react";
import type { DrillAnswer, DrillKind, DrillRecord } from "./drills.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import { sanitizeDrillRecord, sanitizeDrills } from "./drills-sanitize.ts";
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";
export { sanitizeDrillRecord, sanitizeDrills, sanitizeDrillsBackup } from "./drills-sanitize.ts";

export const DRILLS_STORAGE_KEY = "mogmine-drills-v1";

export interface DrillsState {
  hydrated: boolean;
  saved: boolean;
  records: readonly DrillRecord[];
}

const empty = (): DrillsState => ({ hydrated: false, saved: true, records: [] });
let state: DrillsState = empty();
const serverState: DrillsState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<DrillsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRILLS_STORAGE_KEY, JSON.stringify(state.records));
    if (!state.saved) set({ saved: true });
  } catch {
    if (state.saved) set({ saved: false });
  }
}

// Remote sync (#190 pattern): the device cache above is written first; answers are copied to Supabase in the
// background when NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase. Answers are append-only, so nothing is removed.
function applyRemote(next: DrillRecord[]) {
  set({ records: sanitizeDrills(next) });
  persist();
}

function createDrillsSync(overrides: Partial<CollectionSyncOptions<DrillRecord>> = {}): CollectionSync {
  return createCollectionSync<DrillRecord>({
    key: "drills",
    getLocal: () => state.records,
    apply: applyRemote,
    ...overrides,
  });
}

let drillsSync: CollectionSync = createDrillsSync();

export function hydrateDrills() {
  if (state.hydrated || typeof window === "undefined") return;
  let records: DrillRecord[] = [];
  let saved = true;
  try {
    const raw = localStorage.getItem(DRILLS_STORAGE_KEY);
    if (raw) records = sanitizeDrills(JSON.parse(raw));
  } catch {
    saved = false;
  }
  set({ records, hydrated: true, saved });
  drillsSync.start();
}

/** Record one answer. Returns the saved record, or null when the input is not a valid answer. */
export function addDrillAnswer(input: { trade_id: string; kind: DrillKind; answer: DrillAnswer; hidden: readonly string[]; answered_at?: string }): DrillRecord | null {
  hydrateDrills();
  const record = sanitizeDrillRecord({
    ...input,
    id: `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    user_id: DEFAULT_OWNER_USER_ID,
    answered_at: input.answered_at ?? new Date().toISOString(),
  });
  if (!record) return null;
  set({ records: [...state.records, record] });
  persist();
  drillsSync.changed();
  return record;
}

export function getDrillsBackup(): DrillRecord[] {
  hydrateDrills();
  return sanitizeDrills(state.records);
}

/** Restore merges by id, so an older backup never erases answers given since it was made. */
export function restoreDrills(records: readonly DrillRecord[] | null | undefined) {
  if (!records) return;
  hydrateDrills();
  set({ records: sanitizeDrills([...state.records, ...records]) });
  persist();
  drillsSync.changed();
}

/** Test hook: back to unhydrated and empty, and the default (disabled) syncer. */
export function resetDrillsForTests() {
  state = empty();
  drillsSync.dispose();
  drillsSync = createDrillsSync();
}

/** Test hook: swap the drill syncer's adapter, storage or timers. Returns the syncer under test. */
export function configureDrillsSyncForTests(overrides: Partial<CollectionSyncOptions<DrillRecord>>): CollectionSync {
  drillsSync.dispose();
  drillsSync = createDrillsSync(overrides);
  return drillsSync;
}

export function getDrillsState(): DrillsState {
  return state;
}

export function useDrills(): DrillsState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => serverState,
  );
}
