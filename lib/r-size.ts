// Per-account R size (docs/design-2026-11-24/04 §3): 1R is a fixed dollar amount per account, not a stop width.
// Pure: no I/O, no DOM, no React. Money is integer cents (AGENTS guardrail 4); the only float is the final ratio.
//
// - resultR  = gross P&L ÷ R size. Defined for any closed trade with a computable P&L, stop or no stop.
// - riskR    = actual initial-stop dollars ÷ R size. Null without a stop or a stated risk, never 0.
// - statedRiskR is what the trader said (`stated_risk_r`). It is never computed from the stop.

import type { TradingAccount } from "./accounts.ts";
import type { Prefs } from "./prefs-sanitize.ts";
import { isWholeQuantity, riskStopPrice, toTicks, tickValueCents, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export type RSizeSource = "trade" | "account" | "prefs";
export interface ResolvedRSize {
  cents: number;
  source: RSizeSource;
  account_id: string | null;
}

export const MIN_R_SIZE_CENTS = 100; // $1.00
export const MAX_R_SIZE_CENTS = 10_000_000; // $100,000.00
export const DEFAULT_R_SIZE_CENTS = 30_000; // $300.00, the owner's locked standard 1R unit

export interface AtLeastPositionSize {
  contracts: number;
  actualRiskCents: number;
  overshootCents: number;
}

/**
 * Whole-contract "at-least" position sizing in integer ticks/cents:
 * returns the smallest whole contract count (>= 1) whose initial risk is >= targetCents,
 * overshooting targetCents by strictly less than 1 contract's risk.
 */
export function sizeContractsAtLeast(
  targetCents: number,
  stopDistanceTicks: number,
  symbol: string,
): AtLeastPositionSize | null {
  const tickCents = tickValueCents(symbol);
  if (
    tickCents == null ||
    tickCents <= 0 ||
    !Number.isFinite(targetCents) ||
    targetCents <= 0 ||
    !Number.isInteger(stopDistanceTicks) ||
    stopDistanceTicks <= 0
  ) {
    return null;
  }
  const target = Math.round(targetCents);
  if (target <= 0) return null;
  const singleContractRiskCents = stopDistanceTicks * tickCents;
  if (!(singleContractRiskCents > 0)) return null;
  const contracts = Math.max(1, Math.ceil(target / singleContractRiskCents));
  const actualRiskCents = contracts * singleContractRiskCents;
  return {
    contracts,
    actualRiskCents,
    overshootCents: actualRiskCents - target,
  };
}

/** A whole-cent R size between $1 and $100,000. */
export function isValidRSizeCents(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_R_SIZE_CENTS && (value as number) <= MAX_R_SIZE_CENTS;
}

/** A stated risk such as 0.25: finite, above 0, at most 10, at most two decimal places. */
export function isValidStatedRiskR(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10) return false;
  return Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
}

/**
 * The R size a trade is measured in. Order: the trade's frozen `r_size_cents` (D-B), then its account's R size,
 * then the default risk budget from prefs (Q-12, Q-13). Unassigned trades go straight to the default.
 */
export function resolveRSize(
  trade: Pick<TradeRecord, "account_id"> & Partial<Pick<TradeRecord, "r_size_cents">>,
  accounts: readonly Pick<TradingAccount, "id" | "r_size_cents">[] = [],
  prefs?: Partial<Pick<Prefs, "riskBudgetUsd">> | null,
): ResolvedRSize {
  const accountId = trade.account_id ?? null;
  if (isValidRSizeCents(trade.r_size_cents)) return { cents: trade.r_size_cents, source: "trade", account_id: accountId };
  const account = accountId == null ? undefined : accounts.find((item) => item.id === accountId);
  if (account && isValidRSizeCents(account.r_size_cents)) return { cents: account.r_size_cents, source: "account", account_id: accountId };
  const budget = prefs?.riskBudgetUsd;
  const budgetCents = typeof budget === "number" && Number.isFinite(budget) ? Math.round(budget * 100) : NaN;
  const cents = isValidRSizeCents(budgetCents) ? budgetCents : DEFAULT_R_SIZE_CENTS;
  return { cents, source: "prefs", account_id: accountId };
}

