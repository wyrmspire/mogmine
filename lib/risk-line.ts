// Copy for the Trade Detail risk line (docs/design-2026-11-24/04 §3.4). Pure: no DOM, no React, so the
// exact strings are unit-tested. `components/RiskLine.tsx` renders these and re-exports `formatRiskLine`.
// Under Shield (UX-64) no dollar sign or dollar amount appears anywhere in the output.
import { riskCents, riskComparison } from "./r-size.ts";
import type { ResolvedRSize } from "./r-size.ts";
import type { TradeRecord } from "./trades.ts";

/** Whole dollars print without cents ("$300"), otherwise two decimals ("$87.50"). Input is integer cents. */
export function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars)
    ? dollars.toLocaleString("en-US")
    : dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Two decimals for an R ratio: 0.2917 → "0.29". */
const ratioText = (value: number) => value.toFixed(2);
/** A stated risk without trailing zeros: 0.25 → "0.25", 1 → "1". */
const statedText = (value: number) => String(Number(value.toFixed(2)));

/**
 * The risk line for one trade, given its resolved R size. `primary` is the one-line answer; `sourceHint` says
 * where the R size came from (04 §3.2). Stated risk is shown only when it differs from the stop-width risk.
 */
export function formatRiskLine(
  trade: TradeRecord,
  rSize: ResolvedRSize,
  accountName: string | null,
  shield: boolean,
): { primary: string; sourceHint: string | null } {
  const { actual_r, stated_r, differs } = riskComparison(trade, rSize);
  const actualCents = riskCents(trade);
  const sourceHint = sourceHintText(rSize, accountName, shield);
  const statedCents = stated_r == null ? 0 : Math.round(stated_r * rSize.cents);

  if (actualCents == null || actual_r == null) {
    if (stated_r == null) return { primary: "No stop recorded", sourceHint };
    const said = shield ? `you said ${statedText(stated_r)}R` : `you said ${statedText(stated_r)}R (${formatDollars(statedCents)})`;
    return { primary: `No stop · ${said}`, sourceHint };
  }

  const suffix = stated_r != null && differs
    ? shield
      ? ` · you said ${statedText(stated_r)}R`
      : ` · you said ${statedText(stated_r)}R (${formatDollars(statedCents)})`
    : "";

  if (shield) return { primary: `Risk ${ratioText(actual_r)}R${suffix}`, sourceHint };

  const denominator = rSize.source === "prefs" ? `default ${formatDollars(rSize.cents)}` : formatDollars(rSize.cents);
  return { primary: `Risk ${formatDollars(actualCents)} · ${ratioText(actual_r)}R of ${denominator}${suffix}`, sourceHint };
}

function sourceHintText(rSize: ResolvedRSize, accountName: string | null, shield: boolean): string {
  if (rSize.source === "trade") return "R size frozen on this trade";
  if (rSize.source === "account") return `R size from ${accountName ?? "this account"}`;
  // Default R size. Shield hides the amount, so the hint never names it.
  if (accountName != null) return shield ? `${accountName} has no R size yet` : `${accountName} has no R size yet · using your default`;
  return shield ? "No account on this trade · using your default R size" : "No account on this trade · using your default";
}
