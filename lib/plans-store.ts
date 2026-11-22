// Local storage for planning sessions (PS-1, docs/24 §2, proposal OD-51).
// Structured like lib/playbooks-store.ts and lib/accounts-store.ts:
// localStorage key `mogmine-plans-v1`, in-memory cache, React useSyncExternalStore hook,
// sanitization, validation, and backup export/restore support.
// Invariant 7: every session carries `user_id` (DEFAULT_OWNER_USER_ID).

import { useSyncExternalStore } from "react";
import {
  isAfterTheFact,
  PLAN_LIMITS,
  PLAN_PRESETS,
  type PlannedLevel,
  type PlannedLevelKind,
  type PlanningSession,
  type PlanPreset,
  type PlanRevision,
} from "./plans.ts";
import { DEFAULT_OWNER_USER_ID, specFor } from "./trades.ts";

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

const trimText = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isValidSessionDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

export function sanitizePlannedLevel(raw: unknown): PlannedLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const label = trimText(obj.label, PLAN_LIMITS.label);
  const priceTicks = typeof obj.price_ticks === "number" && Number.isSafeInteger(obj.price_ticks) ? obj.price_ticks : null;
  const price = typeof obj.price === "number" && Number.isFinite(obj.price) ? obj.price : null;
  if (!id || !label || priceTicks == null || price == null) return null;

  const kind: PlannedLevelKind =
    obj.kind === "zone_low" || obj.kind === "zone_high" ? obj.kind : "level";
  const note = trimText(obj.note, PLAN_LIMITS.note) || undefined;

  return {
    id,
    price_ticks: priceTicks,
    price,
    label,
    kind,
    ...(note ? { note } : {}),
  };
}

export function sanitizePlanRevision(raw: unknown): PlanRevision | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const savedAt = isValidIsoDate(obj.saved_at) ? obj.saved_at : null;
  if (!id || !savedAt) return null;

  const afterTheFact = obj.after_the_fact === true;
  const observations = typeof obj.observations === "string" ? obj.observations.slice(0, PLAN_LIMITS.observations) : "";
  const bias = obj.bias === "bullish" || obj.bias === "bearish" || obj.bias === "neutral" ? obj.bias : null;
  const watchPlaybookIds = Array.isArray(obj.watch_playbook_ids)
    ? obj.watch_playbook_ids.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  const rawLevels = Array.isArray(obj.levels) ? obj.levels : [];
  const levels: PlannedLevel[] = [];
  for (const item of rawLevels) {
    const level = sanitizePlannedLevel(item);
    if (level) levels.push(level);
    if (levels.length >= PLAN_LIMITS.maxLevels) break;
  }

  return {
    id,
    saved_at: savedAt,
    after_the_fact: afterTheFact,
    observations,
    bias,
    watch_playbook_ids: watchPlaybookIds,
    levels,
  };
}

export function sanitizePlanningSession(raw: unknown): PlanningSession | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const sessionDateStr = isValidSessionDate(obj.session_date) ? obj.session_date : null;
  const name = trimText(obj.name, PLAN_LIMITS.name);
  if (!id || !sessionDateStr || !name) return null;

  const userId = typeof obj.user_id === "string" && obj.user_id.trim() ? obj.user_id.trim() : DEFAULT_OWNER_USER_ID;
  const preset: PlanPreset | null = PLAN_PRESETS.some((p) => p.preset === obj.preset)
    ? (obj.preset as PlanPreset)
    : null;
  const anchorTimeUtc = isValidIsoDate(obj.anchor_time_utc) ? obj.anchor_time_utc : null;
  const createdAt = isValidIsoDate(obj.created_at) ? obj.created_at : new Date().toISOString();
  const updatedAt = isValidIsoDate(obj.updated_at) ? obj.updated_at : createdAt;

  const observations = typeof obj.observations === "string" ? obj.observations.slice(0, PLAN_LIMITS.observations) : "";
  const bias = obj.bias === "bullish" || obj.bias === "bearish" || obj.bias === "neutral" ? obj.bias : null;
  const watchPlaybookIds = Array.isArray(obj.watch_playbook_ids)
    ? obj.watch_playbook_ids.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  const rawLevels = Array.isArray(obj.levels) ? obj.levels : [];
  const levels: PlannedLevel[] = [];
  for (const item of rawLevels) {
    const level = sanitizePlannedLevel(item);
    if (level) levels.push(level);
    if (levels.length >= PLAN_LIMITS.maxLevels) break;
  }

  const rawRevisions = Array.isArray(obj.revisions) ? obj.revisions : [];
  const revisions: PlanRevision[] = [];
  for (const item of rawRevisions) {
    const rev = sanitizePlanRevision(item);
    if (rev) revisions.push(rev);
  }

  const symbol = typeof obj.symbol === "string" && specFor(obj.symbol.trim()) ? obj.symbol.trim().toUpperCase() : undefined;

  return {
    id,
    user_id: userId,
    session_date: sessionDateStr,
    ...(symbol ? { symbol } : {}),
    name,
    preset,
    anchor_time_utc: anchorTimeUtc,
    created_at: createdAt,
    updated_at: updatedAt,
    observations,
    bias,
    watch_playbook_ids: watchPlaybookIds,
    levels,
    revisions,
    archived: obj.archived === true,
  };
}

export function sanitizePlans(raw: unknown): PlanningSession[] {
  if (!Array.isArray(raw)) return [];
  const list: PlanningSession[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const plan = sanitizePlanningSession(item);
    if (!plan || seen.has(plan.id)) continue;
    seen.add(plan.id);
    list.push(plan);
  }
  return list;
}

export function sanitizePlansBackup(raw: unknown): PlanningSession[] | null {
  if (!raw) return null;
  const sanitized = sanitizePlans(raw);
  return sanitized.length > 0 ? sanitized : null;
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
}

export function removePlan(id: string) {
  const plans = state.plans.filter((p) => p.id !== id);
  set({ plans });
  persist();
}

export function replacePlans(plans: readonly PlanningSession[]) {
  set({ plans: sanitizePlans(plans) });
  persist();
}

export function resetPlansForTests() {
  state = empty();
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
