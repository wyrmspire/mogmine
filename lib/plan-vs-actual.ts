// lib/plan-vs-actual.ts — Planned vs. Actual execution comparison (M2, #42, BET-06)
import { formatPoints, formatPrice, formatR } from "./format.ts";
import { hasWidenedStop, plannedR, rMultiple } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

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
export function derivePlanVsActual(trade: TradeRecord): PlanVsActualComparison {
  const symbol = trade.symbol;
  const isLong = trade.direction === "LONG";
  const sign = isLong ? 1 : -1;

  const actualEntry = trade.entry_price;
  const actualExit = trade.exit_price;
  const initialStop = trade.initial_stop_price ?? trade.stop_loss_price;
  const plannedTarget = trade.planned_target_price;

  const hasPlan = initialStop != null || plannedTarget != null;

  const realizedR = rMultiple(trade);
  const planR = plannedR(trade);

  const initialRisk = initialStop != null ? Math.abs(actualEntry - initialStop) : null;

  const rows: PlanVsActualRow[] = [];

  // Stop comparison
  if (initialStop != null) {
    const currentStop = trade.stop_loss_price ?? initialStop;
    const stopDeltaPts = (currentStop - initialStop) * sign;
    const stopDeltaR = initialRisk && initialRisk > 0 ? stopDeltaPts / initialRisk : null;
    let stopTone: PlanVsActualRow["tone"] = "neutral";
    let stopDeltaStr = "—";
    if (Math.abs(currentStop - initialStop) > 0.0001) {
      if (stopDeltaPts > 0) {
        stopTone = "positive"; // trailed closer to profit
        stopDeltaStr = `+${formatPoints(stopDeltaPts, symbol)} (${formatR(stopDeltaR)})`;
      } else {
        stopTone = "negative"; // widened away from profit
        stopDeltaStr = `${formatPoints(stopDeltaPts, symbol)} (${formatR(stopDeltaR)})`;
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

  // Target vs Actual Exit
  if (plannedTarget != null && actualExit != null) {
    const exitDeltaPts = (actualExit - plannedTarget) * sign;
    const exitDeltaR = initialRisk && initialRisk > 0 ? exitDeltaPts / initialRisk : null;
    let exitTone: PlanVsActualRow["tone"] = "neutral";
    let exitDeltaStr = "—";
    if (Math.abs(actualExit - plannedTarget) > 0.0001) {
      if (exitDeltaPts >= 0) {
        exitTone = "positive";
        exitDeltaStr = `+${formatPoints(exitDeltaPts, symbol)} (${formatR(exitDeltaR)})`;
      } else {
        exitTone = "negative";
        exitDeltaStr = `${formatPoints(exitDeltaPts, symbol)} (${formatR(exitDeltaR)})`;
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

  // Risk / Reward comparison (R)
  if (planR != null && realizedR != null) {
    const deltaR = realizedR - planR;
    const tone: PlanVsActualRow["tone"] = deltaR >= 0 ? "positive" : "negative";
    rows.push({
      label: "Result (R)",
      planned: formatR(planR),
      actual: formatR(realizedR),
      deltaPoints: null,
      deltaR,
      deltaDisplay: formatR(deltaR),
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
