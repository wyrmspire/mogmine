"use client";

import type { TradingAccount } from "@/lib/accounts";
import type { DailyReview } from "@/lib/daily-review";
import { coveringDailyReview } from "@/lib/day-review-screen";
import type { PlanningSession } from "@/lib/plans";
import type { Prefs } from "@/lib/prefs-sanitize";
import { selectNextActions, type NextActionSignals } from "@/lib/next-actions";
import { buildSessionSummary } from "@/lib/session-summary";
import type { TradeRecord } from "@/lib/trades";
import { CurrentFocusCard } from "./CurrentFocusCard";
import { NextActionsCard } from "./NextActionsCard";
import { SessionSummaryCard } from "./SessionSummaryCard";
import { useTodayDecisionSignals } from "./useTodayDecisionSignals";

export function TodayDecisionCockpit(props: {
  sessionDate: string;
  now: number;
  trades: readonly TradeRecord[];
  sessionTrades: readonly TradeRecord[];
  accounts: readonly TradingAccount[];
  activeAccountId: string | null;
  activeAccountName: string | null;
  prefs: Prefs;
  plans: readonly PlanningSession[];
  reviews: readonly DailyReview[];
  reviewQueueCount: number;
  process: { followed: number; total: number } | null;
}) {
  const connected = useTodayDecisionSignals(props.trades, props.now, props.accounts, props.prefs);
  const review = coveringDailyReview(props.reviews, props.sessionDate, props.activeAccountId);
  const actionSignals: NextActionSignals = {
    ...connected,
    archiveGapDays: connected.archiveGapDays ?? undefined,
    realTradesMissingInitialStop: props.trades.filter((trade) => trade.initial_stop_price == null).length,
    unreviewedRealTrades: props.reviewQueueCount,
    dailyReviewUnfinished: review?.status !== "done",
  };
  const summary = buildSessionSummary({
    sessionDate: props.sessionDate,
    plans: props.plans,
    trades: props.sessionTrades,
    accounts: props.accounts,
    review: review ?? null,
    process: props.process,
    dataConfidence: {
      unresolvedFillTimes: connected.unresolvedFillToBarMatch,
      missingArchiveSessions: connected.archiveGapDays,
      unverifiedFillTimes: connected.unverifiedFillTimes,
    },
  });

  return <>
    <NextActionsCard result={selectNextActions(actionSignals)} unverified={summary.dataConfidence.unverified} />
    <CurrentFocusCard
      reviews={props.reviews}
      sessionDate={props.sessionDate}
      accountId={props.activeAccountId}
      accountName={props.activeAccountName}
      accounts={props.accounts}
    />
    <SessionSummaryCard summary={summary} />
  </>;
}
