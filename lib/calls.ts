// Discretionary calls (docs/25, proposal OD-52, slice DC-1). Pure: no storage, no UI.
// A call records a decision that departs from the default (the setup, the signal, the plan, the
// normal size) and why. Grades are hindsight computed from candles; they never change R, P&L or
// statistics (B-63, UX-52), and the model never computes them (guardrail 11).

import { buildHindsight } from "./hindsight.ts";
import { toTicks } from "./trades.ts";
import type { Candle, Timeframe, TradeDirection, TradeRecord } from "./trades.ts";

export type CallKind = "skip" | "flip" | "cut" | "early_take" | "stop_here" | "hold" | "size";

export interface CallKindSpec {
  kind: CallKind;
  label: string;
  /** Text glyph; meaning is always carried by the label too (UX-80). */
  glyph: string;
  prompt: string;
  /** Goes against the setup's own signal: drawn with `--call-against`. */
  against: boolean;
  /** Whether the call must belong to a trade, must not, or may. */
  trade: "required" | "forbidden" | "optional";
  reasons: readonly string[];
}

export const SHARED_CALL_REASONS = ["Gut", "News soon", "Tired / tilted", "Daily limit close"] as const;

export const CALL_KINDS: readonly CallKindSpec[] = [
  {
    kind: "skip", label: "Skip", glyph: "⊘", prompt: "Setup's here. Why not?", against: true, trade: "forbidden",
    reasons: ["Late in move", "No room to level", "Against HTF", "NQ not confirming", "Chop", "Already hit target for the day", "Spread / speed"],
  },
  {
    kind: "flip", label: "Flip", glyph: "⇅", prompt: "Signal says one way. Why the other?", against: true, trade: "optional",
    reasons: ["Failed breakout", "Trapped traders", "NQ diverging", "Level held", "Absorption", "HTF says other way"],
  },
  {
    kind: "cut", label: "Cut", glyph: "✂", prompt: "Why out before stop or target?", against: false, trade: "required",
    reasons: ["Thesis broken", "Stalled at level", "NQ turned", "Time stop", "Volume dried up", "Scared"],
  },
  {
    kind: "early_take", label: "Early take", glyph: "◎", prompt: "Why bank it before target?", against: false, trade: "required",
    reasons: ["Into a level", "Momentum fading", "Spike / wick", "Locked the day", "Scared"],
  },
  {
    kind: "stop_here", label: "Stop here", glyph: "⊢", prompt: "Why is the stop at this price?", against: false, trade: "required",
    reasons: ["Behind level", "Behind swing", "ATR / ADR", "Fixed ticks", "Round number", "Below liquidity"],
  },
  {
    kind: "hold", label: "Hold", glyph: "→", prompt: "Why still in past target or time?", against: false, trade: "required",
    reasons: ["Trend day", "No opposing level", "Trailing", "NQ leading"],
  },
  {
    kind: "size", label: "Size", glyph: "±", prompt: "Why more or less than normal?", against: false, trade: "required",
    reasons: ["A+ setup", "Low conviction", "Near loss limit", "After a loss", "Playing with profit"],
  },
];

export function callKindSpec(kind: string): CallKindSpec | null {
  return CALL_KINDS.find((spec) => spec.kind === kind) ?? null;
}

/** Reason chips offered for a kind: its own, then the shared ones. */
export function reasonsFor(kind: CallKind): string[] {
  const spec = callKindSpec(kind);
  return spec ? [...spec.reasons, ...SHARED_CALL_REASONS] : [];
}

export interface DiscretionCall {
  id: string;
  user_id: string;
  kind: CallKind;
  /** When the decision was made (ISO, UTC). */
  made_at: string;
  /** When it was written down (ISO, UTC). */
  recorded_at: string;
  trade_id: string | null;
  plan_session_id: string | null;
  playbook_id: string | null;
  price: number | null;
  price_ticks: number | null;
  /** The setup's own direction, for Skip and Flip. */
  signal_direction: TradeDirection | null;
  reasons: string[];
  note: string;
  conviction: 1 | 2 | 3 | null;
}

/** A call written down more than this long after the decision is "after the fact" (docs/25 §1). */
export const AFTER_THE_FACT_MS = 5 * 60_000;

/** Derived, never stored. Null when either time is unreadable. */
export function isAfterTheFact(call: Pick<DiscretionCall, "made_at" | "recorded_at">): boolean | null {
  const made = Date.parse(call.made_at);
  const recorded = Date.parse(call.recorded_at);
  if (!Number.isFinite(made) || !Number.isFinite(recorded)) return null;
  return recorded - made > AFTER_THE_FACT_MS;
}

