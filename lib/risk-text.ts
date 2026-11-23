// The stop facts the trade panel shows next to R (R-10). Pure, no I/O.
import { formatPrice } from "./format.ts";
import { isStopMoveWidening, riskStopPrice } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

type StopTrade = Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "exit_price" | "quantity" | "stop_loss_price">
  & Partial<Pick<TradeRecord, "initial_stop_price" | "initial_stop_set_at">>;

/**
 * `Initial stop 7444.00, set 08:41 · stop trailed to 7350.00` once the working stop has moved, so a trailed stop is
 * shown beside the R it no longer sets. Without an initial stop, a stop past the entry says why R is blank.
 * Null when there is nothing to add.
 */
export function stopHistoryText(trade: StopTrade, formatTime: (iso: string) => string): string | null {
  const { initial_stop_price: initial, stop_loss_price: current, symbol } = trade;
  if (initial != null && current != null && initial !== current) {
    const verb = isStopMoveWidening(initial, current, trade.direction, symbol) ? "widened" : "trailed";
    const set = trade.initial_stop_set_at && Number.isFinite(Date.parse(trade.initial_stop_set_at)) ? `, set ${formatTime(trade.initial_stop_set_at)}` : "";
    return `Initial stop ${formatPrice(initial, symbol)}${set} · stop ${verb} to ${formatPrice(current, symbol)}`;
  }
  if (initial == null && current != null && riskStopPrice(trade) == null) {
    return `Stop ${formatPrice(current, symbol)} is not on the risk side of the entry and no initial stop is recorded, so R is not known.`;
  }
  return null;
}
