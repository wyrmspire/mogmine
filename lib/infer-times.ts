// Find the times from the prices (owner, 2026-11-20, OD-41 (5), docs/20 §2.2). Pure: no DOM, no I/O.
// Given the bars of the chosen day, the side and the typed prices, guess which bar the entry was in
// and which bar the exit was in. A guess, never a fact: the result says how sure it is, how many other
// places the price traded, and whether the stop or target traded first. The trader can always override.

import { specFor } from "./trades.ts";
import type { Candle, TradeDirection, Timeframe } from "./trades.ts";

export type InferConfidence = "exact" | "ambiguous" | "none";

/** Why this entry bar was picked. */
export type EntryReason =
  | "only-touch"      // the price traded in one stretch of bars only
  | "only-consistent" // several touches, but only one has the exit after it without the stop first
  | "nearest-hint"    // several touches; the one nearest the time the trader typed
  | "first-rth"       // several touches; the first in regular hours (09:30–16:00 ET)
  | "first-touch"     // several touches, none in regular hours; the first
  | "no-touch";

export type ExitStatus =
  | "matched"         // first bar after the entry bar that traded the exit price
  | "open"            // no exit price: an open trade, or not typed yet
  | "not-after-entry" // the exit price never traded after the entry bar in these bars
  | "no-entry";

export interface PriceTouch {
  /** Bar open time, UTC ms. */
  time: number;
  kind: "stop" | "target";
}

export interface InferInput {
  candles: Candle[];
  /** Minutes per bar of `candles`. Coarser than 1m makes every time approximate (OD-28 style). */
  timeframe: Timeframe;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  /** A rough entry time the trader typed, UTC ms. Null when the time is only the form's default. */
  hint?: number | null;
}

export interface InferResult {
  confidence: InferConfidence;
  reason: EntryReason;
  /** Bar open time of the suggested entry bar, UTC ms. */
  entryTime: number | null;
  /** Bar open time of the suggested exit bar, UTC ms. */
  exitTime: number | null;
  exitStatus: ExitStatus;
  /** Separate stretches of bars where the entry price traded (a run of touching bars counts once). */
  entryCandidates: number;
  /** First bar of each such stretch, UTC ms, oldest first. */
  candidateTimes: number[];
  /** The exit price also traded inside the entry bar, so the exit may be in the same bar. */
  exitMayBeInEntryBar: boolean;
  /** The stop or target traded after the entry bar and before the exit bar: it would have hit first. */
  hitFirst: PriceTouch | null;
  /** Bars coarser than 1m: the times are the bar's open, not the fill (OD-28 style "approximate"). */
  approximate: boolean;
  timeframe: Timeframe;
}

const etParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** 09:30–16:00 ET on a weekday. Holidays are not modelled (OD-35). */
export function isRegularHours(instant: number): boolean {
  const parts = etParts.formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  if (get("weekday") === "Sat" || get("weekday") === "Sun") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** The bar traded this price: low ≤ price ≤ high, with a hair of float tolerance. */
export function barTrades(bar: Pick<Candle, "high" | "low">, price: number, tolerance: number): boolean {
  return Number.isFinite(price) && bar.low - tolerance <= price && price <= bar.high + tolerance;
}

interface Candidate {
  index: number;
  runStart: number;
  exitIndex: number | null;
  hitFirst: PriceTouch | null;
  consistent: boolean;
  distance: number;
  rth: boolean;
}

/**
 * Guess the entry and exit bars from the prices. Rules, in order:
 * 1. Entry candidates are stretches of consecutive bars whose range contains the entry price. Each
 *    stretch is one candidate at its first bar, or at the bar nearest the hint when the hint is inside it.
 * 2. With an exit price, a candidate is consistent when the exit price trades in a later bar and the
 *    stop (if typed) does not trade strictly before that exit bar.
 * 3. Pick: consistent first, then nearest the hint, then regular hours, then earliest.
 * 4. Exit bar: the first bar after the entry bar that trades the exit price.
 * Confidence is `exact` for one candidate (with its exit found when an exit was typed), `none`
 * without a touch, `ambiguous` otherwise.
 */
export function inferTradeTimes(input: InferInput): InferResult {
  const { candles, timeframe, direction } = input;
  const tick = specFor(input.symbol)?.tickSize ?? 0.01;
  const tolerance = tick * 1e-3;
  const bars = [...candles].filter((bar) => [bar.time, bar.high, bar.low].every(Number.isFinite)).sort((a, b) => a.time - b.time);
  const exitPrice = input.exitPrice != null && Number.isFinite(input.exitPrice) ? input.exitPrice : null;
  const stopPrice = input.stopPrice != null && Number.isFinite(input.stopPrice) ? input.stopPrice : null;
  const targetPrice = input.targetPrice != null && Number.isFinite(input.targetPrice) ? input.targetPrice : null;
  const hint = input.hint != null && Number.isFinite(input.hint) ? input.hint : null;
  const base: InferResult = {
    confidence: "none", reason: "no-touch", entryTime: null, exitTime: null, exitStatus: "no-entry",
    entryCandidates: 0, candidateTimes: [], exitMayBeInEntryBar: false, hitFirst: null,
    approximate: timeframe !== "1m", timeframe,
  };
  if (!Number.isFinite(input.entryPrice) || direction == null) return base;

  // 1. Stretches of bars that traded the entry price.
  const runs: Array<{ start: number; end: number }> = [];
  bars.forEach((bar, index) => {
    if (!barTrades(bar, input.entryPrice, tolerance)) return;
    const last = runs[runs.length - 1];
    if (last && last.end === index - 1) last.end = index;
    else runs.push({ start: index, end: index });
  });
  if (!runs.length) return base;

  const scan = (entryIndex: number) => {
    let exitIndex: number | null = null;
    let hitFirst: PriceTouch | null = null;
    for (let i = entryIndex + 1; i < bars.length; i += 1) {
      const bar = bars[i];
      if (exitPrice != null && barTrades(bar, exitPrice, tolerance)) { exitIndex = i; break; }
      if (!hitFirst && stopPrice != null && barTrades(bar, stopPrice, tolerance)) hitFirst = { time: bar.time, kind: "stop" };
      if (!hitFirst && targetPrice != null && barTrades(bar, targetPrice, tolerance)) hitFirst = { time: bar.time, kind: "target" };
      if (exitPrice == null && hitFirst) break;
    }
    return { exitIndex, hitFirst: exitPrice == null ? null : hitFirst };
  };

  const candidates: Candidate[] = runs.map((run) => {
    let index = run.start;
    if (hint != null) {
      // Inside the stretch, the bar nearest the hint.
      let best = Infinity;
      for (let i = run.start; i <= run.end; i += 1) {
        const d = Math.abs(bars[i].time - hint);
        if (d < best) { best = d; index = i; }
      }
    }
    const { exitIndex, hitFirst } = scan(index);
    const consistent = exitPrice == null || (exitIndex != null && hitFirst?.kind !== "stop");
    let distance = 0;
    if (hint != null) distance = Math.min(...Array.from({ length: run.end - run.start + 1 }, (_, k) => Math.abs(bars[run.start + k].time - hint)));
    return { index, runStart: run.start, exitIndex, hitFirst, consistent, distance, rth: isRegularHours(bars[index].time) };
  });

  const ranked = [...candidates].sort((a, b) =>
    Number(b.consistent) - Number(a.consistent)
    || (hint != null ? a.distance - b.distance : 0)
    || Number(b.rth) - Number(a.rth)
    || a.index - b.index);
  const pick = ranked[0];
  const consistentCount = candidates.filter((c) => c.consistent).length;

  let reason: EntryReason;
  if (candidates.length === 1) reason = "only-touch";
  else if (exitPrice != null && consistentCount === 1 && pick.consistent) reason = "only-consistent";
  else if (hint != null) reason = "nearest-hint";
  else if (pick.rth) reason = "first-rth";
  else reason = "first-touch";

  const exitStatus: ExitStatus = exitPrice == null ? "open" : pick.exitIndex != null ? "matched" : "not-after-entry";
  const exitFound = exitPrice == null || pick.exitIndex != null;
  const confidence: InferConfidence = candidates.length === 1 && exitFound ? "exact" : "ambiguous";
  const entryBar = bars[pick.index];
  return {
    ...base,
    confidence,
    reason,
    entryTime: entryBar.time,
    exitTime: pick.exitIndex != null ? bars[pick.exitIndex].time : null,
    exitStatus,
    entryCandidates: candidates.length,
    candidateTimes: runs.map((run) => bars[run.start].time),
    exitMayBeInEntryBar: exitPrice != null && barTrades(entryBar, exitPrice, tolerance),
    hitFirst: pick.hitFirst,
  };
}
