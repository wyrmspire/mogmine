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
  reasons: readonly SeedReason[];
}

/** Groups chips across kinds for filters and Mood Shape evidence (docs/18). */
export type ReasonFamily = "market" | "plan" | "risk" | "state" | "other";

/** A seed reason: immutable key, editable label and family. The key keeps its id stable across wording changes. */
export type SeedReason = readonly [key: string, label: string, family: ReasonFamily];

export const SHARED_CALL_REASONS: readonly SeedReason[] = [
  ["gut", "Gut", "state"],
  ["news-soon", "News soon", "market"],
  ["tired-tilted", "Tired / tilted", "state"],
  ["daily-limit-close", "Daily limit close", "risk"],
];

export const CALL_KINDS: readonly CallKindSpec[] = [
  {
    kind: "skip", label: "Skip", glyph: "⊘", prompt: "Setup's here. Why not?", against: true, trade: "forbidden",
    reasons: [["late-in-move", "Late in move", "market"], ["no-room-to-level", "No room to level", "plan"], ["against-htf", "Against HTF", "market"], ["nq-not-confirming", "NQ not confirming", "market"], ["chop", "Chop", "market"], ["already-hit-target-for-the-day", "Already hit target for the day", "risk"], ["spread-speed", "Spread / speed", "market"]],
  },
  {
    kind: "flip", label: "Flip", glyph: "⇅", prompt: "Signal says one way. Why the other?", against: true, trade: "optional",
    reasons: [["failed-breakout", "Failed breakout", "market"], ["trapped-traders", "Trapped traders", "market"], ["nq-diverging", "NQ diverging", "market"], ["level-held", "Level held", "plan"], ["absorption", "Absorption", "market"], ["htf-says-other-way", "HTF says other way", "market"]],
  },
  {
    kind: "cut", label: "Cut", glyph: "✂", prompt: "Why out before stop or target?", against: false, trade: "required",
    reasons: [["thesis-broken", "Thesis broken", "plan"], ["stalled-at-level", "Stalled at level", "market"], ["nq-turned", "NQ turned", "market"], ["time-stop", "Time stop", "plan"], ["volume-dried-up", "Volume dried up", "market"], ["scared", "Scared", "state"]],
  },
  {
    kind: "early_take", label: "Early take", glyph: "◎", prompt: "Why bank it before target?", against: false, trade: "required",
    reasons: [["into-a-level", "Into a level", "plan"], ["momentum-fading", "Momentum fading", "market"], ["spike-wick", "Spike / wick", "market"], ["locked-the-day", "Locked the day", "risk"], ["scared", "Scared", "state"]],
  },
  {
    kind: "stop_here", label: "Stop here", glyph: "⊢", prompt: "Why is the stop at this price?", against: false, trade: "required",
    reasons: [["behind-level", "Behind level", "plan"], ["behind-swing", "Behind swing", "market"], ["atr-adr", "ATR / ADR", "risk"], ["fixed-ticks", "Fixed ticks", "risk"], ["round-number", "Round number", "market"], ["below-liquidity", "Below liquidity", "market"]],
  },
  {
    kind: "hold", label: "Hold", glyph: "→", prompt: "Why still in past target or time?", against: false, trade: "required",
    reasons: [["trend-day", "Trend day", "market"], ["no-opposing-level", "No opposing level", "plan"], ["trailing", "Trailing", "plan"], ["nq-leading", "NQ leading", "market"]],
  },
  {
    kind: "size", label: "Size", glyph: "±", prompt: "Why more or less than normal?", against: false, trade: "required",
    reasons: [["a-plus-setup", "A+ setup", "plan"], ["low-conviction", "Low conviction", "state"], ["near-loss-limit", "Near loss limit", "risk"], ["after-a-loss", "After a loss", "state"], ["playing-with-profit", "Playing with profit", "state"]],
  },
];

export function callKindSpec(kind: string): CallKindSpec | null {
  return CALL_KINDS.find((spec) => spec.kind === kind) ?? null;
}

