// lib/exit-efficiency.ts — Time-in-trade duration & exit efficiency (M1, #42, docs/15 §3.4)
import { specFor, isScratch, isWholeQuantity, tickValueCents, tradePoints } from "./trades.ts";
import type { RSizeOptions, TradeRecord } from "./trades.ts";
import { resolveRSize, resultR } from "./r-size.ts";
import { formatPoints } from "./format.ts";

export interface ExitEfficiency {
  /** Realized account R (`resultR`: P&L ÷ R size), or null when P&L cannot be computed */
  realizedR: number | null;
  /** Best price in favour during hold, in account R (MFE dollars ÷ R size), or null without a MFE or a tick value */
  mfeR: number | null;
  /** Realized points gained or lost */
  realizedPoints: number | null;
  /** Maximum favourable excursion points */
  mfePoints: number | null;
  /** Share of the best open profit that was kept, 0–1. Null for a loss, a scratch or an MFE under 2 ticks. Unit-free. */
  efficiencyRatio: number | null;
  /** Efficiency rounded to integer percent (e.g. 57), 0–100. Null when `efficiencyRatio` is. */
  efficiencyPercent: number | null;
  /** Human-readable description, e.g. "captured +2.05R of +2.60R available (79%)" */
  summary: string;
  /** Short text for stats grid, e.g. "+2.05R of +2.60R" */
  concise: string;
}

/** Account R with two decimals, so a 0.25R trade reads "−0.25R" (04 §3.1). `—R` when missing. */
function formatAccountR(r: number | null) {
  if (r == null || !Number.isFinite(r)) return "—R";
  return `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(2)}R`;
}

/**
 * Exit efficiency: how much of the best open profit (MFE) a winning exit kept. The ratio is unit-free
 * (points captured ÷ MFE points). The R figures in the text are account R (`resultR`, 04 §3.5).
 *
 * Only a winner has an efficiency. Realised ÷ MFE is unbounded for a loss (a −1R stop-out after +0.18R of MFE
 * reads −550 %), so a loss or a scratch gets no percentage, only the facts ("closed at −1.00R; best was +0.18R").
 * An MFE under 2 ticks is noise, not an opportunity. A winner is clamped to 100 % because MFE is estimated from
 * bars and can sit a tick under the fill.
 */
export function calculateExitEfficiency(
  trade: TradeRecord,
  mfePoints: number | null,
  opts?: RSizeOptions,
): ExitEfficiency | null {
  if (trade.status === "open" || trade.exit_price == null) return null;
  const points = tradePoints(trade);
  if (points == null || mfePoints == null || !(mfePoints > 0)) return null;

  const rSize = resolveRSize(trade, opts?.accounts, opts?.prefs);
  const r = resultR(trade, rSize);
  // MFE dollars: points → ticks → cents × quantity, then ÷ R size. Null without a tick value or a valid quantity.
  const spec = specFor(trade.symbol);
  const tickCents = tickValueCents(trade.symbol);
  const mfeCents = spec && tickCents != null && isWholeQuantity(trade.quantity) ? (mfePoints / spec.tickSize) * tickCents * trade.quantity : null;
  const mfeR = mfeCents != null && rSize.cents > 0 ? Math.round(mfeCents) / rSize.cents : null;
  // Account R when both ends are known; points otherwise (the same fallback as before).
  const inR = r != null && mfeR != null;
  const realized = inR ? formatAccountR(r) : formatPoints(points, trade.symbol);
  const best = inR ? formatAccountR(mfeR) : formatPoints(mfePoints, trade.symbol);
  const base = { realizedR: inR ? r : null, mfeR: inR ? mfeR : null, realizedPoints: points, mfePoints };

  const tick = spec?.tickSize ?? 0.25;
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
