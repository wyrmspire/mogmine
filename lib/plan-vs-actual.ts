// lib/plan-vs-actual.ts — Planned vs. Actual execution comparison (M2, #42, BET-06)
import { formatPoints, formatPrice } from "./format.ts";
import { hasWidenedStop, isScratch, isWholeQuantity, plannedRewardRisk, specFor, tickValueCents, toTicks } from "./trades.ts";
import type { RSizeOptions, TradeRecord } from "./trades.ts";
import { resolveRSize, resultR } from "./r-size.ts";

/** Account R with two decimals (04 §3.1): `+2.05R`, `−0.25R`. `—R` when missing. */
function formatAccountR(r: number | null) {
  if (r == null || !Number.isFinite(r)) return "—R";
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(2)}R`;
}

/** A price move in points, as account R: dollars (points × $/tick ÷ tick × quantity) ÷ R size. Null when unpriceable. */
function pointsToAccountR(points: number, trade: TradeRecord, rSizeCents: number): number | null {
  const spec = specFor(trade.symbol);
  const tickCents = tickValueCents(trade.symbol);
  if (!spec || tickCents == null || !isWholeQuantity(trade.quantity) || !(rSizeCents > 0)) return null;
  return Math.round(points / spec.tickSize * tickCents * trade.quantity) / rSizeCents;
}

export interface PlanVsActualRow {
  label: string;
  planned: string;
  actual: string;
  deltaPoints: number | null;
  deltaR: number | null;
  deltaDisplay: string;
  tone: "positive" | "negative" | "neutral" | "muted";
}

export type ExecutionFidelity =
  | "Executed to Plan"
  | "Chased Entry"
  | "Favourable Fill"
  | "Premature Exit"
  | "Stopped Out"
  | "Trailed Stop Hit"
  | "Scratch"
  | "Extended Target"
  | "Widened Stop"
  | "No Plan Recorded";

export interface PlanVsActualComparison {
  tradeId: string;
  fidelity: ExecutionFidelity;
  fidelityNote: string;
  rows: PlanVsActualRow[];
  hasPlan: boolean;
}

/**
 * Pure selector comparing what the trader planned against what actually happened.
 */
export function derivePlanVsActual(trade: TradeRecord, opts?: RSizeOptions): PlanVsActualComparison {
  const rSize = resolveRSize(trade, opts?.accounts, opts?.prefs).cents;
  const symbol = trade.symbol;
  const isLong = trade.direction === "LONG";
  const sign = isLong ? 1 : -1;

  const actualEntry = trade.entry_price;
  const actualExit = trade.exit_price;
  const initialStop = trade.initial_stop_price ?? trade.stop_loss_price;
  const plannedTarget = trade.planned_target_price;

  const hasPlan = initialStop != null || plannedTarget != null;

  // Account R (04 §3.5): the realised result, and the plan's reward:risk ratio (shown as `R:R`, never as R).
  const realizedR = resultR(trade, rSize);
  const planRR = plannedRewardRisk(trade);

  const stopOut = stopOutcome(trade);
  // Price differences measured in account R (dollar diff ÷ R size). Null without a priceable trade.
  const toR = (points: number) => pointsToAccountR(points, trade, rSize);

  const rows: PlanVsActualRow[] = [];

  // Stop comparison
  if (initialStop != null) {
    const currentStop = trade.stop_loss_price ?? initialStop;
    const stopDeltaPts = (currentStop - initialStop) * sign;
    const stopDeltaR = toR(stopDeltaPts);
    let stopTone: PlanVsActualRow["tone"] = "neutral";
    let stopDeltaStr = "—";
    if (Math.abs(currentStop - initialStop) > 0.0001) {
      if (stopDeltaPts > 0) {
        stopTone = "positive"; // trailed closer to profit
        stopDeltaStr = `+${formatPoints(stopDeltaPts, symbol)} (${formatAccountR(stopDeltaR)})`;
      } else {
        stopTone = "negative"; // widened away from profit
        stopDeltaStr = `${formatPoints(stopDeltaPts, symbol)} (${formatAccountR(stopDeltaR)})`;
      }
    }
    rows.push({
      label: "Stop",
      planned: formatPrice(initialStop, symbol),
      actual: formatPrice(currentStop, symbol),
      deltaPoints: stopDeltaPts,
      deltaR: stopDeltaR,
      deltaDisplay: stopDeltaStr,
      tone: stopTone,
    });
  }

  // On a stop-out the exit is compared with the stop it hit (slippage), never with the target it never reached.
  if (stopOut && actualExit != null && trade.stop_loss_price != null) {
    const slipPts = (actualExit - trade.stop_loss_price) * sign;
    const slipR = toR(slipPts);
    const slipped = Math.abs(slipPts) > 0.0001;
    rows.push({
      label: "Exit / Stop",
      planned: formatPrice(trade.stop_loss_price, symbol),
      actual: formatPrice(actualExit, symbol),
      deltaPoints: slipPts,
      deltaR: slipR,
      deltaDisplay: slipped ? `${slipPts > 0 ? "+" : ""}${formatPoints(slipPts, symbol)} (${formatAccountR(slipR)})` : "—",
      tone: !slipped ? "neutral" : slipPts > 0 ? "positive" : "negative",
    });
  } else if (plannedTarget != null && actualExit != null) {
    const exitDeltaPts = (actualExit - plannedTarget) * sign;
    const exitDeltaR = toR(exitDeltaPts);
    let exitTone: PlanVsActualRow["tone"] = "neutral";
    let exitDeltaStr = "—";
    if (Math.abs(actualExit - plannedTarget) > 0.0001) {
      if (exitDeltaPts >= 0) {
        exitTone = "positive";
        exitDeltaStr = `+${formatPoints(exitDeltaPts, symbol)} (${formatAccountR(exitDeltaR)})`;
      } else {
        exitTone = "negative";
        exitDeltaStr = `${formatPoints(exitDeltaPts, symbol)} (${formatAccountR(exitDeltaR)})`;
      }
    }
    rows.push({
      label: "Exit / Target",
      planned: formatPrice(plannedTarget, symbol),
      actual: formatPrice(actualExit, symbol),
      deltaPoints: exitDeltaPts,
      deltaR: exitDeltaR,
      deltaDisplay: exitDeltaStr,
      tone: exitTone,
    });
  }

  // Result comparison: the plan's reward at target in account R against the realised account R.
  // The plan's reward:risk ratio is shown as `R:R 2.0:1` (never `2.0R`).
  const plannedTargetR = plannedTarget != null && planRR != null ? toR((plannedTarget - actualEntry) * sign) : null;
  if (planRR != null && realizedR != null && plannedTargetR != null) {
    const deltaR = realizedR - plannedTargetR;
    const tone: PlanVsActualRow["tone"] = deltaR >= 0 ? "positive" : "negative";
    rows.push({
      label: "Result (R)",
      // The plan's reward is the target over the first risk: always positive.
      planned: `R:R ${planRR.toFixed(1)}:1 at target`,
      actual: formatAccountR(realizedR),
      deltaPoints: null,
      deltaR,
      deltaDisplay: formatAccountR(deltaR),
      tone,
    });
  }

  // Classify fidelity
  let fidelity: ExecutionFidelity = "Executed to Plan";
  let fidelityNote = "Trade executed according to recorded plan.";

  if (!hasPlan) {
    fidelity = "No Plan Recorded";
    fidelityNote = "No stop loss or target was planned for this trade.";
  } else if (hasWidenedStop(trade)) {
    fidelity = "Widened Stop";
    fidelityNote = "Stop loss was moved farther from entry during the trade.";
  } else if (stopOut === "stop") {
    fidelity = "Stopped Out";
    fidelityNote = "Exited at the stop: the planned risk, taken as planned.";
  } else if (stopOut === "trail") {
    fidelity = "Trailed Stop Hit";
    fidelityNote = `Exited on the moved stop at ${formatPrice(trade.stop_loss_price!, symbol)}${realizedR != null ? `, ${formatAccountR(realizedR)}` : ""}.`;
  } else if (isScratch(trade)) {
    fidelity = "Scratch";
    fidelityNote = "Closed within a scratch of the entry.";
  } else if (plannedTarget != null && actualExit != null) {
    const exitDeltaPts = (actualExit - plannedTarget) * sign;
    if (exitDeltaPts < -0.5) {
      fidelity = "Premature Exit";
      fidelityNote = `Exited ${formatPoints(Math.abs(exitDeltaPts), symbol)} before reaching planned target.`;
    } else if (exitDeltaPts > 0.5) {
      fidelity = "Extended Target";
      fidelityNote = `Exited ${formatPoints(exitDeltaPts, symbol)} beyond planned target.`;
    }
  }

  return {
    tradeId: trade.id,
    fidelity,
    fidelityNote,
    rows,
    hasPlan,
  };
}

/**
 * How a closed trade met its working stop: `stop` when it exited at or through a stop still on the risk side,
 * `trail` when that stop had been moved to or past the entry, null otherwise. The trader's own exit reason wins.
 */
export function stopOutcome(trade: TradeRecord): "stop" | "trail" | null {
  if (trade.exit_reason === "trail") return "trail";
  const sign = trade.direction === "LONG" ? 1 : -1;
  const stop = trade.stop_loss_price == null ? null : toTicks(trade.stop_loss_price, trade.symbol);
  const entry = toTicks(trade.entry_price, trade.symbol);
  // "Stop" picked on a stop already moved to or past the entry is a trailed stop, not the planned risk.
  if (trade.exit_reason === "stop") return stop != null && entry != null && (entry - stop) * sign <= 0 ? "trail" : "stop";
  if (trade.exit_reason || trade.exit_price == null || stop == null) return null;
  const exit = toTicks(trade.exit_price, trade.symbol);
  if (exit == null || stop == null || entry == null || (exit - stop) * sign > 0) return null;
  return (entry - stop) * sign > 0 ? "stop" : "trail";
}
