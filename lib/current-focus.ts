import type { DailyReview } from "./daily-review.ts";
import { getPrefs, setPrefs } from "./prefs.ts";
import type { CurrentFocusPreference, Prefs } from "./prefs-sanitize.ts";

export const CURRENT_FOCUS_STORAGE_KEY = "mogmine-current-focus-v1";

export interface CurrentFocusCandidate {
  text: string;
  sessionDate: string;
  source: "daily-review";
  sourceReviewId: string;
  sourceAccountId: string | null;
}

export interface PinnedCurrentFocus extends CurrentFocusCandidate {
  pinnedAt: string;
}

/** A lesson is only a candidate. It becomes current only after the trader pins it in the UI. */
const scopeKey = (accountId: string | null) => accountId ?? "*";

export function currentFocusCandidate(reviews: readonly DailyReview[], sessionDate: string, accountId: string | null): CurrentFocusCandidate | null {
  const review = [...reviews]
    .filter((item) => item.session_date <= sessionDate && item.lesson.trim() && (item.account_id == null || item.account_id === accountId))
    .sort((a, b) => Date.parse(b.updated_at ?? b.recorded_at) - Date.parse(a.updated_at ?? a.recorded_at))[0];
  const text = review?.lesson.trim().slice(0, 500);
  return review && text ? {
    text,
    sessionDate: review.session_date,
    source: "daily-review",
    sourceReviewId: review.id,
    sourceAccountId: review.account_id,
  } : null;
}

function fromPreference(value: CurrentFocusPreference | undefined): PinnedCurrentFocus | null {
  if (!value?.text.trim()) return null;
  return { ...value, text: value.text.trim().slice(0, 500), source: "daily-review" };
}

export function readPinnedCurrentFocus(accountId: string | null, prefs: Prefs = getPrefs()): PinnedCurrentFocus | null {
  const synced = fromPreference(prefs.currentFocusByAccount?.[scopeKey(accountId)]);
  return synced ?? readLegacyFocus(accountId);
}

/** The pre-sync device value. It belongs to one scope only: its account, or All accounts when it names none. */
function readLegacyFocus(accountId: string | null): PinnedCurrentFocus | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(CURRENT_FOCUS_STORAGE_KEY) ?? "null") as Partial<PinnedCurrentFocus> | null;
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim() || typeof parsed.sessionDate !== "string") return null;
    const sourceAccountId = typeof parsed.sourceAccountId === "string" ? parsed.sourceAccountId : null;
    if (sourceAccountId !== accountId) return null;
    return {
      text: parsed.text.trim().slice(0, 500),
      sessionDate: parsed.sessionDate,
      source: "daily-review",
      sourceReviewId: typeof parsed.sourceReviewId === "string" ? parsed.sourceReviewId : "legacy-local-focus",
      sourceAccountId,
      pinnedAt: typeof parsed.pinnedAt === "string" ? parsed.pinnedAt : "",
    };
  } catch {
    return null;
  }
}

export function pinCurrentFocus(candidate: CurrentFocusCandidate, accountId: string | null): PinnedCurrentFocus {
  const pinned = { ...candidate, pinnedAt: new Date().toISOString() };
  const current = getPrefs().currentFocusByAccount ?? {};
  setPrefs({ currentFocusByAccount: { ...current, [scopeKey(accountId)]: pinned } });
  removeLegacyFocus(accountId);
  return pinned;
}

export function clearCurrentFocus(accountId: string | null): void {
  const current = { ...(getPrefs().currentFocusByAccount ?? {}) };
  delete current[scopeKey(accountId)];
  setPrefs({ currentFocusByAccount: current });
  removeLegacyFocus(accountId);
}

function removeLegacyFocus(accountId: string | null): void {
  if (!readLegacyFocus(accountId)) return;
  try { localStorage.removeItem(CURRENT_FOCUS_STORAGE_KEY); } catch { /* legacy cleanup is best effort */ }
}
