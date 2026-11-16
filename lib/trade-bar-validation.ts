import { expectedInsideBarTimes } from "./session.ts";
import type { Candle, TradeDirection, TradeRecord } from "./trades.ts";

export type TradeBarIssueCode =
  | "stop_crossed_before_exit"
  | "target_crossed_before_exit"
  | "exit_outside_bar";

export interface TradeBarIssue {
  code: TradeBarIssueCode;
  /** Open time of the first bar that proves the fact, in UTC milliseconds. */
  barTime: number;
  /** Planned level or recorded exit price involved in the finding. */
  price: number;
}

export type BarCoverage = "complete" | "partial" | "missing";

/** Whether entry vs exit order inside the hold can be established from the bars. */
export type ChronologyResolution = "resolved" | "unresolved";

export interface TradeBarValidation {
  coverage: BarCoverage;
  issues: TradeBarIssue[];
  /**
   * `unresolved` when entry and exit fall in the same bar (or times are invalid).
   * Complete candle availability is not enough to sequence an intra-bar hold.
   */
  chronology: ChronologyResolution;
}

type ValidatedTrade = Pick<TradeRecord,
  "symbol" | "direction" | "entry_time" | "exit_time" | "exit_price" | "stop_loss_price" | "planned_target_price"
>;

function stopTouched(direction: TradeDirection, stop: number, bar: Candle) {
  return direction === "LONG" ? bar.low <= stop : bar.high >= stop;
}

function targetTouched(direction: TradeDirection, target: number, bar: Candle) {
  return direction === "LONG" ? bar.high >= target : bar.low <= target;
}

function coverageFor(
  candles: Candle[],
  expected: number[],
  entryBarTime: number,
  exitBarTime: number,
): BarCoverage {
  if (!candles.length) return "missing";
  const present = new Set(candles.map((bar) => bar.time));
  const expectedPresent = expected.filter((time) => present.has(time)).length;
  const hasEntryBar = present.has(entryBarTime);
  const hasExitBar = present.has(exitBarTime);
  if (expectedPresent === 0 && !hasEntryBar && !hasExitBar) return "missing";
  const expectedComplete = expectedPresent === expected.length;
  // Both boundary candles are required: the entry bar to check the entry fill,
  // and the exit bar to check whether the recorded exit sits in its range.
  // An intra-bar hold (no fully-inside bars) is complete only when that one bar is present.
  if (expectedComplete && hasEntryBar && hasExitBar) return "complete";
  return "partial";
}

/**
 * Compare a recorded trade with OHLC bars without changing either one.
 *
 * Only completed bars between entry and exit prove that a planned level was
 * passed before the exit. The exit bar itself cannot prove event order inside
 * an OHLC candle, but it can prove whether the recorded exit is in its range.
 *
 * Coverage is reported separately from findings (issue #52). An empty issue
 * list with missing or partial coverage is not a pass: only `complete` coverage
 * and no issues is a clean check.
 */
export function validateTradeAgainstBars(trade: ValidatedTrade, candles: Candle[], barMinutes = 1): TradeBarValidation {
  const exitPrice = trade.exit_price;
  // An open trade has no exit to check against the bars yet (R-03).
  if (trade.exit_time == null || exitPrice == null) return { coverage: "missing", issues: [], chronology: "unresolved" };
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit <= entry || barMinutes <= 0) {
    return { coverage: "missing", issues: [], chronology: "unresolved" };
  }

  const barMs = barMinutes * 60_000;
  const expected = expectedInsideBarTimes(entry, exit, barMs, trade.symbol);
  const entryBarTime = Math.floor(entry / barMs) * barMs;
  const exitBarTime = Math.floor(exit / barMs) * barMs;
  const coverage = coverageFor(candles, expected, entryBarTime, exitBarTime);
  // Same-bar holds have complete data when that bar exists, but chronology is unresolved.
  const chronology: ChronologyResolution = entryBarTime === exitBarTime ? "unresolved" : "resolved";

  const completed = candles.filter((bar) => bar.time >= entry && bar.time + barMs <= exit);
  const issues: TradeBarIssue[] = [];

  if (trade.stop_loss_price != null) {
    const bar = completed.find((candidate) => stopTouched(trade.direction, trade.stop_loss_price!, candidate));
    if (bar) issues.push({ code: "stop_crossed_before_exit", barTime: bar.time, price: trade.stop_loss_price });
  }

  const target = trade.planned_target_price;
  const exitedWorseThanTarget = target != null && (trade.direction === "LONG" ? exitPrice < target : exitPrice > target);
  if (target != null && exitedWorseThanTarget) {
    const bar = completed.find((candidate) => targetTouched(trade.direction, target, candidate));
    if (bar) issues.push({ code: "target_crossed_before_exit", barTime: bar.time, price: target });
  }

  const exitBar = candles.find((bar) => bar.time === exitBarTime);
  if (exitBar && (exitPrice < exitBar.low || exitPrice > exitBar.high)) {
    issues.push({ code: "exit_outside_bar", barTime: exitBar.time, price: exitPrice });
  }

  return { coverage, issues, chronology };
}
