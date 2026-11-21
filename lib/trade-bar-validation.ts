// Observer: compares a DerivedTrade with OHLC bars to detect stop/target traded through,
// fills outside the bar, MFE/MAE excursions, and post-exit hindsight touches (docs/15 §3.3, Issue #35).
// Pure: no I/O, no DB, no DOM.

import { sessionCloseUtc } from "./session.ts";
import { expectedInsideBarTimes } from "./session.ts";
import { laterTouch } from "./hindsight.ts";
import type { LaterTouch } from "./hindsight.ts";
import {
  fillInsideBar,
  specFor,
} from "./trades.ts";
import type {
  Candle,
  Excursions,
  TradeDirection,
  TradeRecord,
} from "./trades.ts";
import type {
  DerivedTrade,
  EventBasis,
  TradeDocument,
} from "./trade-document.ts";

/** Default tick tolerance for fill-outside-bar detection (B-12, issue #35). */
export const DEFAULT_TICK_TOLERANCE_TICKS = 4;

export type TradeBarIssueCode =
  | "stop_crossed_before_exit"
  | "target_crossed_before_exit"
  | "exit_outside_bar"
  | "stop_traded_through"
  | "target_traded_through"
  | "fill_outside_bar";

export interface TradeBarIssue {
  code: TradeBarIssueCode;
  /** Open time of the first bar that proves the fact, in UTC milliseconds. */
  barTime: number;
  /** Planned level or recorded exit price involved in the finding. */
  price: number;
  basis?: EventBasis;
}

export interface TradeBarFinding {
  code: TradeBarIssueCode;
  /** Open time of the first bar that proves the fact, in UTC milliseconds. */
  barTime: number;
  /** Level or recorded execution price involved in the finding. */
  price: number;
  /** How this finding is known: broker, stated, or inferred. */
  basis: EventBasis;
  /** Attached stop segment index or target key when applicable. */
  segment?: number | string;
}

export type BarCoverage = "complete" | "partial" | "missing";

/** Whether entry vs exit order inside the hold can be established from the bars. */
export type ChronologyResolution = "resolved" | "unresolved";

export interface ObservedTrade {
  coverage: BarCoverage;
  chronology: ChronologyResolution;
  findings: TradeBarFinding[];
  /** Honest MFE and MAE calculated over complete inside bars. */
  excursions: Excursions | null;
  /** Post-exit hindsight touches (first later touch of last stop or target). */
  hindsight: {
    last_stop_touch: LaterTouch | null;
    target_touches: LaterTouch[];
  };
}

export interface ObserveTradeOptions {
  toleranceTicks?: number;
  doc?: TradeDocument;
}

export interface TradeBarValidation {
  coverage: BarCoverage;
  issues: TradeBarIssue[];
  chronology: ChronologyResolution;
}

type ValidatedTrade = Pick<
  TradeRecord,
  "symbol" | "direction" | "entry_time" | "exit_time" | "exit_price" | "stop_loss_price" | "planned_target_price"
>;

function stopTouched(direction: TradeDirection, stop: number, bar: Candle): boolean {
  return direction === "LONG" ? bar.low <= stop : bar.high >= stop;
}

function targetTouched(direction: TradeDirection, target: number, bar: Candle): boolean {
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
  if (expectedComplete && hasEntryBar && hasExitBar) return "complete";
  return "partial";
}

/**
 * Compare a recorded trade with OHLC bars without changing either one.
 * Preserved for legacy `TradeRecord` callers.
 */
