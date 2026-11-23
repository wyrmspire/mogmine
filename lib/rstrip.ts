import type { TradeDirection, TradeRecord } from "./trades.ts";

/** How the exit sits on the planned stop–target range. */
export type RStripKind = "stopped-out" | "cut-early" | "ran-to-plan" | "beyond-target" | "no-plan";

export interface RStripInput {
  direction: TradeDirection;
  entry: number;
  exit: number | null;
  stop: number | null;
  target: number | null;
  /** Worst price against the trade during the hold, if known. */
  maePrice?: number | null;
  /** Best price in the trade's favour during the hold, if known. */
  mfePrice?: number | null;
}

/** Whether the exit made or lost money against the entry, independent of the plan classification. */
export type RStripOutcome = "favorable" | "adverse" | "breakeven";

export interface RStripLayout {
  /** Normalised 0–1 positions along the strip (stop towards 0, target towards 1). */
  stop: number | null;
  target: number | null;
  entry: number;
  exit: number | null;
  mae: number | null;
  mfe: number | null;
  kind: RStripKind;
  /** Null when there is no exit marker (no exit price). Colours the exit marker, not the label. */
  exitOutcome: RStripOutcome | null;
}

function favourable(direction: TradeDirection, price: number, entry: number) {
  return direction === "LONG" ? price - entry : entry - price;
}

/** Convert a price into R units when a stop exists; otherwise a signed point offset from entry. */
export function stripOffset(price: number, input: Pick<RStripInput, "direction" | "entry" | "stop">): number {
  const signed = favourable(input.direction, price, input.entry);
  if (input.stop == null || input.stop === input.entry) return signed;
  const risk = Math.abs(input.entry - input.stop);
  if (!(risk > 0)) return signed;
  return signed / risk;
}

function classify(input: RStripInput, exitOffset: number | null): RStripKind {
  if (input.stop == null && input.target == null) return "no-plan";
  if (exitOffset == null) return input.stop == null && input.target == null ? "no-plan" : "cut-early";
  const stopOffset = input.stop != null ? stripOffset(input.stop, input) : null;
  const targetOffset = input.target != null ? stripOffset(input.target, input) : null;
  if (stopOffset != null && exitOffset <= stopOffset + 1e-9) return "stopped-out";
  if (targetOffset != null && exitOffset >= targetOffset - 1e-9) {
    return exitOffset > targetOffset + 1e-9 ? "beyond-target" : "ran-to-plan";
  }
  return "cut-early";
}

function project(value: number, left: number, span: number) {
  if (!(span > 0) || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, (value - left) / span));
}

/**
 * Lay out an R strip: stop on the left, target on the right, a tick at entry,
 * a marker at exit, and faint MAE/MFE ticks. Works without candles (no MAE/MFE)
 * and without a stop (price-offset domain). Returns null only when entry is unusable.
 */
export function rStripLayout(input: RStripInput): RStripLayout | null {
  if (!Number.isFinite(input.entry)) return null;

  const marks: number[] = [stripOffset(input.entry, input)]; // 0 when a stop exists
  const stopOffset = input.stop != null && Number.isFinite(input.stop) ? stripOffset(input.stop, input) : null;
  const targetOffset = input.target != null && Number.isFinite(input.target) ? stripOffset(input.target, input) : null;
  const exitOffset = input.exit != null && Number.isFinite(input.exit) ? stripOffset(input.exit, input) : null;
  const maeOffset = input.maePrice != null && Number.isFinite(input.maePrice) ? stripOffset(input.maePrice, input) : null;
  const mfeOffset = input.mfePrice != null && Number.isFinite(input.mfePrice) ? stripOffset(input.mfePrice, input) : null;

  if (stopOffset != null) marks.push(stopOffset);
  if (targetOffset != null) marks.push(targetOffset);
  if (exitOffset != null) marks.push(exitOffset);
  if (maeOffset != null) marks.push(maeOffset);
  if (mfeOffset != null) marks.push(mfeOffset);

  let left = Math.min(...marks);
  let right = Math.max(...marks);
  if (right <= left) {
    left -= 1;
    right += 1;
  }
  const span = right - left;

  // The exit marker's colour comes from money made or lost, never from the classification:
  // a cut-early loss is red, a cut-early win is green, a scratch exit is neutral.
  const exitOutcome: RStripOutcome | null = input.exit == null || !Number.isFinite(input.exit)
    ? null
    : favourable(input.direction, input.exit, input.entry) > 1e-9
      ? "favorable"
      : favourable(input.direction, input.exit, input.entry) < -1e-9
        ? "adverse"
        : "breakeven";

  return {
    stop: stopOffset == null ? null : project(stopOffset, left, span),
    target: targetOffset == null ? null : project(targetOffset, left, span),
    entry: project(stripOffset(input.entry, input), left, span),
    exit: exitOffset == null ? null : project(exitOffset, left, span),
    mae: maeOffset == null ? null : project(maeOffset, left, span),
    mfe: mfeOffset == null ? null : project(mfeOffset, left, span),
    kind: classify(input, exitOffset),
    exitOutcome,
  };
}

export type StripTrade = Pick<TradeRecord, "direction" | "entry_price" | "exit_price" | "stop_loss_price" | "planned_target_price">
  & Partial<Pick<TradeRecord, "initial_stop_price">>;

/**
 * The strip's 1R stop, by the rule of `riskStopPrice` (R-10): the initial stop when it is on the risk side of the
 * entry, else the current stop when it is. A stop trailed past the entry is not risk and never sets the axis.
 */
export function stripStop(trade: StripTrade): number | null {
  const riskSide = (stop: number | null | undefined): stop is number =>
    stop != null && Number.isFinite(stop) && favourable(trade.direction, stop, trade.entry_price) < 0;
  return riskSide(trade.initial_stop_price) ? trade.initial_stop_price : riskSide(trade.stop_loss_price) ? trade.stop_loss_price : null;
}

export function rStripInputFromTrade(
  trade: StripTrade,
  excursions?: { maePrice?: number | null; mfePrice?: number | null } | null,
): RStripInput {
  return {
    direction: trade.direction,
    entry: trade.entry_price,
    exit: trade.exit_price,
    stop: stripStop(trade),
    target: trade.planned_target_price,
    maePrice: excursions?.maePrice,
    mfePrice: excursions?.mfePrice,
  };
}

const KIND_LABEL: Record<RStripKind, string> = {
  "stopped-out": "Stopped out",
  "cut-early": "Cut early",
  "ran-to-plan": "Ran to plan",
  "beyond-target": "Ran past the target",
  "no-plan": "Entry to exit",
};

export function rStripLabel(kind: RStripKind, r: number | null, planned: number | null): string {
  const bits = [KIND_LABEL[kind]];
  if (r != null) bits.push(`exit ${r.toFixed(1)}R`);
  if (planned != null && (kind === "ran-to-plan" || kind === "beyond-target" || kind === "cut-early")) {
    bits.push(`plan ${planned.toFixed(1)}R`);
  }
  return bits.join(", ");
}

export function rStripCaption(trade: StripTrade, layout: RStripLayout) {
  const axis = { direction: trade.direction, entry: trade.entry_price, stop: stripStop(trade) };
  const r = trade.exit_price != null && axis.stop != null
    ? stripOffset(trade.exit_price, axis)
    : null;
  const planned = trade.planned_target_price != null && axis.stop != null
    ? stripOffset(trade.planned_target_price, axis)
    : null;
  return rStripLabel(layout.kind, r, planned);
}
