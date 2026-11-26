// Daily review record (docs/design-2026-11-24/06 §2, rules 1–6; Q-3 and Q-4 in 92).
// Pure: no DOM, no React, no storage. One review per (session_date, account_id); account_id null = whole day.
// Totals are never stored: they are computed from the linked trades with buildDayCardData (rule 2).
import type { DayCardData } from "./day-card.ts";
import { buildDayCardData } from "./day-card.ts";
import type { PlanningSession } from "./plans.ts";
import { sessionDate } from "./session.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import type { RSizeOptions, TradeRecord } from "./trades.ts";

export type ReviewPointKind = "went_well" | "mistake" | "observation" | "next_time";
export type DailyReviewStatus = "draft" | "done";

export interface ReviewPoint {
  id: string;
  kind: ReviewPointKind;
  /** <= 500 characters. Commentary only (HR-1). */
  text: string;
  /** A point may be about one linked trade. */
  trade_id: string | null;
}

export interface DailyReview {
  /** e.g. "review-2026-11-23" or "review-2026-11-23-<account_id>" */
  id: string;
  /** Invariant 7: DEFAULT_OWNER_USER_ID on this device. */
  user_id: string;
  /** YYYY-MM-DD, the trading day (17:00 CT rollover, `sessionDate`). */
  session_date: string;
  /** null = every account that day. */
  account_id: string | null;
  /** Explicit trade links, in display order. The trader confirms them. */
  trade_ids: string[];
  /** Planning sessions of that day, if any (OD-51). */
  plan_ids: string[];
  points: ReviewPoint[];
  /** The one lesson for tomorrow. <= 500 characters. */
  lesson: string;
  /** "done" never changes any trade's review_status (Q-4). */
  status: DailyReviewStatus;
  /** Wall-clock ISO time when first written (AGENTS §6.5). Never overwritten. */
  recorded_at: string;
  updated_at?: string;
}

export const DAILY_REVIEW_LIMITS = { pointText: 500, lesson: 500 } as const;

export function dailyReviewId(sessionDateStr: string, accountId: string | null): string {
  return accountId ? `review-${sessionDateStr}-${accountId}` : `review-${sessionDateStr}`;
}

export function dailyReviewScopeKey(sessionDateStr: string, accountId: string | null): string {
  return `${sessionDateStr}|${accountId ?? "*"}`;
}

/** Trades on this session date (and account, when set), in chronological order. Rule 1. */
function scopedTrades(trades: readonly TradeRecord[], sessionDateStr: string, accountId: string | null, includeSamples: boolean): TradeRecord[] {
  return trades
    .filter((trade) => {
      if (!includeSamples && trade.is_sample) return false;
      if (accountId != null && trade.account_id !== accountId) return false;
      return sessionDate(trade.entry_time) === sessionDateStr;
    })
    .sort((a, b) => Date.parse(a.entry_time) - Date.parse(b.entry_time) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Rule 1: the trades proposed for a new review of this (date, account) scope. */
export function proposeTradeIds(
  trades: readonly TradeRecord[],
  sessionDateStr: string,
  accountId: string | null,
  opts?: { includeSamples?: boolean },
): string[] {
  return scopedTrades(trades, sessionDateStr, accountId, opts?.includeSamples === true).map((trade) => trade.id);
}

/** Rule 1: trades on the review's day that are not linked yet ("1 new trade for this day: add it?"). */
export function unlinkedDayTradeIds(
  review: Pick<DailyReview, "session_date" | "account_id" | "trade_ids">,
  trades: readonly TradeRecord[],
  opts?: { includeSamples?: boolean },
): string[] {
  const linked = new Set(review.trade_ids);
  return proposeTradeIds(trades, review.session_date, review.account_id, opts).filter((id) => !linked.has(id));
}

/** Planning sessions of that day that are not archived, oldest first (OD-51). */
export function proposePlanIds(plans: readonly PlanningSession[], sessionDateStr: string): string[] {
  return plans
    .filter((plan) => plan.session_date === sessionDateStr && !plan.archived)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((plan) => plan.id);
}

/** Uniqueness (rule 5): the existing review for this (date, account) scope, if any. */
export function findExistingDailyReview(
  reviews: readonly DailyReview[],
  sessionDateStr: string,
  accountId: string | null,
): DailyReview | undefined {
  return reviews.find((review) => review.session_date === sessionDateStr && (review.account_id ?? null) === accountId);
}

/**
 * Rule 2 and 6: totals computed from the linked trades via buildDayCardData.
 * Sample trades are dropped before the call, so they never count toward totals.
 */
export function dailyReviewTotals(
  review: Pick<DailyReview, "session_date" | "trade_ids">,
  trades: readonly TradeRecord[],
  shield: boolean,
  opts?: RSizeOptions,
): DayCardData {
  const byId = new Map(trades.map((trade) => [trade.id, trade] as const));
  const realLinkedTrades: TradeRecord[] = [];
  for (const id of review.trade_ids) {
    const trade = byId.get(id);
    if (trade && !trade.is_sample) realLinkedTrades.push(trade);
  }
  return buildDayCardData(review.session_date, realLinkedTrades, shield, opts);
}

export function makeDailyReview(input: {
  id?: string;
  user_id?: string;
  session_date: string;
  account_id?: string | null;
  trade_ids?: string[];
  plan_ids?: string[];
  points?: ReviewPoint[];
  lesson?: string;
  status?: DailyReviewStatus;
  recorded_at: string;
}): DailyReview {
  const accountId = input.account_id ?? null;
  return {
    id: input.id ?? dailyReviewId(input.session_date, accountId),
    user_id: input.user_id ?? DEFAULT_OWNER_USER_ID,
    session_date: input.session_date,
    account_id: accountId,
    trade_ids: [...(input.trade_ids ?? [])],
    plan_ids: [...(input.plan_ids ?? [])],
    points: [...(input.points ?? [])],
    lesson: input.lesson ?? "",
    status: input.status ?? "draft",
    recorded_at: input.recorded_at,
  };
}
