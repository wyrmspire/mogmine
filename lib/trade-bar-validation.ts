import { laterTouch } from "./hindsight.ts";
import type { HindsightOutcome, LaterTouch } from "./hindsight.ts";
import { matchFill } from "./fill-match.ts";
import { insideBarTimes, isRegularTradingBarInterval, sessionCloseUtc } from "./session.ts";
import { stopAtExit } from "./trade-document.ts";
import type { DerivedTrade, EventBasis, PositionPoint, WorkingOrderSegment } from "./trade-document.ts";
import { excursionsFromBars, isWholeQuantity } from "./trades.ts";
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
  const expected = insideBarTimes(entry, exit, barMs, trade.symbol);
  const entryBarTime = Math.floor(entry / barMs) * barMs;
  const exitBarTime = Math.floor(exit / barMs) * barMs;
  const coverage = coverageFor(candles, expected, entryBarTime, exitBarTime);
  // Same-bar holds have complete data when that bar exists, but chronology is unresolved.
  const chronology: ChronologyResolution = entryBarTime === exitBarTime ? "unresolved" : "resolved";

  // R-POST-1: the entry bar is never inside the hold, even when the entry has `:00` seconds.
  const completed = candles.filter((bar) => bar.time >= entryBarTime + barMs && bar.time + barMs <= exit);
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
  code: "stop_traded_through" | "target_traded_through" | "fill_outside_bar" | "fill_time_shifted";
  barTime: number;
  price: number;
  basis: EventBasis;
  /** Stop path index, target key or order ID, or fill sequence. */
  segment: number | string;
  /** `fill_time_shifted` only: the stated minute's bar that the trader's logged time points at. */
  statedBarTime?: number;
  /** `fill_time_shifted` only: matched bar minus stated bar, in minutes. */
  offsetMin?: number;
  /** `fill_time_shifted` only: which fill moved. */
  role?: "entry" | "exit";
}

/** A fill whose price resolved to a bar (FB-1). `shifted` means it traded in a different minute than logged. */
export interface FillBarMatch {
  barTime: number;
  shifted: boolean;
}

export interface NotTakenPlanHindsight {
  basis: "inferred";
  /** Candle coverage from plan placement through the first observed exit touch or cancellation. */
  coverage: BarCoverage;
  entry_bar_time: number | null;
  first_exit_touch: {
    barTime: number;
    stop: number | null;
    targets: Array<{ target: string; price: number }>;
  } | null;
  /** Entry-bar exit touches are ambiguous. Gaps leave the outcome null. */
  outcome: HindsightOutcome | "entry_bar" | null;
}

