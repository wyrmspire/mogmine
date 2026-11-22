// lib/exit-efficiency.ts — Time-in-trade duration & exit efficiency (M1, #42, docs/15 §3.4)
import { formatPoints, formatR } from "./format.ts";
import { rMultiple, tradePoints } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface ExitEfficiency {
  /** Realized R of the trade, or null if no initial stop was recorded */
  realizedR: number | null;
  /** Best price in favour during hold expressed in R, or null if no stop or no MFE */
  mfeR: number | null;
  /** Realized points gained or lost */
  realizedPoints: number | null;
  /** Maximum favourable excursion points */
  mfePoints: number | null;
  /** Ratio of realized gain to maximum available gain */
  efficiencyRatio: number | null;
  /** Efficiency rounded to integer percent (e.g. 57) */
  efficiencyPercent: number | null;
  /** Human-readable description, e.g. "captured +0.80R of +1.40R available (57%)" */
  summary: string;
  /** Short text for stats grid, e.g. "0.80R / 1.40R" */
  concise: string;
}

/**
 * Calculates exit efficiency comparing realized gain to the best gain available (MFE).
 * Uses R-multiples when a stop loss exists, falling back to points when no stop was set.
 */
export function calculateExitEfficiency(
  trade: TradeRecord,
  mfePoints: number | null,
): ExitEfficiency | null {
  if (trade.status === "open" || trade.exit_price == null) return null;

  const points = tradePoints(trade);
  const r = rMultiple(trade);

  // Stop distance for R calculation
  const initialStop = trade.initial_stop_price ?? trade.stop_loss_price;
  const riskDist = initialStop != null && Number.isFinite(initialStop)
    ? Math.abs(trade.entry_price - initialStop)
    : null;

  const mfeR = riskDist != null && riskDist > 0 && mfePoints != null && mfePoints > 0
    ? Math.round((mfePoints / riskDist) * 100) / 100
    : null;

  if (r != null && mfeR != null && mfeR > 0) {
    const ratio = r / mfeR;
    const percent = Math.round(ratio * 100);
    return {
      realizedR: r,
      mfeR,
      realizedPoints: points,
      mfePoints,
      efficiencyRatio: Math.round(ratio * 1000) / 1000,
      efficiencyPercent: percent,
      summary: `captured ${formatR(r)} of ${formatR(mfeR)} available (${percent}%)`,
      concise: `${formatR(r)} of ${formatR(mfeR)}`,
    };
  }

  // Fallback to points if no stop was set but MFE is available
  if (points != null && mfePoints != null && mfePoints > 0) {
    const ratio = points / mfePoints;
    const percent = Math.round(ratio * 100);
    const ptsStr = formatPoints(points, trade.symbol);
    const mfeStr = formatPoints(mfePoints, trade.symbol);
    return {
      realizedR: null,
      mfeR: null,
      realizedPoints: points,
      mfePoints,
      efficiencyRatio: Math.round(ratio * 1000) / 1000,
      efficiencyPercent: percent,
      summary: `captured ${ptsStr} of ${mfeStr} available (${percent}%)`,
      concise: `${ptsStr} of ${mfeStr}`,
    };
  }

  return null;
}
