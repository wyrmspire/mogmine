// Strategy Lab R size (docs/design-2026-11-24/09 §6.4, D-A). R is the account's fixed dollar size, never a stop width.
// Pure: no I/O. It delegates to lib/r-size.ts so the fallback order matches the rest of the app:
// the account's R size, then prefs.riskBudgetUsd, then the $300 default.

import type { TradingAccount } from "../accounts.ts";
import { resolveRSize } from "../r-size.ts";
import type { Prefs } from "../prefs-sanitize.ts";

export interface LabRSize {
  usd: number;
  /** "account" when the account's own R size is used; "default" for the prefs or $300 default. */
  source: "account" | "default";
}

export function labRSize(
  accountId: string | null,
  accounts: readonly Pick<TradingAccount, "id" | "r_size_cents">[] = [],
  prefs?: Partial<Pick<Prefs, "riskBudgetUsd">> | null,
): LabRSize {
  const resolved = resolveRSize({ account_id: accountId }, accounts, prefs);
  return { usd: resolved.cents / 100, source: resolved.source === "account" ? "account" : "default" };
}

/** The basis line a screen shows once for its R numbers, for example "R = $300 (SIM Eval 50K)". */
export function rBasisLabel(rSize: LabRSize, accountName: string | null): string {
  const amount = Number.isInteger(rSize.usd) ? rSize.usd.toFixed(0) : rSize.usd.toFixed(2);
  const basis = rSize.source === "account" && accountName ? accountName : "default risk budget";
  return `R = $${amount} (${basis})`;
}