export function validateTradeAgainstBars(
  trade: ValidatedTrade,
  candles: Candle[],
  barMinutes = 1,
): TradeBarValidation {
  const exitPrice = trade.exit_price;
  if (trade.exit_time == null || exitPrice == null) {
    return { coverage: "missing", issues: [], chronology: "unresolved" };
  }
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
  const chronology: ChronologyResolution = entryBarTime === exitBarTime ? "unresolved" : "resolved";

  const completed = candles.filter((bar) => bar.time >= entry && bar.time + barMs <= exit);
  const issues: TradeBarIssue[] = [];

  if (trade.stop_loss_price != null) {
    const bar = completed.find((candidate) => stopTouched(trade.direction, trade.stop_loss_price!, candidate));
    if (bar) {
      issues.push({
        code: "stop_crossed_before_exit",
        barTime: bar.time,
        price: trade.stop_loss_price,
      });
    }
  }

  const target = trade.planned_target_price;
  const exitedWorseThanTarget = target != null && (trade.direction === "LONG" ? exitPrice < target : exitPrice > target);
  if (target != null && exitedWorseThanTarget) {
    const bar = completed.find((candidate) => targetTouched(trade.direction, target, candidate));
    if (bar) {
      issues.push({
        code: "target_crossed_before_exit",
        barTime: bar.time,
        price: target,
      });
    }
  }

  const exitBar = candles.find((bar) => bar.time === exitBarTime);
  if (exitBar && (exitPrice < exitBar.low || exitPrice > exitBar.high)) {
    issues.push({
      code: "exit_outside_bar",
      barTime: exitBar.time,
      price: exitPrice,
    });
  }

  return { coverage, issues, chronology };
}

/**
 * Pure bar observer over a `DerivedTrade` (docs/15 §3.3, Issue #35).
 *
 * Checks:
 * 1. Each stop segment: whether any completed bar inside the segment's span traded through its price.
 * 2. Each unfilled target: whether any completed bar during the open trade traded through the target.
 * 3. Each fill: whether the fill price sits outside its bar range (accounting for tick tolerance, B-12).
 * 4. MFE and MAE with honest boundary handling.
 * 5. Post-exit hindsight: first later touch of the last stop and each target.
 */
