// DC-2: local store for discretionary calls and prompt dismissals (docs/25 §7–8, playbook-design/04 §1.4).
// Shaped like lib/drills-store.ts: localStorage key `mogmine-calls-v1`, in-memory cache,
// useSyncExternalStore, sanitizing, backup. Invariant 7: every record carries `user_id`.
// after_the_fact and grades are derived, never stored (docs/25 §7). No UI yet: DC-3 waits for OD-52.
import { useSyncExternalStore } from "react";
import { CALL_ORIGINS, DEVIATION_KINDS, REASON_FAMILIES, REASON_LABEL_MAX, callKindSpec } from "./calls.ts";
import type { CallKind, CallOrigin, CallRule, CallTrigger, DeviationKind, DiscretionCall, FrozenReason, PromptDismissal, ReasonFamily } from "./calls.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import type { TradeDirection } from "./trades.ts";

export const CALLS_STORAGE_KEY = "mogmine-calls-v1";

export interface CallsBackup {
  calls: DiscretionCall[];
  dismissals: PromptDismissal[];
}

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

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const idOrNull = (value: unknown) => text(value) || null;
const iso = (value: unknown) => {
  const time = Date.parse(text(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function sanitizeReason(raw: unknown): FrozenReason | null {
  const obj = record(raw);
  const id = text(obj?.id);
  const label = text(obj?.label);
  if (!obj || !id || !label || label.length > REASON_LABEL_MAX) return null;
  return { id, label, family: REASON_FAMILIES.includes(obj.family as ReasonFamily) ? (obj.family as ReasonFamily) : "other" };
}

function sanitizeTrigger(raw: unknown): CallTrigger | null {
  const obj = record(raw);
  if (!obj || !DEVIATION_KINDS.includes(obj.deviation as DeviationKind)) return null;
  const basis = obj.basis === "broker" || obj.basis === "recorded" || obj.basis === "inferred" ? obj.basis : "recorded";
  return { deviation: obj.deviation as DeviationKind, basis };
}

function sanitizeRule(raw: unknown): CallRule | null {
  const obj = record(raw);
  const id = text(obj?.id);
  const label = text(obj?.label);
  if (!obj || !id || !label || (obj.verdict !== "applied" && obj.verdict !== "not_applied")) return null;
  return { id, label, verdict: obj.verdict };
}

/**
 * A stored call, cleaned. Structural checks only: a reason chip the library no longer offers stays,
 * because calls freeze their reasons (DC-1b). Null when the record cannot be read at all.
 */
export function sanitizeCall(raw: unknown): DiscretionCall | null {
  const obj = record(raw);
  if (!obj) return null;
  const id = text(obj.id);
  const spec = callKindSpec(text(obj.kind));
  const made = iso(obj.made_at);
  const recorded = iso(obj.recorded_at);
  if (!id || !spec || !made || !recorded) return null;
  const tradeId = idOrNull(obj.trade_id);
  // The kind's trade rule is structural: a Skip with a trade or a Cut without one is not a call of that kind.
  if ((spec.trade === "required" && !tradeId) || (spec.trade === "forbidden" && tradeId)) return null;
  const price = typeof obj.price === "number" && Number.isFinite(obj.price) ? obj.price : null;
  const ticks = typeof obj.price_ticks === "number" && Number.isInteger(obj.price_ticks) ? obj.price_ticks : null;
  const direction = obj.signal_direction === "LONG" || obj.signal_direction === "SHORT" ? (obj.signal_direction as TradeDirection) : null;
  if (spec.kind === "flip" && !direction) return null;
  const seen = new Set<string>();
  const reasons = (Array.isArray(obj.reasons) ? obj.reasons : []).flatMap((item) => {
    const reason = sanitizeReason(item);
    if (!reason || seen.has(reason.id)) return [];
    seen.add(reason.id);
    return [reason];
  });
  return {
    id,
    user_id: text(obj.user_id) || DEFAULT_OWNER_USER_ID,
    kind: spec.kind as CallKind,
    made_at: made,
    recorded_at: recorded,
    trade_id: tradeId,
    plan_session_id: idOrNull(obj.plan_session_id),
    playbook_id: idOrNull(obj.playbook_id),
    // Price and ticks go together, or neither is kept.
    price: price != null && ticks != null ? price : null,
    price_ticks: price != null && ticks != null ? ticks : null,
    signal_direction: direction,
    reasons,
    note: typeof obj.note === "string" ? obj.note : "",
    conviction: obj.conviction === 1 || obj.conviction === 2 || obj.conviction === 3 ? obj.conviction : null,
    prompt_id: idOrNull(obj.prompt_id),
    prompt_question: typeof obj.prompt_question === "string" ? obj.prompt_question : spec.prompt,
    origin: CALL_ORIGINS.includes(obj.origin as CallOrigin) ? (obj.origin as CallOrigin) : "manual",
    trigger: sanitizeTrigger(obj.trigger),
    rule: sanitizeRule(obj.rule),
    made_at_basis: obj.made_at_basis === "bound" ? "bound" : "exact",
  };
}

export function sanitizeDismissal(raw: unknown): PromptDismissal | null {
  const obj = record(raw);
  if (!obj) return null;
  const id = text(obj.id);
  const tradeId = text(obj.trade_id);
  const promptId = text(obj.prompt_id);
  const recorded = iso(obj.recorded_at);
  if (!id || !tradeId || !promptId || !recorded || (obj.reason !== "not_a_call" && obj.reason !== "later")) return null;
  return {
    id,
    user_id: text(obj.user_id) || DEFAULT_OWNER_USER_ID,
    trade_id: tradeId,
    prompt_id: promptId,
    deviation: DEVIATION_KINDS.includes(obj.deviation as DeviationKind) ? (obj.deviation as DeviationKind) : null,
    reason: obj.reason,
    recorded_at: recorded,
  };
}

/** Clean, one per id (the first wins), oldest decision first. */
function cleanList<T extends { id: string }>(raw: unknown, sanitize: (item: unknown) => T | null, time: (item: T) => string): T[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: T[] = [];
  for (const item of raw) {
    const clean = sanitize(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    list.push(clean);
  }
  return list.sort((a, b) => Date.parse(time(a)) - Date.parse(time(b)));
}

export function sanitizeCalls(raw: unknown): CallsBackup {
  const obj = record(raw);
  return {
    calls: cleanList(obj?.calls, sanitizeCall, (call) => call.made_at),
    dismissals: cleanList(obj?.dismissals, sanitizeDismissal, (item) => item.recorded_at),
  };
}

/** A backup's calls, or null when it has none: an older backup leaves this device's calls alone. */
export function sanitizeCallsBackup(raw: unknown): CallsBackup | null {
  const clean = sanitizeCalls(raw);
  return clean.calls.length || clean.dismissals.length ? clean : null;
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