export interface ObservedTrade {
  coverage: BarCoverage;
  chronology: ChronologyResolution;
  findings: TradeBarFinding[];
  /** Keyed by fill `seq`. Set for fills that resolved to a bar (FB-1). Marks anchor on these bars. */
  fillMatches?: ReadonlyMap<number, FillBarMatch>;
  excursions: Excursions | null;
  /**
   * R-POST-4 / D-H: the entry bar's pre-fill range crossed the stop in force at entry. Recorded as a
   * quiet fact only: it is not a finding, so it draws no chart flag and is not counted as a stop touch.
   */
  entryBarPassedStop?: boolean;
  hindsight: {
    last_stop_touch: LaterTouch | null;
    target_touches: Array<LaterTouch & { target: string }>;
    not_taken_plan?: NotTakenPlanHindsight;
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
) {
  const pending = derived.planned_targets
    .filter(({ key, qty }) => !workedTargets.has(key) && isWholeQuantity(qty))
    .map((target) => ({ ...target, remaining: target.qty }));
  const workedQty = new Map(derived.position_timeline.map((fill) => [fill.seq, fill.target_order_qty ?? 0]));
  for (const lot of derived.closed_lots) {
    if (lot.exit_reason !== "target") continue;
    const alreadyMatched = workedQty.get(lot.exit_seq) ?? 0;
    const appliedQty = Math.min(lot.qty, alreadyMatched);
    workedQty.set(lot.exit_seq, alreadyMatched - appliedQty);
    let qty = lot.qty - appliedQty;
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

function observeNotTakenPlan(
  derived: DerivedTrade,
  direction: TradeDirection,
  bars: Candle[],
  barsByTime: ReadonlyMap<number, Candle>,
  barMs: number,
): NotTakenPlanHindsight | undefined {
  const { plan, entry_cancelled_at: cancelledAt, symbol } = derived;
  if (!plan || !cancelledAt) return undefined;
  const start = Date.parse(plan.t);
  const cancelled = Date.parse(cancelledAt);
  if (!Number.isFinite(start) || !Number.isFinite(cancelled) || cancelled <= start) return undefined;

  const inside = bars.filter((bar) => bar.time >= start && bar.time + barMs <= cancelled
    && isRegularTradingBarInterval(symbol, bar.time, barMs));
  const entryIndex = inside.findIndex((bar) => {
    if (plan.entry.order === "market") return true;
    const touches = plan.entry.order === "limit" ? stopTouched : targetTouched;
    return touches(direction, plan.entry.price, bar);
  });
  const entry = inside[entryIndex];
  let firstExit: NotTakenPlanHindsight["first_exit_touch"] = null;
  if (entry) {
    for (let index = entryIndex; index < inside.length; index++) {
      const bar = inside[index];
      const stop = plan.stop != null && stopTouched(direction, plan.stop, bar) ? plan.stop : null;
      const targets = plan.targets.filter(({ price }) => targetTouched(direction, price, bar))
        .map(({ key, price }) => ({ target: key, price }));
      if (stop == null && targets.length === 0) continue;
      firstExit = { barTime: bar.time, stop, targets };
      break;
    }
  }

  const through = firstExit ? firstExit.barTime + barMs : cancelled;
  let coverage: BarCoverage = "missing";
  if (inside.length > 0) {
    coverage = start % barMs === 0 && through % barMs === 0 ? "complete" : "partial";
    for (let time = start; coverage === "complete" && time < through; time += barMs) {
      if (!barsByTime.has(time) && isRegularTradingBarInterval(symbol, time, barMs)) coverage = "partial";
    }
  }

  let outcome: NotTakenPlanHindsight["outcome"] = null;
  if (coverage === "complete" && entry) {
    if (!firstExit) {
      if (plan.stop != null || plan.targets.length > 0) outcome = "neither";
    } else if (firstExit.barTime === entry.time) outcome = "entry_bar";
    else if (firstExit.stop == null) outcome = "target_first";
    else outcome = firstExit.targets.length ? "same_bar" : "stop_first";
  }

  return {
    basis: "inferred",
    coverage,
    entry_bar_time: entry?.time ?? null,
    first_exit_touch: firstExit,
    outcome,
  };
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
  if (!Number.isSafeInteger(barMinutes) || barMinutes <= 0 || !Number.isSafeInteger(barMs)) return result;
  if (!derived.entry_time && derived.status !== "not_taken") return result;

  const { symbol, position_timeline: fills, stop_path: stops } = derived;
  const direction: TradeDirection = derived.side === "long" ? "LONG" : "SHORT";
  const barsByTime = new Map<number, Candle>();
  for (const bar of candles) {
    if (bar.time % barMs === 0 && !barsByTime.has(bar.time)) barsByTime.set(bar.time, bar);
  }
  const bars = [...barsByTime.values()].sort((a, b) => a.time - b.time);
  if (!derived.entry_time) {
    const hindsight = observeNotTakenPlan(derived, direction, bars, barsByTime, barMs);
    if (hindsight) result.hindsight.not_taken_plan = hindsight;
    return result;
  }

  const entry = Date.parse(derived.entry_time);
  const exit = Date.parse(derived.exit_time ?? "");
  const closed = derived.status === "closed" && Number.isFinite(exit) && exit >= entry;
  const barOpen = (time: number) => Math.floor(time / barMs) * barMs;
  if (closed && barOpen(entry) !== barOpen(exit)) result.chronology = "resolved";
  if (!bars.length) return result;
  // On an open trade the newest bar may still be forming.
  const newestBarTime = bars[bars.length - 1].time;
  const matchBars = closed ? bars : bars.filter((bar) => bar.time < newestBarTime);
  // FB-1: match each checkable fill to the bar its price traded in, in time order. A shifted fill
  // takes its matched bar as its effective time for position windows. Stored times are never changed.
  const timeline: PositionPoint[] = [];
  const checkedBars: number[] = [];
  const fillMatches = new Map<number, FillBarMatch>();
  let notBefore: number | undefined;
  for (const fill of fills) {
    const time = barOpen(Date.parse(fill.t));
    if (!closed && time + barMs > newestBarTime) {
      timeline.push(fill);
      continue;
    }
    checkedBars.push(time);
    const match = matchFill(matchBars, fill.t, fill.price, symbol, { role: fill.role, notBefore, barMinutes });
    if (match.kind === "shifted") {
      notBefore = match.barTime;
      fillMatches.set(fill.seq, { barTime: match.barTime, shifted: true });
      timeline.push({ ...fill, t: new Date(match.barTime).toISOString() });
      result.findings.push({
        code: "fill_time_shifted", barTime: match.barTime, price: fill.price, basis: "inferred", segment: fill.seq,
        statedBarTime: match.statedBarTime, offsetMin: match.offsetMin, role: fill.role,
      });
      continue;
    }
    timeline.push(fill);
    if (match.kind === "stated") {
      notBefore = match.barTime;
      fillMatches.set(fill.seq, { barTime: match.barTime, shifted: false });
    } else if (match.kind === "outside") {
      // OD-28 resolves a missing logged minute to a nearby base bar first; that resolved bar is the evidence
      // used by the exact-range search and the existing four-tick fallback.
      result.findings.push({
        code: "fill_outside_bar", barTime: match.barTime, price: fill.price, basis: "inferred", segment: fill.seq,
      });
    }
  }
  result.fillMatches = fillMatches;

  const windows = positionWindows(timeline, closed ? exit : newestBarTime);
  // R-POST-1: a window's entry bar (its fill's bar, or the matched bar under D-I) is never inside the hold.
  const expected = closed ? windows.flatMap(({ from, to }) => insideBarTimes(from, to, barMs, symbol)) : [];
  const inside = closed
    ? expected.flatMap((time) => barsByTime.get(time) ?? [])
    : bars.filter((bar) => windows.some(({ from, to }) => bar.time >= barOpen(from) + barMs && bar.time + barMs <= to)
        && isRegularTradingBarInterval(symbol, bar.time, barMs));

  const required = new Set([...expected, ...checkedBars]);
  const available = [...required].filter((time) => barsByTime.has(time)).length;
  if (closed && available > 0 && available === required.size) result.coverage = "complete";
  else if (available > 0 || inside.length > 0) result.coverage = "partial";

  // R-POST-4: the entry bar (matched under D-I) is checked against the stop in force at the entry instant.
  // Only a complete bar counts; an open trade's newest bar may still be forming.
  const entryFill = timeline.find((fill) => fill.position_after > 0);
  if (entryFill) {
    const entryTime = Date.parse(entryFill.t);
    const entryBarTime = barOpen(entryTime);
    const entryBar = barsByTime.get(entryBarTime);
    const entryBarComplete = closed || entryBarTime < newestBarTime;
    // The stop in force when the entry bar traded: a stop placed by the entry fill itself starts at the fill
    // (its `from` can sit after a matched entry bar's open), so accept any stop working by the bar's end.
    const stopAtEntry = stops.find((stop) => Date.parse(stop.from) <= entryBarTime + barMs
      && (stop.to == null || Date.parse(stop.to) > entryTime));
    result.entryBarPassedStop = Boolean(entryBar && entryBarComplete && stopAtEntry
      && stopTouched(direction, stopAtEntry.price, entryBar));
  }

  for (const [index, stop] of stops.entries()) {
    // SM-UT-2: an untimed move has no known time, so it is never checked against the bars during the hold.
    if (stop.basis === "untimed") continue;
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

  const targetOrders = new Map<string, string | null>();
  const targetSegments = derived.working_orders.filter(({ role }) => role === "target");
  const plannedKeys = new Set(derived.planned_targets.map(({ key }) => key));
  const explicitTarget = (order: WorkingOrderSegment) =>
    order.target ?? (plannedKeys.has(order.order) ? order.order : undefined);
  const workedTargets = new Set<string>();
  for (const order of targetSegments) {
    const key = explicitTarget(order);
    if (key != null) workedTargets.add(key);
  }
  const observeTarget = (key: string, price: number, from: number, to: number) => {
    const hit = inside.find((bar) => bar.time >= from && bar.time + barMs <= to && targetTouched(direction, price, bar));
    if (hit) {
      result.findings.push({
        code: "target_traded_through", barTime: hit.time, price, basis: "inferred", segment: key,
      });
    }
  };
  for (const order of targetSegments) {
    let key = explicitTarget(order) ?? targetOrders.get(order.order);
    if (key === undefined) {
      key = derived.planned_targets.find((target) => target.price === order.price && !workedTargets.has(target.key))?.key ?? null;
      if (key != null) workedTargets.add(key);
    }
    targetOrders.set(order.order, key);
    if (isWholeQuantity(order.qty) && order.filled_qty < order.qty) {
      observeTarget(key ?? order.order, order.price, Date.parse(order.from),
        order.to == null ? Infinity : Date.parse(order.to));
    }
  }
  const planTime = Date.parse(derived.plan?.t ?? "");
  for (const target of unfilledPlannedTargets(derived, workedTargets)) {
    observeTarget(target.key, target.price, planTime, Infinity);
  }

  if (closed) {
    const fillPrices = fills.filter((fill) => isWholeQuantity(fill.qty)).map((fill) => fill.price);
    result.excursions = excursionsFromBars(direction, inside, fillPrices,
      inside.length === expected.length ? "complete" : "partial");

    const sessionClose = sessionCloseUtc(exit);
    const sessionBars = bars.filter((bar) => bar.time > exit && bar.time + barMs <= sessionClose
      && isRegularTradingBarInterval(symbol, bar.time, barMs));
    const lastStop = stopAtExit(derived);
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
