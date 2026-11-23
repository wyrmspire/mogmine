// lib/exit-efficiency.ts — Time-in-trade duration & exit efficiency (M1, #42, docs/15 §3.4)
import { formatPoints, formatR } from "./format.ts";
import { isScratch, riskStopPrice, rMultiple, specFor, tradePoints } from "./trades.ts";
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
  /** Share of the best open profit that was kept, 0–1. Null for a loss, a scratch or an MFE under 2 ticks. */
  efficiencyRatio: number | null;
  /** Efficiency rounded to integer percent (e.g. 57), 0–100. Null when `efficiencyRatio` is. */
  efficiencyPercent: number | null;
  /** Human-readable description, e.g. "captured +0.80R of +1.40R available (57%)" */
  summary: string;
  /** Short text for stats grid, e.g. "0.80R / 1.40R" */
  concise: string;
}

/**
 * Exit efficiency: how much of the best open profit (MFE) a winning exit kept. Uses R on the first risk
 * (`riskStopPrice`, R-10) when there is one, points otherwise.
 *
 * Only a winner has an efficiency. Realised ÷ MFE is unbounded for a loss (a −1R stop-out after +0.18R of MFE
 * reads −550 %), so a loss or a scratch gets no percentage, only the facts ("closed at −1.0R; best was +0.18R").
 * An MFE under 2 ticks is noise, not an opportunity. A winner is clamped to 100 % because MFE is estimated from
 * bars and can sit a tick under the fill.
 */
export function calculateExitEfficiency(
  trade: TradeRecord,
  mfePoints: number | null,
): ExitEfficiency | null {
  if (trade.status === "open" || trade.exit_price == null) return null;
  const points = tradePoints(trade);
  if (points == null || mfePoints == null || !(mfePoints > 0)) return null;

  const r = rMultiple(trade);
  const stop = riskStopPrice(trade);
  const riskDist = stop != null ? Math.abs(trade.entry_price - stop) : null;
  const mfeR = r != null && riskDist != null && riskDist > 0 ? Math.round((mfePoints / riskDist) * 100) / 100 : null;
  const inR = r != null && mfeR != null;
  const realized = inR ? formatR(r) : formatPoints(points, trade.symbol);
  const best = inR ? formatR(mfeR) : formatPoints(mfePoints, trade.symbol);
  const base = { realizedR: inR ? r : null, mfeR: inR ? mfeR : null, realizedPoints: points, mfePoints };

  const tick = specFor(trade.symbol)?.tickSize ?? 0.25;
  if (points > 0 && mfePoints >= 2 * tick && !isScratch(trade)) {
    const ratio = Math.min(1, points / mfePoints);
    const percent = Math.round(ratio * 100);
    return {
      ...base,
      efficiencyRatio: Math.round(ratio * 1000) / 1000,
      efficiencyPercent: percent,
      summary: `captured ${realized} of ${best} available (${percent}%)`,
      concise: `${realized} of ${best}`,
    };
  }
  const verb = isScratch(trade) ? "scratched at" : "closed at";
  return {
    ...base,
    efficiencyRatio: null,
    efficiencyPercent: null,
    summary: `${verb} ${realized}; best was ${best}`,
    concise: `${realized} · best ${best}`,
  };
}
