// Local device store for daily reviews (docs/06 §2.1, Q-3). Mirrors lib/plans-store.ts:
// localStorage key `mogmine-daily-reviews-v1`, in-memory cache, React useSyncExternalStore hook, backup support.
// Remote sync: `createCollectionSync` ("daily_reviews") copies the list to Supabase in the background (DR-1b, #192 pattern).
// Invariant 7: every review carries `user_id` (DEFAULT_OWNER_USER_ID).

import { useSyncExternalStore } from "react";
import type { DailyReview, DailyReviewStatus, ReviewPoint } from "./daily-review.ts";
import { sanitizeDailyReview, sanitizeDailyReviews, sanitizeDailyReviewsBackup } from "./daily-review-sanitize.ts";
import { createCollectionSync } from "./persistence/store-sync.ts";
import type { CollectionSync, CollectionSyncOptions } from "./persistence/store-sync.ts";

export { sanitizeDailyReview, sanitizeDailyReviews, sanitizeDailyReviewsBackup, sanitizeReviewPoint } from "./daily-review-sanitize.ts";

export const DAILY_REVIEWS_STORAGE_KEY = "mogmine-daily-reviews-v1";

export interface DailyReviewsState {
  hydrated: boolean;
  saved: boolean;
  reviews: readonly DailyReview[];
}

/** Fields a patch may change. Identity and `recorded_at` are never patched (AGENTS §6.5). */
export interface DailyReviewPatch {
  trade_ids?: readonly string[];
  plan_ids?: readonly string[];
  points?: readonly ReviewPoint[];
  lesson?: string;
  status?: DailyReviewStatus;
}

const empty = (): DailyReviewsState => ({ hydrated: false, saved: true, reviews: [] });
let state: DailyReviewsState = empty();
const serverState: DailyReviewsState = empty();
const listeners = new Set<() => void>();

function set(patch: Partial<DailyReviewsState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function persist(): boolean {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(DAILY_REVIEWS_STORAGE_KEY, JSON.stringify(state.reviews));
    if (!state.saved) set({ saved: true });
    return true;
  } catch {
    if (state.saved) set({ saved: false });
    return false;
  }
}

// Remote sync: the device cache is written first; the list is copied to Supabase in the background when
// NEXT_PUBLIC_PERSISTENCE_ADAPTER=supabase. Reviews are hard-deleted (deletePolicy "hard"). Without the migration
// applied, the server answers unavailable and the device keeps working.
function applyRemote(next: DailyReview[]) {
  set({ reviews: sanitizeDailyReviews(next) });
  persist();
}

function createDailyReviewsSync(overrides: Partial<CollectionSyncOptions<DailyReview>> = {}): CollectionSync {
  return createCollectionSync<DailyReview>({
    key: "daily_reviews",
    getLocal: () => state.reviews,
    apply: applyRemote,
    ...overrides,
  });
}

let dailyReviewsSync: CollectionSync = createDailyReviewsSync();

// Cross-tab (docs/26 §8.4 #7): another open tab writes this key. Adopt its copy so this tab never overwrites it.
let storageListener: ((event: StorageEvent) => void) | null = null;

function listenForStorage() {
  if (storageListener || typeof window === "undefined") return;
  storageListener = (event: StorageEvent) => {
    if (event.key !== DAILY_REVIEWS_STORAGE_KEY || !event.newValue) return;
    try {
      set({ reviews: sanitizeDailyReviews(JSON.parse(event.newValue)) });
      dailyReviewsSync.changed();
    } catch { /* malformed: keep this tab's copy */ }
  };
  window.addEventListener("storage", storageListener);
}

function stopListeningForStorage() {
  if (storageListener && typeof window !== "undefined") window.removeEventListener?.("storage", storageListener);
  storageListener = null;
}

export function hydrateDailyReviews() {
  if (state.hydrated || typeof window === "undefined") return;
  let reviews: DailyReview[] = [];
  let saved = true;
  try {
    const raw = localStorage.getItem(DAILY_REVIEWS_STORAGE_KEY);
    if (raw) reviews = sanitizeDailyReviews(JSON.parse(raw));
  } catch {
    saved = false;
  }
  set({ reviews, hydrated: true, saved });
  listenForStorage();
  dailyReviewsSync.start();
}

export function getDailyReviewsState(): DailyReviewsState {
  return state;
}

export function getDailyReviews(): readonly DailyReview[] {
  hydrateDailyReviews();
  return state.reviews;
}

