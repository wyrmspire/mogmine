// Canonical, pure session summary (RM-C2/RM-C5).
// This module deliberately contains no storage, API, or UI concerns.

import { isReplayTrade } from "./selectors.ts";
import type { TradingAccount } from "./accounts.ts";
import type { PlanningSession } from "./plans.ts";
import type { DailyReview } from "./daily-review.ts";
import type { TradeRecord } from "./trades.ts";

export type SessionPlanState = "planned" | "unplanned";
export type SessionReviewState = "not-started" | "draft" | "done";

export interface SessionSummaryInput {
  sessionDate: string;
  plans: readonly Pick<PlanningSession, "session_date" | "archived">[];
  trades: readonly Pick<TradeRecord, "account_id" | "is_sample" | "review_status">[];
  accounts?: readonly Pick<TradingAccount, "id" | "mode">[];
  review?: Pick<DailyReview, "session_date" | "status"> | null;
  /** Rules followed and the process denominator (seven when not given). Null or omitted: not assessed. */
  process?: { followed: number; total?: number } | null;
  /** Truth exceptions supplied by the data-quality/read-model layer. */
  dataConfidence?: {
    unresolvedFillTimes?: number;
    /** Null: the archive status could not be checked. */
    missingArchiveSessions?: number | null;
    /** Trades with no bars to check fill times against. Null: not checked yet. */
    unverifiedFillTimes?: number | null;
  };
}

export interface SessionCounts {
  real: number;
  replay: number;
}

export interface ProcessSummary {
  followed: number;
  total: number;
}

export interface DataConfidenceFlags {
  unresolvedFillTimes: number;
  missingArchiveSessions: number;
  needsAttention: boolean;
  /** Something could not be checked, so no clean bill of health is implied. */
  unverified: boolean;
}

export interface SessionSummary {
  plan: { state: SessionPlanState };
  counts: SessionCounts;
  review: { state: SessionReviewState };
  /** Null when the session has no process assessment. */
  process: ProcessSummary | null;
  dataConfidence: DataConfidenceFlags;
}

const nonNegative = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/** Build the one canonical session summary from already-scoped session inputs. */
export function buildSessionSummary(input: SessionSummaryInput): SessionSummary {
  const accounts = input.accounts ?? [];
  const sessionTrades = input.trades.filter((trade) => !trade.is_sample);
  const real = sessionTrades.filter((trade) => !isReplayTrade(trade, accounts)).length;
  const replay = sessionTrades.length - real;
  const review = input.review?.session_date === input.sessionDate ? input.review : null;
  const total = input.process?.total == null ? 7 : nonNegative(input.process.total);
  const confidence = input.dataConfidence ?? {};
  const unresolvedFillTimes = nonNegative(confidence.unresolvedFillTimes);
  const missingArchiveSessions = nonNegative(confidence.missingArchiveSessions ?? undefined);
  const unverified = confidence.missingArchiveSessions === null || confidence.unverifiedFillTimes === null
    || nonNegative(confidence.unverifiedFillTimes ?? undefined) > 0;

  return {
    plan: {
      state: input.plans.some((plan) => plan.session_date === input.sessionDate && !plan.archived)
        ? "planned"
        : "unplanned",
    },
    counts: { real, replay },
    review: { state: review?.status === "done" ? "done" : review ? "draft" : "not-started" },
    process: input.process && total > 0 ? { followed: Math.min(nonNegative(input.process.followed), total), total } : null,
    dataConfidence: {
      unresolvedFillTimes,
      missingArchiveSessions,
      needsAttention: unresolvedFillTimes > 0 || missingArchiveSessions > 0,
      unverified,
    },
  };
}
