// Local storage for trading challenges (R-09b, docs/17 §5).
// Structured like lib/accounts-store.ts and lib/prefs.ts:
// localStorage key `mogmine-challenges-v1`, in-memory cache, React useSyncExternalStore hook,
// sanitization, validation, and backup export/restore support.
// Invariant 7: user_id stamped (DEFAULT_OWNER_USER_ID).

import { useSyncExternalStore } from "react";
import { CHALLENGE_CALC_VERSION } from "./challenges.ts";
import type { ChallengeDefinition, ChallengeResult, ChallengeRules } from "./challenges.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";

export const CHALLENGES_STORAGE_KEY = "mogmine-challenges-v1";

export interface ChallengesState {
  hydrated: boolean;
  saved: boolean;
  challenges: ChallengeDefinition[];
}

const empty = (): ChallengesState => ({ hydrated: false, saved: true, challenges: [] });
let state: ChallengesState = empty();
const serverState: ChallengesState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<ChallengesState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHALLENGES_STORAGE_KEY, JSON.stringify(state.challenges));
    if (!state.saved) set({ saved: true });
  } catch {
    if (state.saved) set({ saved: false });
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value > 0;
}

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function sanitizeChallengeRules(raw: unknown): ChallengeRules | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "drawdown") {
    if (!isPositiveInteger(obj.sessions) || obj.sessions > 60 || !isPositiveInteger(obj.max_drawdown_cents)) {
      return null;
    }
    return {
      kind: "drawdown",
      sessions: obj.sessions,
      max_drawdown_cents: obj.max_drawdown_cents,
    };
  }
  if (obj.kind === "clean_run") {
    if (!isPositiveInteger(obj.target_trades) || obj.target_trades < 3 || obj.target_trades > 50 || !Array.isArray(obj.playbook_ids)) {
      return null;
    }
    const playbook_ids = obj.playbook_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    return {
      kind: "clean_run",
      target_trades: obj.target_trades,
      playbook_ids,
    };
  }
  return null;
}

export function sanitizeChallengeResult(raw: unknown): ChallengeResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.state !== "active" && obj.state !== "passed" && obj.state !== "failed") return undefined;
  if (typeof obj.provisional !== "boolean") return undefined;
  if (!Array.isArray(obj.issues) || !Array.isArray(obj.points)) return undefined;

  if (obj.decided_by !== null && typeof obj.decided_by !== "string") return undefined;
  if (!isFiniteNumber(obj.excluded_before_start)) return undefined;
  if (!obj.issues.every((issue) => issue && typeof issue.trade_id === "string"
    && ["open", "unpriceable", "ungraded"].includes(issue.reason))) return undefined;
  if (!obj.points.every((point) => point && typeof point.trade_id === "string"
    && isFiniteNumber(point.closed_at) && typeof point.session === "string"
    && (point.read === undefined || ["clean", "broken", "off_plan"].includes(point.read))
    && ["equity_cents", "peak_cents", "drawdown_cents", "run"].every((key) =>
      point[key] === undefined || isFiniteNumber(point[key])))) return undefined;
  if (!["equity_cents", "peak_cents", "drawdown_cents", "max_drawdown_cents",
    "remaining_cents", "sessions_done", "run", "best_run"].every((key) =>
    obj[key] === undefined || isFiniteNumber(obj[key]))) return undefined;
  return structuredClone(obj) as unknown as ChallengeResult;
}

export function sanitizeChallenge(raw: unknown): ChallengeDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) return null;
  const rules = sanitizeChallengeRules(obj.rules);
  if (!rules) return null;
  if (!isValidTime(obj.started_at)) return null;
  const ended_at = obj.ended_at;
  if (ended_at !== null && (!isValidTime(ended_at) || Date.parse(ended_at) < Date.parse(obj.started_at))) return null;
  const calc_version = isFiniteNumber(obj.calc_version) ? obj.calc_version : CHALLENGE_CALC_VERSION;
  const user_id = typeof obj.user_id === "string" && obj.user_id.trim() ? obj.user_id : DEFAULT_OWNER_USER_ID;

  const def: ChallengeDefinition = {
    id: obj.id,
    user_id,
    rules,
    started_at: obj.started_at,
    ended_at,
    calc_version,
  };

  const final = sanitizeChallengeResult(obj.final);
  if (ended_at && final) {
    def.final = final;
  }

  return def;
}

