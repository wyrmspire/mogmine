// Pure evaluation engine for trading challenges (R-09a, docs/17).
// Runs on stored trades on the device. No React, no storage, no Date.now() inside.
// AGENTS §3b invariants: gross dollars / cents, deterministic integer math, no AI scoring, no broker enforcement.

import { sessionCloseUtc, sessionDate } from "./session.ts";
import { isClosed, isOpen, processRead, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export const CHALLENGE_CALC_VERSION = 1;

export type ChallengeRules =
  | { kind: "drawdown"; sessions: number; max_drawdown_cents: number }
  | { kind: "clean_run"; target_trades: number; playbook_ids: string[] };

export interface ChallengeDefinition {
  id: string; // crypto.randomUUID()
  user_id: string; // DEFAULT_OWNER_USER_ID (invariant 7)
  rules: ChallengeRules; // frozen at start
  started_at: string; // UTC ISO
  ended_at: string | null; // set when the trader ends it, or on pass/fail
  calc_version: number;
  /** Written once when the attempt ends, so a later edit to a trade cannot rewrite history. */
  final?: ChallengeResult;
}

export type ChallengeIssue =
  | { trade_id: string; reason: "open" }
  | { trade_id: string; reason: "unpriceable" } // tradePnl returned null
  | { trade_id: string; reason: "ungraded" }; // Clean Run only

export interface ChallengePoint {
  // one per scored trade, in order
  trade_id: string;
  closed_at: number; // ms
  session: string; // YYYY-MM-DD
  equity_cents?: number;
  peak_cents?: number;
  drawdown_cents?: number; // drawdown
  read?: "clean" | "broken" | "off_plan";
  run?: number; // clean_run
}

export interface ChallengeResult {
  state: "active" | "passed" | "failed";
  /** True while an in-scope trade is open or cannot be scored: numbers are estimates. */
  provisional: boolean;
  issues: ChallengeIssue[];
  points: ChallengePoint[];
  decided_by: string | null; // trade id that failed or passed it
  excluded_before_start: number; // count, for the disclosure line
  // drawdown
  equity_cents?: number;
  peak_cents?: number;
  drawdown_cents?: number;
  max_drawdown_cents?: number;
  remaining_cents?: number;
  sessions_done?: number;
  // clean_run
  run?: number;
  best_run?: number;
}

export function evaluateChallenge(
  definition: ChallengeDefinition,
  trades: TradeRecord[],
  now: number,
): ChallengeResult {
  const startedMs = Date.parse(definition.started_at);

  let excludedBeforeStart = 0;
  const inScopeClosedTrades: TradeRecord[] = [];
  const issues: ChallengeIssue[] = [];

  for (const trade of trades) {
    if (trade.is_sample) continue;

    const entryMs = Date.parse(trade.entry_time);
    if (entryMs < startedMs) {
      excludedBeforeStart += 1;
      continue;
    }

    if (isOpen(trade) || trade.exit_time == null) {
      issues.push({ trade_id: trade.id, reason: "open" });
      continue;
    }

    if (isClosed(trade)) {
      inScopeClosedTrades.push(trade);
    }
  }

  // Order is by exit_time, then by id for ties (docs/17 §2 rule 4)
  inScopeClosedTrades.sort((a, b) => {
    const aTime = Date.parse(a.exit_time!);
    const bTime = Date.parse(b.exit_time!);
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });

  if (definition.rules.kind === "drawdown") {
    return evaluateDrawdown(definition.rules, inScopeClosedTrades, issues, excludedBeforeStart, now);
  } else {
    return evaluateCleanRun(definition.rules, inScopeClosedTrades, issues, excludedBeforeStart);
  }
}

function evaluateDrawdown(
  rules: { kind: "drawdown"; sessions: number; max_drawdown_cents: number },
  trades: TradeRecord[],
  initialIssues: ChallengeIssue[],
  excludedBeforeStart: number,
  now: number,
): ChallengeResult {
  const issues = [...initialIssues];
  const points: ChallengePoint[] = [];

  let equityCents = 0;
  let peakCents = 0; // both start at 0; start counts as a peak (docs/17 §3)
  let maxDrawdownCents = 0;
  let currentDrawdownCents = 0;

  let failedAtTradeId: string | null = null;
  const activeSessions = new Set<string>();
  let lastCountedTradeExitMs: number | null = null;

  for (const trade of trades) {
    const pnl = tradePnl(trade);
    if (pnl == null) {
      issues.push({ trade_id: trade.id, reason: "unpriceable" });
      continue;
    }

    const pnlCents = Math.round(pnl * 100);
    const exitMs = Date.parse(trade.exit_time!);
    const session = sessionDate(trade.exit_time!);

    equityCents += pnlCents;
    if (equityCents > peakCents) {
      peakCents = equityCents;
    }
    const drawdown = peakCents - equityCents;
    if (drawdown > maxDrawdownCents) {
      maxDrawdownCents = drawdown;
    }
    currentDrawdownCents = drawdown;

    activeSessions.add(session);
    lastCountedTradeExitMs = exitMs;

    points.push({
      trade_id: trade.id,
      closed_at: exitMs,
      session,
      equity_cents: equityCents,
      peak_cents: peakCents,
      drawdown_cents: drawdown,
    });

    if (failedAtTradeId == null && drawdown >= rules.max_drawdown_cents) {
      failedAtTradeId = trade.id;
    }
  }

  const remainingCents = Math.max(0, rules.max_drawdown_cents - currentDrawdownCents);
  const provisional = issues.length > 0;

  let state: "active" | "passed" | "failed" = "active";
  let decidedBy: string | null = null;

  if (failedAtTradeId != null) {
    state = "failed";
    decidedBy = failedAtTradeId;
  } else if (!provisional && activeSessions.size >= rules.sessions) {
    const lastSessionClose = lastCountedTradeExitMs != null ? sessionCloseUtc(lastCountedTradeExitMs) : 0;
    if (now > lastSessionClose) {
      state = "passed";
      decidedBy = points.length > 0 ? points[points.length - 1].trade_id : null;
    }
  }

  return {
    state,
    provisional,
    issues,
    points,
    decided_by: decidedBy,
    excluded_before_start: excludedBeforeStart,
    equity_cents: equityCents,
    peak_cents: peakCents,
    drawdown_cents: currentDrawdownCents,
    max_drawdown_cents: maxDrawdownCents,
    remaining_cents: remainingCents,
    sessions_done: activeSessions.size,
  };
}

function evaluateCleanRun(
  rules: { kind: "clean_run"; target_trades: number; playbook_ids: string[] },
  trades: TradeRecord[],
  initialIssues: ChallengeIssue[],
  excludedBeforeStart: number,
): ChallengeResult {
  const issues = [...initialIssues];
  const points: ChallengePoint[] = [];

  let run = 0;
  let bestRun = 0;
  let passedAtTradeId: string | null = null;

  for (const trade of trades) {
    const exitMs = Date.parse(trade.exit_time!);
    const session = sessionDate(trade.exit_time!);

    // Clean Run classification order (docs/17 §4):
    // 1. Broken: playbook_id === "no-setup" or processRead(trade) === "broken"
    // 2. Off-plan: has a playbook, but not in playbook_ids
    // 3. Ungraded: no playbook, or processRead(trade) === null (no checklist filled in)
    // 4. Clean: in playbook_ids and processRead(trade) === "clean"
    const pRead = processRead(trade);
    const playbookId = trade.playbook_id;

    let readKind: "broken" | "off_plan" | "ungraded" | "clean";

    if (playbookId === "no-setup" || pRead === "broken") {
      readKind = "broken";
    } else if (playbookId && !rules.playbook_ids.includes(playbookId)) {
      readKind = "off_plan";
    } else if (!playbookId || pRead === null) {
      readKind = "ungraded";
    } else if (pRead === "clean" && playbookId && rules.playbook_ids.includes(playbookId)) {
      readKind = "clean";
    } else {
      readKind = "ungraded";
    }

    if (readKind === "broken" || readKind === "off_plan") {
      run = 0;
      points.push({
        trade_id: trade.id,
        closed_at: exitMs,
        session,
        read: readKind,
        run,
      });
    } else if (readKind === "ungraded") {
      issues.push({ trade_id: trade.id, reason: "ungraded" });
      // Run does not move, not pushed to points or pushed with undefined read?
      // docs/17 §4: Run does not move. Listed as "needs grading". Blocks a pass.
    } else if (readKind === "clean") {
      run += 1;
      if (run > bestRun) {
        bestRun = run;
      }
      points.push({
        trade_id: trade.id,
        closed_at: exitMs,
        session,
        read: "clean",
        run,
      });

      if (passedAtTradeId == null && run >= rules.target_trades) {
        passedAtTradeId = trade.id;
      }
    }
  }

  const provisional = issues.length > 0;
  let state: "active" | "passed" = "active";
  let decidedBy: string | null = null;

  if (run >= rules.target_trades && !provisional) {
    state = "passed";
    decidedBy = passedAtTradeId;
  }

  return {
    state,
    provisional,
    issues,
    points,
    decided_by: decidedBy,
    excluded_before_start: excludedBeforeStart,
    run,
    best_run: bestRun,
  };
}
