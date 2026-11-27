// Pure evaluation engine for trading challenges (R-09a, docs/17).
// Runs on stored trades on the device. No React, no storage, no Date.now() inside.
// AGENTS §3b invariants: gross dollars / cents, deterministic integer math, no AI scoring, no broker enforcement.

import { isReplayAccount } from "./accounts.ts";
import type { TradingAccount } from "./accounts.ts";
import { sessionCloseUtc, sessionDate } from "./session.ts";
import { isOpen, processRead, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export const CHALLENGE_CALC_VERSION = 1;

export type ChallengeRules =
  | { kind: "drawdown"; sessions: number; max_drawdown_cents: number }
  | { kind: "clean_run"; target_trades: number; playbook_ids: string[] };

export interface ChallengeDefinition {
  id: string; // crypto.randomUUID()
  user_id: string; // DEFAULT_OWNER_USER_ID (invariant 7)
  /**
   * Scope: only this trading account's trades count. null (or absent on older records) = all accounts, as before.
   * Optional so unlisted fixtures that predate UX-08 still typecheck; sanitizeChallenge always writes it.
   */
  account_id?: string | null;
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
  | { trade_id: string; reason: "undated" }
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

type TimedTrade = { trade: TradeRecord; exitMs: number };

export interface EvaluateChallengeOptions {
  /** Accounts used to exclude `replay` account trades unless the challenge is explicitly scoped to that replay account. */
  accounts?: readonly Pick<TradingAccount, "id" | "mode">[];
}

export function evaluateChallenge(
  definition: ChallengeDefinition,
  trades: TradeRecord[],
  now: number,
  opts?: EvaluateChallengeOptions,
): ChallengeResult {
  const startedMs = Date.parse(definition.started_at);
  const replayAccountIds = definition.account_id == null && opts?.accounts?.length
    ? new Set(opts.accounts.filter(isReplayAccount).map((account) => account.id))
    : null;

  let excludedBeforeStart = 0;
  const inScopeClosedTrades: TimedTrade[] = [];
  const issues: ChallengeIssue[] = [];

  for (const trade of trades) {
    if (trade.is_sample) continue;
    // Account scope (UX-08): filter before any rule sees the trade. Challenge limits stay independent of the account's own rules.
    if (definition.account_id != null && trade.account_id !== definition.account_id) continue;
    // Replay isolation: never count replay-account trades in all-accounts challenges.
    if (replayAccountIds && trade.account_id != null && replayAccountIds.has(trade.account_id)) continue;

    const entryMs = Date.parse(trade.entry_time);
    if (entryMs < startedMs) {
      if (isOpen(trade) || (trade.exit_time != null && Date.parse(trade.exit_time) >= startedMs)) {
        excludedBeforeStart += 1;
      }
      continue;
    }

    if (isOpen(trade) || trade.exit_time == null) {
      issues.push({ trade_id: trade.id, reason: "open" });
      continue;
    }

    const exitMs = Date.parse(trade.exit_time);
    if (!Number.isFinite(exitMs)) {
      issues.push({ trade_id: trade.id, reason: "undated" });
      continue;
    }
    inScopeClosedTrades.push({ trade, exitMs });
  }

  // Order is by exit_time, then by id for ties (docs/17 §2 rule 4)
  inScopeClosedTrades.sort((a, b) => {
    if (a.exitMs !== b.exitMs) return a.exitMs - b.exitMs;
    if (a.trade.id === b.trade.id) return 0;
    return a.trade.id < b.trade.id ? -1 : 1;
  });

  if (definition.rules.kind === "drawdown") {
    return evaluateDrawdown(definition.rules, inScopeClosedTrades, issues, excludedBeforeStart, now);
  }
  return evaluateCleanRun(definition.rules, inScopeClosedTrades, issues, excludedBeforeStart);
}

/**
 * The Drawdown Defender room, labelled by what it is (UX-07, `02-ux.md` §2.1). Never a bare "$50" that reads like equity.
 * Shield shows a share of the limit, with no dollar sign.
 */
export function formatChallengeRoomLabel(roomCents: number, limitCents: number, shield: boolean): string {
  if (shield) {
    const percent = limitCents > 0 ? Math.max(0, Math.round((roomCents / limitCents) * 100)) : 0;
    return `Room: ${percent}% of the limit`;
  }
  const dollars = Math.max(0, roomCents) / 100;
  const amount = dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `Room before the challenge limit: $${amount} (from your high point)`;
}

function evaluateDrawdown(
  rules: { kind: "drawdown"; sessions: number; max_drawdown_cents: number },
  trades: TimedTrade[],
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

  for (const { trade, exitMs } of trades) {
    const session = sessionDate(exitMs);
    activeSessions.add(session);
    lastCountedTradeExitMs = exitMs;

    const pnl = tradePnl(trade);
    if (pnl == null || !Number.isSafeInteger(Math.round(pnl * 100))) {
      issues.push({ trade_id: trade.id, reason: "unpriceable" });
      continue;
    }

    if (failedAtTradeId != null) continue;

    const pnlCents = Math.round(pnl * 100);

    equityCents += pnlCents;
    if (equityCents > peakCents) {
      peakCents = equityCents;
    }
    const drawdown = peakCents - equityCents;
    if (drawdown > maxDrawdownCents) {
      maxDrawdownCents = drawdown;
    }
    currentDrawdownCents = drawdown;

    points.push({
      trade_id: trade.id,
      closed_at: exitMs,
      session,
      equity_cents: equityCents,
      peak_cents: peakCents,
      drawdown_cents: drawdown,
    });

    if (drawdown >= rules.max_drawdown_cents) {
      failedAtTradeId = trade.id;
    }
  }

  const remainingCents = Math.max(0, rules.max_drawdown_cents - currentDrawdownCents);
  const provisional = issues.length > 0;

  let state: "active" | "passed" | "failed" = "active";
  let decidedBy: string | null = null;

  const incompletePath = issues.some((issue) => issue.reason === "unpriceable" || issue.reason === "undated");
  if (failedAtTradeId != null && !incompletePath) {
    state = "failed";
    decidedBy = failedAtTradeId;
  } else if (!provisional && lastCountedTradeExitMs != null && activeSessions.size >= rules.sessions) {
    const lastSessionClose = sessionCloseUtc(lastCountedTradeExitMs);
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
  trades: TimedTrade[],
  initialIssues: ChallengeIssue[],
  excludedBeforeStart: number,
): ChallengeResult {
  const issues = [...initialIssues];
  const points: ChallengePoint[] = [];

  let run = 0;
  let bestRun = 0;
  let passedAtTradeId: string | null = null;

  for (const { trade, exitMs } of trades) {
    const session = sessionDate(exitMs);

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
    } else {
      readKind = "clean";
    }

    if (readKind === "broken" || readKind === "off_plan") {
      run = 0;
      passedAtTradeId = null;
      points.push({
        trade_id: trade.id,
        closed_at: exitMs,
        session,
        read: readKind,
        run,
      });
    } else if (readKind === "ungraded") {
      issues.push({ trade_id: trade.id, reason: "ungraded" });
      // Ungraded trades have no scored point and block a pass.
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
