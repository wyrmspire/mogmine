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

export interface TradeBarValidation {
  coverage: BarCoverage;
  issues: TradeBarIssue[];
}

type ValidatedTrade = Pick<TradeRecord,
  "direction" | "entry_time" | "exit_time" | "exit_price" | "stop_loss_price" | "planned_target_price"
>;

function stopTouched(direction: TradeDirection, stop: number, bar: Candle) {
  return direction === "LONG" ? bar.low <= stop : bar.high >= stop;
}

function targetTouched(direction: TradeDirection, target: number, bar: Candle) {
  return direction === "LONG" ? bar.high >= target : bar.low <= target;
}

/** Open times of bars that are entirely inside the hold, using execution timestamps only. */
function expectedInsideBarTimes(entry: number, exit: number, barMs: number): number[] {
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit <= entry || barMs <= 0) return [];
  const times: number[] = [];
  let time = Math.ceil(entry / barMs) * barMs;
  if (time < entry) time += barMs;
  while (time + barMs <= exit) {
    times.push(time);
    time += barMs;
  }
  return times;
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
  // The exit bar is needed to check whether the recorded exit sits in its range.
  // An intra-bar hold (no fully-inside bars) is complete only when that bar is present.
  if (expectedComplete && hasExitBar) return "complete";
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
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit <= entry || barMinutes <= 0) {
    return { coverage: "missing", issues: [] };
  }

  const barMs = barMinutes * 60_000;
  const expected = expectedInsideBarTimes(entry, exit, barMs);
  const entryBarTime = Math.floor(entry / barMs) * barMs;
  const exitBarTime = Math.floor(exit / barMs) * barMs;
  const coverage = coverageFor(candles, expected, entryBarTime, exitBarTime);

  const completed = candles.filter((bar) => bar.time >= entry && bar.time + barMs <= exit);
  const issues: TradeBarIssue[] = [];

  if (trade.stop_loss_price != null) {
    const bar = completed.find((candidate) => stopTouched(trade.direction, trade.stop_loss_price!, candidate));
    if (bar) issues.push({ code: "stop_crossed_before_exit", barTime: bar.time, price: trade.stop_loss_price });
  }

  const target = trade.planned_target_price;
  const exitedWorseThanTarget = target != null && (trade.direction === "LONG" ? trade.exit_price < target : trade.exit_price > target);
  if (target != null && exitedWorseThanTarget) {
    const bar = completed.find((candidate) => targetTouched(trade.direction, target, candidate));
    if (bar) issues.push({ code: "target_crossed_before_exit", barTime: bar.time, price: target });
  }

  const exitBar = candles.find((bar) => bar.time === exitBarTime);
  if (exitBar && (trade.exit_price < exitBar.low || trade.exit_price > exitBar.high)) {
    issues.push({ code: "exit_outside_bar", barTime: exitBar.time, price: trade.exit_price });
  }

  return { coverage, issues };
}
