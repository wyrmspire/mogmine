import { laterTouch } from "./hindsight.ts";
import type { LaterTouch } from "./hindsight.ts";
import { expectedInsideBarTimes, isRegularTradingBarInterval, sessionCloseUtc } from "./session.ts";
import type { DerivedTrade, EventBasis, PositionPoint } from "./trade-document.ts";
import { excursionsFromBars, fillInsideBar, isWholeQuantity } from "./trades.ts";
import type { Candle, Excursions, TradeDirection, TradeRecord } from "./trades.ts";

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

export interface TradeBarFinding {
  code: "stop_traded_through" | "target_traded_through" | "fill_outside_bar";
  barTime: number;
  price: number;
  basis: EventBasis;
  /** Stop path index, target key or order ID, or fill sequence. */
  segment: number | string;
}

export interface ObservedTrade {
  coverage: BarCoverage;
  chronology: ChronologyResolution;
  findings: TradeBarFinding[];
  excursions: Excursions | null;
  hindsight: {
    last_stop_touch: LaterTouch | null;
    target_touches: Array<LaterTouch & { target: string }>;
  };
}

type PositionWindow = { from: number; to: number };

function positionWindows(timeline: PositionPoint[], openThrough: number): PositionWindow[] {
  const windows: PositionWindow[] = [];
  let from: number | null = null;
  for (const fill of timeline) {
    const time = Date.parse(fill.t);
    if (fill.position_after > 0) {
      from ??= time;
    } else if (from != null) {
      windows.push({ from, to: time });
      from = null;
    }
  }
  if (from != null && openThrough > from) windows.push({ from, to: openThrough });
  return windows;
}

function unfilledPlannedTargets(
  derived: DerivedTrade,
  workedTargets: Set<string>,
  targetOrders: ReadonlyMap<string, string | null>,
) {
  const pending = derived.planned_targets
    .filter(({ key, qty }) => !workedTargets.has(key) && isWholeQuantity(qty))
    .map((target) => ({ ...target, remaining: target.qty }));
  const fills = new Map(derived.position_timeline.map((fill) => [fill.seq, fill]));
  for (const lot of derived.closed_lots) {
    const fill = fills.get(lot.exit_seq);
    if (lot.exit_reason !== "target" || (fill?.order && targetOrders.has(fill.order))) continue;
    let qty = lot.qty;
    for (const target of pending) {
      if (target.price !== lot.exit_price) continue;
      const matched = Math.min(qty, target.remaining);
      target.remaining -= matched;
      qty -= matched;
      if (!qty) break;
    }
  }
  return pending.filter(({ remaining }) => remaining > 0);
}

