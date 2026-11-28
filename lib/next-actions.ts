/** Pure decision-card selection for Today's "Next" section (RM-C1). */

export type NextActionKind = "truth" | "review" | "practice" | "research";

export type NextAction = {
  id: string;
  kind: NextActionKind;
  title: string;
  detail: string;
  href: string;
};

export type NextActionSignals = {
  unresolvedFillToBarMatch?: number;
  realTradesMissingInitialStop?: number;
  archiveGapDays?: number;
  unreviewedRealTrades?: number;
  dailyReviewUnfinished?: boolean;
  missedDrillsDue?: number;
};

export type NextActionsResult =
  | { status: "actions"; actions: NextAction[] }
  | { status: "caught-up"; actions: [] };

const PRIORITY: Record<NextActionKind, number> = {
  truth: 0,
  review: 1,
  practice: 2,
  research: 3,
};

const positive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Selects at most three due actions without inventing work when the day is clear. */
export function selectNextActions(
  signals: NextActionSignals,
  limit = 3,
): NextActionsResult {
  const actions: NextAction[] = [];

  if (positive(signals.unresolvedFillToBarMatch)) {
    actions.push({
      id: "unresolved-fill-to-bar-match",
      kind: "truth",
      title: "Resolve fill-to-bar matches",
      detail: `${signals.unresolvedFillToBarMatch} trade${signals.unresolvedFillToBarMatch === 1 ? "" : "s"} need${signals.unresolvedFillToBarMatch === 1 ? "s" : ""} timing confirmation`,
      href: "/review",
    });
  }

  if (positive(signals.realTradesMissingInitialStop)) {
    actions.push({
      id: "missing-initial-stop",
      kind: "truth",
      title: "Add missing initial stops",
      detail: `${signals.realTradesMissingInitialStop} real trade${signals.realTradesMissingInitialStop === 1 ? "" : "s"} need${signals.realTradesMissingInitialStop === 1 ? "s" : ""} a stop`,
      href: "/feed",
    });
  }

  if (positive(signals.archiveGapDays) && signals.archiveGapDays > 1) {
    actions.push({
      id: "archive-gap",
      kind: "truth",
      title: "Check the market archive",
      detail: `${signals.archiveGapDays} archive day${signals.archiveGapDays === 1 ? "" : "s"} missing`,
      href: "/tune",
    });
  }

  if (positive(signals.unreviewedRealTrades)) {
    actions.push({
      id: "unreviewed-real-trades",
      kind: "review",
      title: "Review real trades",
      detail: `${signals.unreviewedRealTrades} trade${signals.unreviewedRealTrades === 1 ? "" : "s"} waiting for review`,
      href: "/review",
    });
  }

  if (signals.dailyReviewUnfinished === true) {
    actions.push({
      id: "daily-review",
      kind: "review",
      title: "Finish the daily review",
      detail: "Close the loop on today's session",
      href: "/review",
    });
  }

  if (positive(signals.missedDrillsDue)) {
    actions.push({
      id: "missed-drills",
      kind: "practice",
      title: "Complete due practice",
      detail: `${signals.missedDrillsDue} drill${signals.missedDrillsDue === 1 ? "" : "s"} due`,
      href: "/drills",
    });
  }

  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  const ranked = actions
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])
    .slice(0, Math.min(3, count));

  return ranked.length > 0
    ? { status: "actions", actions: ranked }
    : { status: "caught-up", actions: [] };
}
