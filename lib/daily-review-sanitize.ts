// Pure daily-review sanitizers (no React, no window). Kept apart from lib/daily-review-store.ts so server routes can import them (#185a pattern).
import { DAILY_REVIEW_LIMITS } from "./daily-review.ts";
import type { DailyReview, DailyReviewStatus, ReviewPoint, ReviewPointKind } from "./daily-review.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";

const POINT_KINDS: readonly ReviewPointKind[] = ["went_well", "mistake", "observation", "next_time"];

function isValidIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

/** YYYY-MM-DD that is a real calendar date (rejects 2026-02-30). */
export function isValidSessionDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const id = nonEmptyString(item);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** A point with no text is dropped. Text longer than the limit is cut, not rejected, so an old file still loads. */
export function sanitizeReviewPoint(raw: unknown): ReviewPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = nonEmptyString(obj.id);
  const kind = POINT_KINDS.find((candidate) => candidate === obj.kind);
  if (!id || !kind || typeof obj.text !== "string") return null;
  const text = obj.text.slice(0, DAILY_REVIEW_LIMITS.pointText);
  if (!text.trim()) return null;
  return { id, kind, text, trade_id: nonEmptyString(obj.trade_id) };
}

/** Returns null when the record cannot be trusted: bad id, session date, scope or recorded_at. */
export function sanitizeDailyReview(raw: unknown): DailyReview | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = nonEmptyString(obj.id);
  if (!id || !isValidSessionDate(obj.session_date) || !isValidIsoTime(obj.recorded_at)) return null;
  const points = Array.isArray(obj.points)
    ? obj.points.flatMap((point) => {
        const clean = sanitizeReviewPoint(point);
        return clean ? [clean] : [];
      })
    : [];
  const status: DailyReviewStatus = obj.status === "done" ? "done" : "draft";
  const review: DailyReview = {
    id,
    user_id: nonEmptyString(obj.user_id) ?? DEFAULT_OWNER_USER_ID,
    session_date: obj.session_date,
    account_id: nonEmptyString(obj.account_id),
    trade_ids: uniqueStrings(obj.trade_ids),
    plan_ids: uniqueStrings(obj.plan_ids),
    points,
    lesson: typeof obj.lesson === "string" ? obj.lesson.slice(0, DAILY_REVIEW_LIMITS.lesson) : "",
    status,
    recorded_at: obj.recorded_at,
    ...(isValidIsoTime(obj.updated_at) ? { updated_at: obj.updated_at } : {}),
  };
  return review;
}

/** Drops invalid records. Duplicates on (session_date, account_id) or on id: the first one wins. */
export function sanitizeDailyReviews(raw: unknown): DailyReview[] {
  if (!Array.isArray(raw)) return [];
  const list: DailyReview[] = [];
  const scopes = new Set<string>();
  const ids = new Set<string>();
  for (const item of raw) {
    const review = sanitizeDailyReview(item);
    if (!review) continue;
    const scope = `${review.session_date}|${review.account_id ?? "*"}`;
    if (scopes.has(scope) || ids.has(review.id)) continue;
    scopes.add(scope);
    ids.add(review.id);
    list.push(review);
  }
  return list;
}

/** An empty or unusable list reads as "no reviews in this backup", so the device's reviews stay. */
export function sanitizeDailyReviewsBackup(raw: unknown): DailyReview[] | null {
  if (!raw) return null;
  const sanitized = sanitizeDailyReviews(raw);
  return sanitized.length > 0 ? sanitized : null;
}