/** Observe OHLC evidence against the active, non-voided events in a derived trade. */
export function observeTrade(derived: DerivedTrade, candles: Candle[], barMinutes = 1): ObservedTrade {
  const result: ObservedTrade = {
    coverage: "missing",
    chronology: "unresolved",
    findings: [],
    excursions: null,
    hindsight: { last_stop_touch: null, target_touches: [] },
  };
  const barMs = barMinutes * 60_000;
  if (!Number.isSafeInteger(barMs) || barMs <= 0 || !derived.entry_time) return result;

  const { symbol, position_timeline: fills, stop_path: stops } = derived;
  const direction: TradeDirection = derived.side === "long" ? "LONG" : "SHORT";
  const entry = Date.parse(derived.entry_time);
  const exit = Date.parse(derived.exit_time ?? "");
  const closed = derived.status === "closed" && Number.isFinite(exit) && exit >= entry;
  const barOpen = (time: number) => Math.floor(time / barMs) * barMs;
  if (closed && barOpen(entry) !== barOpen(exit)) result.chronology = "resolved";

  const barsByTime = new Map<number, Candle>();
  for (const bar of candles) {
    if (bar.time % barMs === 0 && !barsByTime.has(bar.time)) barsByTime.set(bar.time, bar);
  }
  const bars = [...barsByTime.values()].sort((a, b) => a.time - b.time);
  // Without an exit, the newest bar may still be forming.
  const windows = positionWindows(fills, bars.at(-1)?.time ?? entry);
  const expected = closed ? windows.flatMap(({ from, to }) => expectedInsideBarTimes(from, to, barMs, symbol)) : [];
  const inside = closed
    ? expected.flatMap((time) => barsByTime.get(time) ?? [])
    : bars.filter((bar) => windows.some(({ from, to }) => bar.time >= from && bar.time + barMs <= to)
        && isRegularTradingBarInterval(symbol, bar.time, barMs));

  const required = new Set(expected);
  for (const fill of fills) {
    const time = barOpen(Date.parse(fill.t));
    required.add(time);
    const bar = barsByTime.get(time);
    if (bar && !fillInsideBar(fill.price, bar, symbol)) {
      result.findings.push({
        code: "fill_outside_bar", barTime: time, price: fill.price, basis: "inferred", segment: fill.seq,
      });
    }
  }
  const available = [...required].filter((time) => barsByTime.has(time)).length;
  if (closed && available > 0 && available === required.size) result.coverage = "complete";
  else if (available > 0 || inside.length > 0) result.coverage = "partial";

  for (const [index, stop] of stops.entries()) {
    const from = Date.parse(stop.from);
    const to = stop.to == null ? Infinity : Date.parse(stop.to);
    const hit = inside.find((bar) => bar.time >= from && bar.time + barMs <= to
      && stopTouched(direction, stop.price, bar));
    if (hit) {
      result.findings.push({
        code: "stop_traded_through", barTime: hit.time, price: stop.price, basis: "inferred", segment: index,
      });
    }
  }

  const workedTargets = new Set<string>();
  const targetOrders = new Map<string, string | null>();
  const observeTarget = (key: string, price: number, from: number, to: number) => {
    const hit = inside.find((bar) => bar.time >= from && bar.time + barMs <= to && targetTouched(direction, price, bar));
    if (hit) {
      result.findings.push({
        code: "target_traded_through", barTime: hit.time, price, basis: "inferred", segment: key,
      });
    }
  };
  for (const order of derived.working_orders) {
    if (order.role !== "target") continue;
    if (!targetOrders.has(order.order)) {
      const key = order.target ?? derived.planned_targets.find((target) => target.key === order.order)?.key
        ?? derived.planned_targets.find((target) => target.price === order.price && !workedTargets.has(target.key))?.key
        ?? null;
      if (key != null) workedTargets.add(key);
      targetOrders.set(order.order, key);
    }
    if (order.filled_qty < order.qty) {
      observeTarget(targetOrders.get(order.order) ?? order.order, order.price, Date.parse(order.from),
        order.to == null ? Infinity : Date.parse(order.to));
    }
  }
  const planTime = Date.parse(derived.plan?.t ?? "");
  for (const target of unfilledPlannedTargets(derived, workedTargets, targetOrders)) {
    observeTarget(target.key, target.price, planTime, Infinity);
  }

  if (closed) {
    const fillPrices = fills.filter((fill) => isWholeQuantity(fill.qty)).map((fill) => fill.price);
    result.excursions = excursionsFromBars(direction, inside, fillPrices,
      inside.length === expected.length ? "complete" : "partial");

    const sessionClose = sessionCloseUtc(exit);
    const sessionBars = bars.filter((bar) => bar.time > exit && bar.time + barMs <= sessionClose
      && isRegularTradingBarInterval(symbol, bar.time, barMs));
    const exitFill = fills.at(-1);
    const lastStop = stops.findLast((stop) => stop.to_seq === exitFill?.seq
      && (stop.end_reason === "filled" || stop.end_reason === "position_closed"));
    if (lastStop) {
      result.hindsight.last_stop_touch = laterTouch(sessionBars, exit, lastStop.price, "stop", direction, sessionClose);
    }
    for (const target of derived.planned_targets) {
      const touch = laterTouch(sessionBars, exit, target.price, "target", direction, sessionClose);
      if (touch) result.hindsight.target_touches.push({ ...touch, target: target.key });
    }
  }
  return result;
}
