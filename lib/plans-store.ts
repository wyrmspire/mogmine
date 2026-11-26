// Local storage for planning sessions (PS-1, docs/24 §2, proposal OD-51).
// Structured like lib/playbooks-store.ts and lib/accounts-store.ts:
// localStorage key `mogmine-plans-v1`, in-memory cache, React useSyncExternalStore hook,
// sanitization, validation, and backup export/restore support.
// Invariant 7: every session carries `user_id` (DEFAULT_OWNER_USER_ID).

import { useSyncExternalStore } from "react";
import {
  isAfterTheFact,
  PLAN_LIMITS,
  type PlannedLevel,
  type PlanningSession,
  type PlanRevision,
} from "./plans.ts";
import { trimText, sanitizePlanningSession, sanitizePlans } from "./plans-sanitize.ts";
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";
export { sanitizePlannedLevel, sanitizePlanRevision, sanitizePlanningSession, sanitizePlans, sanitizePlansBackup } from "./plans-sanitize.ts";

export const PLANS_STORAGE_KEY = "mogmine-plans-v1";

export interface PlansState {
  hydrated: boolean;
  saved: boolean;
  plans: readonly PlanningSession[];
}

const empty = (): PlansState => ({ hydrated: false, saved: true, plans: [] });
let state: PlansState = empty();
const serverState: PlansState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<PlansState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PLANS_STORAGE_KEY, JSON.stringify(state.plans));
    if (!state.saved) set({ saved: true });
  } catch {
    if (state.saved) set({ saved: false });
  }
}

// Remote sync (#190 pattern): the device cache above is written first; the list is copied to Supabase in the
// background when NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase. Plans are hard-deleted (deletePolicy "hard").
function applyRemote(next: PlanningSession[]) {
  set({ plans: sanitizePlans(next) });
  persist();
}

function createPlansSync(overrides: Partial<CollectionSyncOptions<PlanningSession>> = {}): CollectionSync {
  return createCollectionSync<PlanningSession>({
    key: "plans",
    getLocal: () => state.plans,
    apply: applyRemote,
    ...overrides,
  });
}

let plansSync: CollectionSync = createPlansSync();

// Cross-tab (docs/26 §8.4 #7): another open tab writes this key. Adopt its copy so this tab never overwrites it.
let storageListener: ((event: StorageEvent) => void) | null = null;

function listenForStorage() {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    if (event.key !== PLANS_STORAGE_KEY || !event.newValue) return;
    try {
      set({ plans: sanitizePlans(JSON.parse(event.newValue)) });
      plansSync.changed();
    } catch { /* malformed: keep this tab's copy */ }
  };
  window.addEventListener("storage", storageListener);
}

function stopListeningForStorage() {
  if (storageListener && typeof window !== "undefined") window.removeEventListener?.("storage", storageListener);
  storageListener = null;
}

export function getPlansBackup(): PlanningSession[] {
  hydratePlans();
  return sanitizePlans(state.plans);
}

export function restorePlans(plans: PlanningSession[] | null | undefined) {
  if (!plans) return;
  hydratePlans();
  replacePlans(plans);
}

export function hydratePlans() {
  if (state.hydrated || typeof window === "undefined") return;
  let plans: PlanningSession[] = [];
  let saved = true;
  try {
    const raw = localStorage.getItem(PLANS_STORAGE_KEY);
    if (raw) {
      plans = sanitizePlans(JSON.parse(raw));
    }
  } catch {
    saved = false;
  }
  set({ plans, hydrated: true, saved });
  listenForStorage();
  plansSync.start();
}

export function getPlansState(): PlansState {
  return state;
}

export function getPlansForSession(sessionDate: string): readonly PlanningSession[] {
  return state.plans.filter((p) => p.session_date === sessionDate && !p.archived);
}

export function getPlan(id: string): PlanningSession | undefined {
  return state.plans.find((p) => p.id === id);
}

export function addPlan(plan: PlanningSession) {
  const sanitized = sanitizePlanningSession(plan);
  if (!sanitized) return;
  const existing = state.plans.filter((p) => p.id !== sanitized.id);
  set({ plans: [...existing, sanitized] });
  persist();
  plansSync.changed();
}

export interface PlanUpdatePayload {
  name?: string;
  observations?: string;
  bias?: "bullish" | "bearish" | "neutral" | null;
  watch_playbook_ids?: readonly string[];
  levels?: readonly PlannedLevel[];
  archived?: boolean;
}

export function updatePlan(id: string, patch: PlanUpdatePayload) {
  const current = state.plans.find((p) => p.id === id);
  if (!current) return;

  const nowIso = new Date().toISOString();
  const afterTheFact = isAfterTheFact(nowIso, current.anchor_time_utc);

  // Snapshot current state into revisions before mutating
  const revision: PlanRevision = {
    id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    saved_at: nowIso,
    after_the_fact: afterTheFact,
    observations: current.observations,
    bias: current.bias,
    watch_playbook_ids: current.watch_playbook_ids,
    levels: current.levels,
  };

  const updated: PlanningSession = {
    ...current,
    name: patch.name !== undefined ? trimText(patch.name, PLAN_LIMITS.name) || current.name : current.name,
    observations: patch.observations !== undefined ? patch.observations.slice(0, PLAN_LIMITS.observations) : current.observations,
    bias: patch.bias !== undefined ? patch.bias : current.bias,
    watch_playbook_ids: patch.watch_playbook_ids !== undefined ? patch.watch_playbook_ids : current.watch_playbook_ids,
    levels: patch.levels !== undefined ? patch.levels : current.levels,
    archived: patch.archived !== undefined ? patch.archived : current.archived,
    updated_at: nowIso,
    revisions: [...current.revisions, revision],
  };

  const plans = state.plans.map((p) => (p.id === id ? updated : p));
  set({ plans });
  persist();
  plansSync.changed();
}

/** PS-4: save the review's lesson. It is not a plan edit, so it adds no revision. Empty text clears it. */
export function setPlanLesson(id: string, lesson: string) {
  const current = state.plans.find((p) => p.id === id);
  if (!current) return;
  const text = lesson.slice(0, PLAN_LIMITS.lesson);
  const { lesson: _previous, ...rest } = current;
  void _previous;
  const updated: PlanningSession = text.trim() ? { ...rest, lesson: text } : rest;
  set({ plans: state.plans.map((p) => (p.id === id ? updated : p)) });
  persist();
  plansSync.changed();
}

export function removePlan(id: string) {
  const plans = state.plans.filter((p) => p.id !== id);
  set({ plans });
  persist();
  plansSync.changed();
}

export function replacePlans(plans: readonly PlanningSession[]) {
  set({ plans: sanitizePlans(plans) });
  persist();
  plansSync.changed();
}

/** Test hook: back to unhydrated and empty, and the default (disabled) syncer. */
export function resetPlansForTests() {
  stopListeningForStorage();
  state = empty();
  plansSync.dispose();
  plansSync = createPlansSync();
}

/** Test hook: swap the plan syncer's adapter, storage or timers. Returns the syncer under test. */
export function configurePlansSyncForTests(overrides: Partial<CollectionSyncOptions<PlanningSession>>): CollectionSync {
  plansSync.dispose();
  plansSync = createPlansSync(overrides);
  return plansSync;
}

export function usePlansStore(): PlansState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => serverState
  );
}