export function sanitizeChallenges(raw: unknown): ChallengeDefinition[] {
  if (!Array.isArray(raw)) return [];
  const list: ChallengeDefinition[] = [];
  const seenIds = new Set<string>();
  const activeKinds = new Set<ChallengeRules["kind"]>();

  for (const item of raw) {
    const def = sanitizeChallenge(item);
    if (!def) continue;
    if (seenIds.has(def.id)) continue;
    if (def.ended_at === null) {
      if (activeKinds.has(def.rules.kind)) continue;
      activeKinds.add(def.rules.kind);
    }
    seenIds.add(def.id);
    list.push(def);
  }

  return list;
}

export function hydrateChallenges() {
  if (state.hydrated || typeof window === "undefined") return;
  let loadedChallenges: ChallengeDefinition[] = [];
  let saved = true;
  try {
    const raw = localStorage.getItem(CHALLENGES_STORAGE_KEY);
    if (raw) {
      loadedChallenges = sanitizeChallenges(JSON.parse(raw));
    }
  } catch {
    saved = false;
  }
  set({ challenges: loadedChallenges, hydrated: true, saved });
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== localStorage || (event.key !== CHALLENGES_STORAGE_KEY && event.key !== null)) return;
    try {
      set({ challenges: event.newValue ? sanitizeChallenges(JSON.parse(event.newValue)) : [], saved: true });
    } catch {
      /* keep ours */
    }
  });
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `chal-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Start a new challenge.
 * Enforces docs/17 §5: at most one active challenge of each kind.
 * If an active challenge of the same kind already exists, the creation is refused.
 */
export function startChallenge(
  rules: ChallengeRules,
  started_at = new Date().toISOString(),
): { ok: true; challenge: ChallengeDefinition } | { ok: false; error: string } {
  hydrateChallenges();
  const frozenRules = sanitizeChallengeRules(rules);
  if (!frozenRules || !isValidTime(started_at)) return { ok: false, error: "Invalid challenge rules or start time." };
  const activeExisting = state.challenges.find(
    (c) => c.ended_at === null && c.rules.kind === rules.kind,
  );
  if (activeExisting) {
    const kindLabel = rules.kind === "drawdown" ? "Drawdown Defender" : "Clean Run";
    return { ok: false, error: `An active ${kindLabel} challenge is already running.` };
  }

  const challenge: ChallengeDefinition = {
    id: newId(),
    user_id: DEFAULT_OWNER_USER_ID,
    rules: frozenRules,
    started_at,
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };

  set({ challenges: [challenge, ...state.challenges] });
  persist();
  return { ok: true, challenge };
}

/**
 * End an active challenge (trader ended it, or it passed/failed).
 * Saves the final ChallengeResult so later trade edits cannot rewrite history (docs/17 §5).
 */
export function endChallenge(
  id: string,
  final?: ChallengeResult,
  ended_at = new Date().toISOString(),
) {
  hydrateChallenges();
  const challenge = state.challenges.find((item) => item.id === id);
  if (!challenge || challenge.ended_at !== null || !isValidTime(ended_at)
    || Date.parse(ended_at) < Date.parse(challenge.started_at)) return;
  const frozenFinal = sanitizeChallengeResult(final);
  if (final && !frozenFinal) return;
  const ended = { ...challenge, ended_at, ...(frozenFinal ? { final: frozenFinal } : {}) };
  set({ challenges: state.challenges.map((item) => item === challenge ? ended : item) });
  persist();
}

/**
 * Test hook: reset in-memory state.
 */
export function resetChallengesForTests() {
  state = empty();
}

/**
 * Test hook / selector helper.
 */
export function getChallengesState(): ChallengesState {
  return state;
}

export function getChallengesBackup(): ChallengeDefinition[] {
  hydrateChallenges();
  return state.challenges;
}

/**
 * Validate challenge list from backup file.
 */
export function sanitizeChallengesBackup(raw: unknown): ChallengeDefinition[] | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) return null;
  return sanitizeChallenges(raw);
}

/**
 * Restore challenges from a backup file.
 */
export function restoreChallenges(challenges: ChallengeDefinition[] = []) {
  hydrateChallenges();
  set({ challenges: sanitizeChallenges(challenges) });
  persist();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useChallenges() {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}
