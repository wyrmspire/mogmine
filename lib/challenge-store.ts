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
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";
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

// Remote sync (#191): with NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase, challenges are copied to Supabase in the background.
// The device copy is always written first. Records carry `user_id` (DEFAULT_OWNER_USER_ID); the adapter rewrites it.
function applyChallenges(next: ChallengeDefinition[]) {
  set({ challenges: sanitizeChallenges(next) });
  persist();
}

function createChallengeSync(overrides: Partial<CollectionSyncOptions<ChallengeDefinition>> = {}): CollectionSync {
  return createCollectionSync<ChallengeDefinition>({ key: "challenges", getLocal: () => state.challenges, apply: applyChallenges, ...overrides });
}

let challengeSync: CollectionSync = createChallengeSync();

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
      challengeSync.changed();
    } catch {
      /* keep ours */
    }
  });
  challengeSync.start();
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
  challengeSync.changed();
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
  challengeSync.changed();
}

/**
 * Test hook: reset in-memory state. The syncer is disposed and replaced by a disabled-by-default one.
 */
export function resetChallengesForTests() {
  challengeSync.dispose();
  challengeSync = createChallengeSync();
  state = empty();
}

/**
 * Test hook: swap the syncer's adapter, storage or timers. Returns the syncer under test.
 */
export function configureChallengesSyncForTests(overrides: Partial<CollectionSyncOptions<ChallengeDefinition>>): CollectionSync {
  challengeSync.dispose();
  challengeSync = createChallengeSync(overrides);
  return challengeSync;
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
  challengeSync.changed();
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