/** A reason chip with a stable id. Renames keep the id, so stats stay joined (docs/playbook-design/04 §1.3). */
export interface ReasonChip {
  id: string;
  label: string;
  family: ReasonFamily;
  /** Hidden from pickers; still labels and validates past calls. */
  retired: boolean;
}

/** A chip as it was when the call was saved. Stats group by id; the call shows its own label. */
export interface FrozenReason {
  id: string;
  label: string;
  family: ReasonFamily;
}

export const REASON_FAMILIES: readonly ReasonFamily[] = ["market", "plan", "risk", "state", "other"];
export const REASON_LABEL_MAX = 32;

/** Stable seed id, for example `seed:cut:thesis-broken` or `seed:shared:gut`. Never changes once shipped. */
export function seedReasonId(scope: CallKind | "shared", key: string) {
  return `seed:${scope}:${key}`;
}

function seedChips(scope: CallKind | "shared", seeds: readonly SeedReason[]): ReasonChip[] {
  return seeds.map(([key, label, family]) => ({ id: seedReasonId(scope, key), label, family, retired: false }));
}

/** The shared seed chips (Gut, News soon, …), offered with every kind. */
export function sharedReasonChips(): ReasonChip[] {
  return seedChips("shared", SHARED_CALL_REASONS);
}

/** Seed chips offered for a kind: its own, then the shared ones. The prompt library (DP-2) is seeded from this. */
export function reasonChipsFor(kind: CallKind): ReasonChip[] {
  const spec = callKindSpec(kind);
  return spec ? [...seedChips(kind, spec.reasons), ...sharedReasonChips()] : [];
}

/** Freeze a chip onto a call. The call keeps this label even if the chip is renamed or retired later. */
export function freezeReason(chip: Pick<ReasonChip, "id" | "label" | "family">): FrozenReason {
  return { id: chip.id, label: chip.label, family: chip.family };
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
  /** Chip ids with the labels they had when saved (DC-1b). */
  reasons: FrozenReason[];
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

/**
 * Problems with a call, as plain sentences. Empty means valid.
 * A reason is valid when its id is among `offered` (the prompt's chips, retired ones included) or was
 * already on `previous` (the saved version being edited), so a call stays valid after its chip is
 * renamed or retired. `offered` defaults to the seed chips for the kind.
 */
export function validateCall(
  call: DiscretionCall,
  offered?: readonly Pick<ReasonChip, "id">[],
  previous?: Pick<DiscretionCall, "reasons"> | null,
): string[] {
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
  const allowed = new Set((offered ?? reasonChipsFor(spec.kind)).map((chip) => chip.id));
  for (const reason of previous?.reasons ?? []) allowed.add(reason.id);
  for (const reason of call.reasons) {
    if (!reason.label?.trim() || reason.label.length > REASON_LABEL_MAX) {
      problems.push(`A reason label must be 1–${REASON_LABEL_MAX} characters.`);
    }
    if (!REASON_FAMILIES.includes(reason.family)) problems.push(`"${reason.label}" has an unknown family.`);
    if (!allowed.has(reason.id)) problems.push(`"${reason.label}" is not a ${spec.label} reason.`);
  }
  if (new Set(call.reasons.map((reason) => reason.id)).size !== call.reasons.length) problems.push("A reason is listed twice.");
  return problems;
}

export type CallGrade = "paid" | "cost" | "even" | "unknown" | "not_graded";

export interface CallGradeFact {
  /** Always labelled as hindsight wherever this is shown. */
  hindsight: true;
  grade: CallGrade;
  /** Ticks per contract the call saved (positive) or cost (negative) against the default. Null when there is no amount (even, unknown, not graded). */
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
  // Holding would still have been open at the close, so there is no saved or lost amount to report.
  return { hindsight: true, grade: "even", ticks: null, r: null, sentence: "Hindsight: even. Neither the stop nor the target was reached by the session close." };
}
