// DC-2: local store for discretionary calls and prompt dismissals (docs/25 §7–8, playbook-design/04 §1.4).
// Shaped like lib/drills-store.ts: localStorage key `mogmine-calls-v1`, in-memory cache,
// useSyncExternalStore, sanitizing, backup. Invariant 7: every record carries `user_id`.
// after_the_fact and grades are derived, never stored (docs/25 §7). No UI yet: DC-3 waits for OD-52.
import { useSyncExternalStore } from "react";
import type { DiscretionCall, PromptDismissal } from "./calls.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import { sanitizeCall, sanitizeDismissal, cleanList, sanitizeCalls } from "./calls-sanitize.ts";
import type { CallsBackup } from "./calls-sanitize.ts";
export { sanitizeCall, sanitizeDismissal, sanitizeCalls, sanitizeCallsBackup } from "./calls-sanitize.ts";
export type { CallsBackup } from "./calls-sanitize.ts";

export const CALLS_STORAGE_KEY = "mogmine-calls-v1";

export interface CallsState extends CallsBackup {
  hydrated: boolean;
  /** False when the last write to device storage failed. The session still works. */
  saved: boolean;
}

const empty = (): CallsState => ({ hydrated: false, saved: true, calls: [], dismissals: [] });
let state: CallsState = empty();
const serverState: CallsState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<CallsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CALLS_STORAGE_KEY, JSON.stringify({ calls: state.calls, dismissals: state.dismissals }));
    if (!state.saved) set({ saved: true });
  } catch {
    if (state.saved) set({ saved: false });
  }
}

export function hydrateCalls() {
  if (state.hydrated || typeof window === "undefined") return;
  let stored: CallsBackup = { calls: [], dismissals: [] };
  let saved = true;
  try {
    const raw = localStorage.getItem(CALLS_STORAGE_KEY);
    if (raw) stored = sanitizeCalls(JSON.parse(raw));
  } catch {
    saved = false;
  }
  set({ ...stored, hydrated: true, saved });
}

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type CallDraft = Omit<DiscretionCall, "id" | "user_id" | "recorded_at"> & { recorded_at?: string };

/** Save a new call. Returns the stored record, or null when the draft cannot be read as a call. */
export function addCall(draft: CallDraft): DiscretionCall | null {
  hydrateCalls();
  const call = sanitizeCall({ ...draft, id: newId("call"), user_id: DEFAULT_OWNER_USER_ID, recorded_at: draft.recorded_at ?? new Date().toISOString() });
  if (!call) return null;
  set({ calls: cleanList([...state.calls, call], sanitizeCall, (item) => item.made_at) });
  persist();
  return call;
}

/**
 * Edit a saved call. The id, owner and first recorded time never change, so an edit made that evening
 * does not hide that the call was first written down late (docs/25 §1). Null when there is no such call.
 */
export function updateCall(id: string, patch: Partial<Omit<DiscretionCall, "id" | "user_id" | "recorded_at">>): DiscretionCall | null {
  hydrateCalls();
  const current = state.calls.find((call) => call.id === id);
  if (!current) return null;
  const next = sanitizeCall({ ...current, ...patch, id: current.id, user_id: current.user_id, recorded_at: current.recorded_at });
  if (!next) return null;
  set({ calls: state.calls.map((call) => (call.id === id ? next : call)) });
  persist();
  return next;
}

/** Remove a call written by mistake. Gone from this device; an older backup restore can bring it back. */
export function removeCall(id: string) {
  hydrateCalls();
  if (!state.calls.some((call) => call.id === id)) return false;
  set({ calls: state.calls.filter((call) => call.id !== id) });
  persist();
  return true;
}

export function addDismissal(input: Omit<PromptDismissal, "id" | "user_id" | "recorded_at"> & { recorded_at?: string }): PromptDismissal | null {
  hydrateCalls();
  const dismissal = sanitizeDismissal({ ...input, id: newId("dismiss"), user_id: DEFAULT_OWNER_USER_ID, recorded_at: input.recorded_at ?? new Date().toISOString() });
  if (!dismissal) return null;
  set({ dismissals: [...state.dismissals, dismissal] });
  persist();
  return dismissal;
}

export function getCallsBackup(): CallsBackup {
  hydrateCalls();
  return { calls: state.calls.map((call) => ({ ...call })), dismissals: state.dismissals.map((item) => ({ ...item })) };
}

/** Restore merges by id and this device's copy wins, so an older backup never undoes a newer edit. */
export function restoreCalls(backup: CallsBackup | null | undefined) {
  if (!backup) return;
  hydrateCalls();
  set({
    calls: cleanList([...state.calls, ...backup.calls], sanitizeCall, (call) => call.made_at),
    dismissals: cleanList([...state.dismissals, ...backup.dismissals], sanitizeDismissal, (item) => item.recorded_at),
  });
  persist();
}

export function resetCallsForTests() {
  state = empty();
}

export function getCallsState(): CallsState {
  return state;
}

export function useCalls(): CallsState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => serverState,
  );
}