export function getDailyReviewsBackup(): DailyReview[] {
  hydrateDailyReviews();
  return sanitizeDailyReviews(state.reviews);
}

/** Re-attempt the device write without rebuilding the screen or discarding any in-progress form state. */
export async function retryDailyReviews(): Promise<boolean> {
  hydrateDailyReviews();
  if (!persist()) return false;
  await dailyReviewsSync.flushNow();
  return true;
}

/**
 * Create or update the review for this review's (session_date, account_id) scope. Rule 5: a second create for the same
 * scope returns the existing review (its id and recorded_at are kept) with the incoming content applied.
 */
export function upsertDailyReview(review: DailyReview): DailyReview | null {
  hydrateDailyReviews();
  const incoming = sanitizeDailyReview(review);
  if (!incoming) return null;
  const nowIso = new Date().toISOString();
  const existing =
    state.reviews.find((item) => item.session_date === incoming.session_date && (item.account_id ?? null) === incoming.account_id) ??
    state.reviews.find((item) => item.id === incoming.id);

  if (!existing) {
    set({ reviews: [...state.reviews, incoming] });
    persist();
    dailyReviewsSync.changed();
    return incoming;
  }

  const merged: DailyReview = {
    ...incoming,
    id: existing.id,
    session_date: existing.session_date,
    account_id: existing.account_id,
    recorded_at: existing.recorded_at,
    updated_at: nowIso,
  };
  set({ reviews: state.reviews.map((item) => (item === existing ? merged : item)) });
  persist();
  dailyReviewsSync.changed();
  return merged;
}

/** Patch one review. `recorded_at`, `id`, `user_id` and the scope are kept as they were. */
export function updateDailyReview(id: string, patch: DailyReviewPatch): DailyReview | null {
  hydrateDailyReviews();
  const current = state.reviews.find((item) => item.id === id);
  if (!current) return null;
  const next = sanitizeDailyReview({
    ...current,
    ...(patch.trade_ids !== undefined ? { trade_ids: [...patch.trade_ids] } : {}),
    ...(patch.plan_ids !== undefined ? { plan_ids: [...patch.plan_ids] } : {}),
    ...(patch.points !== undefined ? { points: [...patch.points] } : {}),
    ...(patch.lesson !== undefined ? { lesson: patch.lesson } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    updated_at: new Date().toISOString(),
  });
  if (!next) return null;
  const updated: DailyReview = { ...next, id: current.id, recorded_at: current.recorded_at, session_date: current.session_date, account_id: current.account_id, user_id: current.user_id };
  set({ reviews: state.reviews.map((item) => (item.id === id ? updated : item)) });
  persist();
  dailyReviewsSync.changed();
  return updated;
}

export function removeDailyReview(id: string) {
  hydrateDailyReviews();
  set({ reviews: state.reviews.filter((item) => item.id !== id) });
  persist();
  dailyReviewsSync.changed();
}

/**
 * Restore from a backup. An older backup has no `daily_reviews` (null or undefined): nothing changes.
 * Otherwise records merge by (session_date, account_id) and the backup's copy wins; device-only reviews stay.
 */
export function restoreDailyReviews(reviews: readonly DailyReview[] | null | undefined) {
  const incoming = sanitizeDailyReviewsBackup(reviews);
  if (!incoming) return;
  hydrateDailyReviews();
  const incomingScopes = new Set(incoming.map((review) => `${review.session_date}|${review.account_id ?? "*"}`));
  const incomingIds = new Set(incoming.map((review) => review.id));
  const kept = state.reviews.filter((review) => !incomingScopes.has(`${review.session_date}|${review.account_id ?? "*"}`) && !incomingIds.has(review.id));
  set({ reviews: [...kept, ...incoming] });
  persist();
  dailyReviewsSync.changed();
}

/** Test hook: back to unhydrated and empty, and the default (disabled) syncer. */
export function resetDailyReviewsForTests() {
  stopListeningForStorage();
  state = empty();
  dailyReviewsSync.dispose();
  dailyReviewsSync = createDailyReviewsSync();
}

/** Test hook: swap the review syncer's adapter, storage or timers. Returns the syncer under test. */
export function configureDailyReviewsSyncForTests(overrides: Partial<CollectionSyncOptions<DailyReview>>): CollectionSync {
  dailyReviewsSync.dispose();
  dailyReviewsSync = createDailyReviewsSync(overrides);
  return dailyReviewsSync;
}

export function useDailyReviewsStore(): DailyReviewsState {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => state,
    () => serverState
  );
}