/** The R size as cents, whichever form the caller holds. */
function centsOf(rSize: ResolvedRSize | number): number {
  return typeof rSize === "number" ? rSize : rSize.cents;
}

/**
 * Actual dollars risked, in integer cents: |entry − stop| in ticks × tick value × quantity. The stop is
 * `riskStopPrice` (the initial stop when it is on the risk side, else the working stop). Null without a valid
 * risk-side stop, an unknown symbol or an invalid quantity.
 */
export function riskCents(
  trade: Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "quantity" | "stop_loss_price"> &
    Partial<Pick<TradeRecord, "initial_stop_price">>,
): number | null {
  const stop = riskStopPrice({ ...trade, exit_price: null, initial_stop_price: trade.initial_stop_price ?? null });
  const value = tickValueCents(trade.symbol);
  if (stop == null || value == null || !isWholeQuantity(trade.quantity)) return null;
  const entryTicks = toTicks(trade.entry_price, trade.symbol);
  const stopTicks = toTicks(stop, trade.symbol);
  if (entryTicks == null || stopTicks == null) return null;
  return Math.abs(entryTicks - stopTicks) * trade.quantity * value;
}

/** Result in account R: gross P&L ÷ R size. Closed trades only. Works without a stop. Null when P&L cannot be computed. */
export function resultR(trade: TradeRecord, rSize: ResolvedRSize | number): number | null {
  const cents = centsOf(rSize);
  if (trade.exit_time == null || trade.exit_price == null || !(cents > 0)) return null;
  const pnl = tradePnl(trade);
  return pnl == null ? null : Math.round(pnl * 100) / cents;
}

/** Actual risk in account R. Falls back to the stated risk when there is no stop. Null otherwise, never 0. */
export function riskR(
  trade: Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "quantity" | "stop_loss_price"> &
    Partial<Pick<TradeRecord, "initial_stop_price" | "risk_cents" | "stated_risk_r">>,
  rSize: ResolvedRSize | number,
): number | null {
  const cents = centsOf(rSize);
  if (!(cents > 0)) return null;
  const actual = riskCents(trade);
  if (actual != null) return actual / cents;
  return trade.stated_risk_r ?? null;
}

/**
 * Actual and stated risk side by side (04 §3.4).
 * Under the owner's whole-micro "at-least" ceiling rule, overshooting statedTargetCents by strictly less than
 * 1 contract's risk counts as matching (`differs = false`). Otherwise `differs` when apart by at least
 * 0.02R or one tick × quantity in dollars, whichever is larger.
 */
export function riskComparison(
  trade: Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "quantity" | "stop_loss_price"> &
    Partial<Pick<TradeRecord, "initial_stop_price" | "risk_cents" | "stated_risk_r">>,
  rSize: ResolvedRSize | number,
): { actual_r: number | null; stated_r: number | null; differs: boolean } {
  const cents = centsOf(rSize);
  const actualCents = riskCents(trade);
  const statedR = trade.stated_risk_r ?? null;
  const actual_r = actualCents != null && cents > 0 ? actualCents / cents : null;
  let differs = false;
  if (actualCents != null && statedR != null && cents > 0) {
    const statedTargetCents = Math.round(statedR * cents);
    const tickCents = tickValueCents(trade.symbol) ?? 0;
    const stop = riskStopPrice({ ...trade, exit_price: null, initial_stop_price: trade.initial_stop_price ?? null });
    const entryTicks = toTicks(trade.entry_price, trade.symbol);
    const stopTicks = stop == null ? null : toTicks(stop, trade.symbol);
    const singleContractRiskCents =
      entryTicks != null && stopTicks != null && tickCents > 0
        ? Math.abs(entryTicks - stopTicks) * tickCents
        : 0;
    const withinAtLeastCeiling =
      singleContractRiskCents > 0 &&
      actualCents >= statedTargetCents &&
      actualCents - statedTargetCents < singleContractRiskCents;
    if (!withinAtLeastCeiling) {
      const tolerance = Math.max(0.02 * cents, tickCents * trade.quantity);
      differs = Math.abs(actualCents - statedTargetCents) >= tolerance;
    }
  }
  return { actual_r, stated_r: statedR, differs };
}
