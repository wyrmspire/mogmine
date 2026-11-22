// CD-2b: local store for drill answers (docs/23 §4.4, OD-46). Shaped like lib/plans-store.ts:
// localStorage key `mogmine-drills-v1`, in-memory cache, useSyncExternalStore, sanitizing, backup.
// Answers are append-only history: every answer is kept (§4), and none is ever written to `take_again`.
// Invariant 7: every record carries `user_id`.
import { useSyncExternalStore } from "react";
import type { DrillAnswer, DrillKind, DrillRecord } from "./drills.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";

export const DRILLS_STORAGE_KEY = "mogmine-drills-v1";

export interface DrillsState {
  hydrated: boolean;
  saved: boolean;
  records: readonly DrillRecord[];
}

const KINDS: readonly DrillKind[] = ["take_it"];
const ANSWERS: readonly DrillAnswer[] = ["take", "smaller", "pass"];
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

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function sanitizeDrillRecord(raw: unknown): DrillRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = text(obj.id);
  const tradeId = text(obj.trade_id);
  const answeredAt = text(obj.answered_at);
  if (!id || !tradeId || !Number.isFinite(Date.parse(answeredAt))) return null;
  if (!KINDS.includes(obj.kind as DrillKind) || !ANSWERS.includes(obj.answer as DrillAnswer)) return null;
  return {
    id,
    user_id: text(obj.user_id) || DEFAULT_OWNER_USER_ID,
    trade_id: tradeId,
    kind: obj.kind as DrillKind,
    answer: obj.answer as DrillAnswer,
    answered_at: new Date(Date.parse(answeredAt)).toISOString(),
    hidden: Array.isArray(obj.hidden) ? obj.hidden.filter((item): item is string => typeof item === "string" && item.length > 0) : [],
  };
}

/** Clean records, one per id (the first wins), oldest first. */
export function sanitizeDrills(raw: unknown): DrillRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: DrillRecord[] = [];
  for (const item of raw) {
    const record = sanitizeDrillRecord(item);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    list.push(record);
  }
  return list.sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at));
}

/** A backup's drills, or null when it has none: an older backup leaves this device's answers alone. */
export function sanitizeDrillsBackup(raw: unknown): DrillRecord[] | null {
  const list = sanitizeDrills(raw);
  return list.length ? list : null;
}

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
}

export function resetDrillsForTests() {
  state = empty();
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