/** Problems with a call, as plain sentences. Empty means valid. */
export function validateCall(call: DiscretionCall): string[] {
  const problems: string[] = [];
  const spec = callKindSpec(call.kind);
  if (!spec) return [`Unknown call kind "${call.kind}".`];
  if (!call.user_id) problems.push("A call needs a user_id.");
  const made = Date.parse(call.made_at);
  const recorded = Date.parse(call.recorded_at);
  if (!Number.isFinite(made)) problems.push("The decision time is not a valid date.");
  if (!Number.isFinite(recorded)) problems.push("The recorded time is not a valid date.");
  if (Number.isFinite(made) && Number.isFinite(recorded) && recorded < made) {
    problems.push("A call cannot be written down before it was made.");
  }
  if (spec.trade === "required" && !call.trade_id) problems.push(`${spec.label} belongs to a trade.`);
  if (spec.trade === "forbidden" && call.trade_id) problems.push(`${spec.label} is a trade not taken, so it has no trade.`);
  if (spec.kind === "flip" && call.signal_direction == null) problems.push("Flip needs the signal's direction.");
  if ((call.price == null) !== (call.price_ticks == null)) problems.push("Price and price in ticks go together.");
  if (call.price != null && !Number.isFinite(call.price)) problems.push("The price is not a number.");
  if (call.price_ticks != null && !Number.isInteger(call.price_ticks)) problems.push("The price in ticks must be a whole number.");
  if (call.conviction != null && ![1, 2, 3].includes(call.conviction)) problems.push("Conviction is 1, 2 or 3.");
  const allowed = new Set(reasonsFor(spec.kind));
  for (const reason of call.reasons) {
    if (!allowed.has(reason)) problems.push(`"${reason}" is not a ${spec.label} reason.`);
  }
  if (new Set(call.reasons).size !== call.reasons.length) problems.push("A reason is listed twice.");
  return problems;
}

export type CallGrade = "paid" | "cost" | "even" | "unknown" | "not_graded";

export interface CallGradeFact {
  /** Always labelled as hindsight wherever this is shown. */
  hindsight: true;
  grade: CallGrade;
  /** Ticks per contract the call saved (positive) or cost (negative) against the default. */
  ticks: number | null;
  /** The same in R of the initial risk. Null without a stop (guardrail 4). */
  r: number | null;
  sentence: string;
}

type GradableTrade = Pick<
  TradeRecord,
  "symbol" | "direction" | "entry_price" | "exit_price" | "exit_time" | "stop_loss_price" | "initial_stop_price" | "planned_target_price"
>;

function notGraded(sentence: string): CallGradeFact {
  return { hindsight: true, grade: "not_graded", ticks: null, r: null, sentence };
}

function formatR(r: number) {
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${sign}${Math.abs(r).toFixed(1)}R`;
}

/**
 * Grade a Cut or Early take from the trade's own later bars (docs/25 §6). The default was holding
 * to the stop or the target: stop reached first means the call paid, target first means it cost.
 * Other kinds are not graded yet (DC-5, later slices).
 */
export function gradeCall(
  call: Pick<DiscretionCall, "kind">,
  trade: GradableTrade,
  candles: Candle[],
  timeframe: Timeframe = "1m",
): CallGradeFact {
  if (call.kind !== "cut" && call.kind !== "early_take") return notGraded("Hindsight: this kind of call is not graded yet.");
  if (trade.exit_time == null || trade.exit_price == null) return notGraded("Hindsight: the trade is still open.");
  const fact = buildHindsight(trade, candles, timeframe);
  if (!fact) return notGraded("Hindsight: the trade is still open.");

  const sign = trade.direction === "LONG" ? 1 : trade.direction === "SHORT" ? -1 : null;
  const exit = toTicks(trade.exit_price, trade.symbol);
  const entry = toTicks(trade.entry_price, trade.symbol);
  const riskStop = trade.initial_stop_price ?? trade.stop_loss_price;
  const riskStopTicks = riskStop == null ? null : toTicks(riskStop, trade.symbol);
  const risk = sign == null || entry == null || riskStopTicks == null ? null : (entry - riskStopTicks) * sign;
  const toR = (ticks: number) => (risk != null && risk > 0 ? ticks / risk : null);

  if (trade.stop_loss_price == null && trade.planned_target_price == null) {
    return notGraded("Hindsight: no stop or target on record, so there is no default to compare with.");
  }
  if (sign == null || exit == null) return notGraded("Hindsight: the exit price cannot be read in ticks.");

  if (fact.outcome === "stop_first" && trade.stop_loss_price != null) {
    const stop = toTicks(trade.stop_loss_price, trade.symbol);
    if (stop == null) return notGraded("Hindsight: the stop price is off the tick grid.");
    const ticks = (exit - stop) * sign;
    const r = toR(ticks);
    return { hindsight: true, grade: "paid", ticks, r, sentence: `Hindsight: paid. The stop was hit later, so the call saved ${ticks} ticks${r == null ? "" : ` (${formatR(r)})`}.` };
  }
  if (fact.outcome === "target_first" && trade.planned_target_price != null) {
    const target = toTicks(trade.planned_target_price, trade.symbol);
    if (target == null) return notGraded("Hindsight: the target price is off the tick grid.");
    const ticks = -(target - exit) * sign;
    const r = toR(ticks);
    return { hindsight: true, grade: "cost", ticks, r, sentence: `Hindsight: cost. The target was hit later, so the call left ${-ticks} ticks${r == null ? "" : ` (${formatR(r)})`}.` };
  }
  if (fact.outcome === "same_bar") {
    return { hindsight: true, grade: "unknown", ticks: null, r: null, sentence: "Hindsight: can't tell. The stop and the target were both reached in the same later bar." };
  }
  if (fact.incomplete) {
    return { hindsight: true, grade: "unknown", ticks: null, r: null, sentence: "Hindsight: can't tell yet. Bars after the exit do not reach the session close." };
  }
  return { hindsight: true, grade: "even", ticks: 0, r: 0, sentence: "Hindsight: even. Neither the stop nor the target was reached by the session close." };
}
