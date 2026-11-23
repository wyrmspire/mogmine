// Local storage for trading challenges (R-09b, docs/17 §5).
// Structured like lib/accounts-store.ts and lib/prefs.ts:
// localStorage key `mogmine-challenges-v1`, in-memory cache, React useSyncExternalStore hook,
// sanitization, validation, and backup export/restore support.
// Invariant 7: user_id stamped (DEFAULT_OWNER_USER_ID).

import { useSyncExternalStore } from "react";
import { CHALLENGE_CALC_VERSION } from "./challenges.ts";
import type { ChallengeDefinition, ChallengeResult, ChallengeRules } from "./challenges.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import { isValidTime, sanitizeChallengeRules, sanitizeChallengeResult, sanitizeChallenges } from "./challenge-sanitize.ts";
export { sanitizeChallengeRules, sanitizeChallengeResult, sanitizeChallenge, sanitizeChallenges, sanitizeChallengesBackup } from "./challenge-sanitize.ts";

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