export function observeTrade(
  derived: DerivedTrade,
  candles: Candle[],
  barMinutes = 1,
  options: ObserveTradeOptions = {},
): ObservedTrade {
  const toleranceTicks = options.toleranceTicks ?? DEFAULT_TICK_TOLERANCE_TICKS;
  const barMs = barMinutes > 0 ? barMinutes * 60_000 : 60_000;
  const symbol = derived.symbol;
  const direction: TradeDirection = derived.side === "long" ? "LONG" : "SHORT";

  const entryMs = derived.entry_time ? Date.parse(derived.entry_time) : NaN;
  const exitMs = derived.exit_time ? Date.parse(derived.exit_time) : NaN;
  const hasValidHold = Number.isFinite(entryMs) && Number.isFinite(exitMs) && exitMs > entryMs;

  const entryBarTime = Number.isFinite(entryMs) ? Math.floor(entryMs / barMs) * barMs : NaN;
  const exitBarTime = Number.isFinite(exitMs) ? Math.floor(exitMs / barMs) * barMs : NaN;

  let coverage: BarCoverage = "missing";
  let chronology: ChronologyResolution = "unresolved";

  if (hasValidHold) {
    const expected = expectedInsideBarTimes(entryMs, exitMs, barMs, symbol);
    coverage = coverageFor(candles, expected, entryBarTime, exitBarTime);
    chronology = entryBarTime === exitBarTime ? "unresolved" : "resolved";
  } else if (Number.isFinite(entryMs)) {
    const present = new Set(candles.map((b) => b.time));
    coverage = present.has(entryBarTime) ? "partial" : "missing";
  }

  const findings: TradeBarFinding[] = [];
  const candleMap = new Map<number, Candle>();
  for (const bar of candles) {
    candleMap.set(bar.time, bar);
  }

  // 1. Check fills outside bar
  // Read fills either from options.doc.events if provided or from derived.position_timeline
  interface FillItem {
    t: string;
    price: number;
    basis: EventBasis;
  }
  const fills: FillItem[] = [];
  if (options.doc) {
    for (const e of options.doc.events) {
      if (e.type === "fill") {
        fills.push({ t: e.t, price: e.price, basis: e.basis });
      }
    }
  } else {
    for (const pt of derived.position_timeline) {
      fills.push({ t: pt.t, price: pt.price, basis: pt.basis });
    }
  }

  for (const fill of fills) {
    const fillMs = Date.parse(fill.t);
    if (!Number.isFinite(fillMs)) continue;
    const barTime = Math.floor(fillMs / barMs) * barMs;
    const bar = candleMap.get(barTime);
    if (bar && !fillInsideBar(fill.price, bar, symbol, toleranceTicks)) {
      findings.push({
        code: "fill_outside_bar",
        barTime,
        price: fill.price,
        basis: fill.basis,
      });
    }
  }

  // 2. Stop segments traded through
  for (let idx = 0; idx < derived.stop_path.length; idx++) {
    const seg = derived.stop_path[idx];
    const segFromMs = Date.parse(seg.from);
    const segToMs = seg.to ? Date.parse(seg.to) : (hasValidHold ? exitMs : NaN);
    if (!Number.isFinite(segFromMs) || !Number.isFinite(segToMs) || segToMs <= segFromMs) {
      continue;
    }

    const completed = candles
      .filter((bar) => bar.time >= segFromMs && bar.time + barMs <= segToMs)
      .sort((a, b) => a.time - b.time);

    const hit = completed.find((bar) => stopTouched(direction, seg.price, bar));
    if (hit) {
      findings.push({
        code: "stop_traded_through",
        barTime: hit.time,
        price: seg.price,
        basis: seg.basis,
        segment: idx,
      });
    }
  }

  // 3. Unfilled targets traded through
  if (hasValidHold) {
    const completedTradeBars = candles
      .filter((bar) => bar.time >= entryMs && bar.time + barMs <= exitMs)
      .sort((a, b) => a.time - b.time);

    // Identify targets from the plan
    const planTargets = derived.plan?.targets ?? [];
    // Target prices filled with target reason
    const filledTargetPrices: number[] = [];
    for (const pt of derived.position_timeline) {
      if (pt.role === "exit" && pt.reason === "target") {
        filledTargetPrices.push(pt.price);
      }
    }

    for (const target of planTargets) {
      const isFilled = filledTargetPrices.some((fp) => {
        const spec = specFor(symbol);
        const tick = spec?.tickSize ?? 0.25;
        return Math.abs(fp - target.price) < tick * 0.5;
      });

      if (!isFilled) {
        const hit = completedTradeBars.find((bar) => targetTouched(direction, target.price, bar));
        if (hit) {
          findings.push({
            code: "target_traded_through",
            barTime: hit.time,
            price: target.price,
            basis: derived.plan?.basis ?? "stated",
            segment: target.key,
          });
        }
      }
    }
  }

  // 4. MFE / MAE excursions
  let excursions: Excursions | null = null;
  if (hasValidHold && derived.avg_entry_price != null) {
    const expected = expectedInsideBarTimes(entryMs, exitMs, barMs, symbol);
    const insideBars = expected.flatMap((time) => {
      const b = candleMap.get(time);
      return b ? [b] : [];
    });

    if (insideBars.length >= 2) {
      const excursionCoverage = insideBars.length === expected.length ? "complete" : "partial";
      let high = derived.avg_entry_price;
      let low = derived.avg_entry_price;
      if (derived.avg_exit_price != null) {
        high = Math.max(high, derived.avg_exit_price);
        low = Math.min(low, derived.avg_exit_price);
      }
      for (const b of insideBars) {
        high = Math.max(high, b.high);
        low = Math.min(low, b.low);
      }

      excursions = direction === "LONG"
        ? { maePrice: low, mfePrice: high, coverage: excursionCoverage }
        : { maePrice: high, mfePrice: low, coverage: excursionCoverage };
    }
  }

  // 5. Post-exit hindsight touches
  let lastStopTouch: LaterTouch | null = null;
  const targetTouches: LaterTouch[] = [];

  if (derived.status === "closed" && Number.isFinite(exitMs) && derived.exit_time) {
    const sessionClose = sessionCloseUtc(derived.exit_time);

    // Last stop in force
    const lastStop = derived.stop_path.length > 0
      ? derived.stop_path[derived.stop_path.length - 1].price
      : derived.initial_stop?.price ?? null;

    if (lastStop != null) {
      lastStopTouch = laterTouch(candles, exitMs, lastStop, "stop", direction, sessionClose);
    }

    // Planned targets
    const planTargets = derived.plan?.targets ?? [];
    for (const pt of planTargets) {
      const touch = laterTouch(candles, exitMs, pt.price, "target", direction, sessionClose);
      if (touch) {
        targetTouches.push(touch);
      }
    }
  }

  return {
    coverage,
    chronology,
    findings,
    excursions,
    hindsight: {
      last_stop_touch: lastStopTouch,
      target_touches: targetTouches,
    },
  };
}
