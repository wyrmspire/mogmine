// Stop facts shown beside R in Trade Detail (docs/design-2026-11-24/05 §3.2). Pure: no I/O, no DOM, no React.
// Money is integer cents (Guardrail 4). R here is ACCOUNT R (D-A): cents ÷ the trade's resolved R size. Risk R and
// result R never read the moved stops (R-10); this module only reports what the moves did.
import type { ResolvedRSize } from "./r-size.ts";
import { hasWidenedStop, isWholeQuantity, toTicks, tickValueCents } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface ExitStopMismatch {
  exitPrice: number;
  workingStopPrice: number;
  diffTicks: number;
}

/** A stop more than this many ticks from the exit is flagged as slippage (05 §3.2). */
const EXIT_SLIPPAGE_TICKS = 2;

const centsOf = (rSize: ResolvedRSize | number): number => (typeof rSize === "number" ? rSize : rSize.cents);
const sideOf = (direction: TradeRecord["direction"]): 1 | -1 => (direction === "LONG" ? 1 : -1);

/** The working stop at exit: the last stop move, else the current stop. Null when the trade has no stop. */
export function workingStopAtExit(trade: TradeRecord): number | null {
  const lastMove = trade.stop_moves?.at(-1);
  return lastMove?.price ?? trade.stop_loss_price ?? null;
}

/**
 * Widest risk the stop ever carried (account R). Only when a move widened the stop (`hasWidenedStop`); otherwise null.
 * Candidates are the initial stop and every move; only candidates on the risk side of entry count.
 */
export function widestRisk(trade: TradeRecord, rSize: ResolvedRSize | number): { cents: number; r: number } | null {
  if (!hasWidenedStop(trade)) return null;
  const entryTicks = toTicks(trade.entry_price, trade.symbol);
  const value = tickValueCents(trade.symbol);
  const rCents = centsOf(rSize);
  if (entryTicks == null || value == null || !isWholeQuantity(trade.quantity) || !(rCents > 0)) return null;
  const sign = sideOf(trade.direction);
  const prices = [trade.initial_stop_price, ...(trade.stop_moves ?? []).map((move) => move.price)];
  let maxRiskTicks = 0;
  for (const price of prices) {
    const ticks = price == null ? null : toTicks(price, trade.symbol);
    if (ticks == null) continue;
    maxRiskTicks = Math.max(maxRiskTicks, (entryTicks - ticks) * sign);
  }
  if (maxRiskTicks <= 0) return null;
  const cents = maxRiskTicks * value * trade.quantity;
  return { cents, r: cents / rCents };
}

/**
 * Locked profit (account R) when the working stop at exit sits strictly on the profit side of entry. Null at entry,
 * on the risk side, or without a usable stop.
 */
export function lockedR(trade: TradeRecord, rSize: ResolvedRSize | number): { cents: number; r: number } | null {
  const stop = workingStopAtExit(trade);
  const entryTicks = toTicks(trade.entry_price, trade.symbol);
  const stopTicks = stop == null ? null : toTicks(stop, trade.symbol);
  const value = tickValueCents(trade.symbol);
  const rCents = centsOf(rSize);
  if (entryTicks == null || stopTicks == null || value == null || !isWholeQuantity(trade.quantity) || !(rCents > 0)) return null;
  const profitTicks = (stopTicks - entryTicks) * sideOf(trade.direction);
  if (!(profitTicks > 0)) return null;
  const cents = profitTicks * value * trade.quantity;
  return { cents, r: cents / rCents };
}

/**
 * An exit on a stop or trailed stop that sits more than 2 ticks from the working stop at exit. Closed trades only.
 */
export function checkExitStopConsistency(trade: TradeRecord): ExitStopMismatch | null {
  if (trade.status !== "closed" || trade.exit_price == null) return null;
  if (trade.exit_reason !== "stop" && trade.exit_reason !== "trail") return null;
  const stop = workingStopAtExit(trade);
  if (stop == null) return null;
  const exitTicks = toTicks(trade.exit_price, trade.symbol);
  const stopTicks = toTicks(stop, trade.symbol);
  if (exitTicks == null || stopTicks == null) return null;
  const diffTicks = Math.abs(exitTicks - stopTicks);
  if (diffTicks <= EXIT_SLIPPAGE_TICKS) return null;
  return { exitPrice: trade.exit_price, workingStopPrice: stop, diffTicks };
}

/**
 * 05 §3.1 stop-move checks, for the command layer. Returns the refusal message, or null when the moves are valid:
 * every move sits in [entry, exit] (the exit bound once closed), and the working stop equals the last move. The
 * trade's moves are already time-sorted and stable (sanitizeStopMoves), so the last one is the latest.
 */
export function stopMoveError(trade: TradeRecord, entryAt: number, exitAt: number): string | null {
  const moves = trade.stop_moves ?? [];
  const outside = moves.some((move) => {
    const at = Date.parse(move.time);
    return at < entryAt || (trade.status === "closed" && at > exitAt);
  });
  if (outside) return "A stop move must fall between entry and exit.";
  const lastMove = moves.at(-1);
  if (lastMove && toTicks(lastMove.price, trade.symbol) !== toTicks(trade.stop_loss_price ?? NaN, trade.symbol)) {
    return `The working stop must equal the last stop move (${lastMove.price.toFixed(2)}).`;
  }
  return null;
}
