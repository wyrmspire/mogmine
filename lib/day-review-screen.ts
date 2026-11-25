// Pure helpers for the Days strip and /review/day/[date] actions (DR-2, docs/design-2026-11-24/06 §3, Q-4).
import type { DailyReview } from "./daily-review.ts";
import { stepRegularSessionDate } from "./selectors.ts";
import type { TradeRecord } from "./trades.ts";

export const DAYS_STRIP_LENGTH = 14;

/** The last `count` regular trading days up to `todayDate`, newest first (weekends skipped, matching NAV-1). */
export function recentTradingDays(todayDate: string, count = DAYS_STRIP_LENGTH): string[] {
  const weekday = new Date(`${todayDate}T00:00:00Z`).getUTCDay();
  let day = weekday === 0 || weekday === 6 ? stepRegularSessionDate(todayDate, -1) : todayDate;
  const days: string[] = [];
  for (let index = 0; index < count; index += 1) {
    days.push(day);
    day = stepRegularSessionDate(day, -1);
  }
  return days;
}

/** A day is `done` if any of its reviews (any account scope) is done; `draft` if it has a review; otherwise `none`. */
export function dayStatus(reviews: readonly DailyReview[], date: string): "none" | "draft" | "done" {
  const own = reviews.filter((review) => review.session_date === date);
  if (own.some((review) => review.status === "done")) return "done";
  return own.length > 0 ? "draft" : "none";
}

/**
 * Marks unreviewed linked trades `"reviewed"` via `applyStatus` and returns the count plus an `undo` callback
 * that restores each trade's exact prior `review_status` (`"new"` vs `"tagged"`, Q-4).
 */
export function markLinkedTradesReviewed(
  linkedTrades: readonly Pick<TradeRecord, "id" | "review_status">[],
  applyStatus: (id: string, status: TradeRecord["review_status"]) => void,
): { count: number; undo: () => void } {
  const snapshot = linkedTrades
    .filter((trade) => trade.review_status !== "reviewed")
    .map((trade) => ({ id: trade.id, status: trade.review_status }));
  for (const { id } of snapshot) {
    applyStatus(id, "reviewed");
  }
  return {
    count: snapshot.length,
    undo: () => {
      for (const { id, status } of snapshot) {
        applyStatus(id, status);
      }
    },
  };
}
