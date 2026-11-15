// One sentence that says what the chart shows (UX-84). Used as the chart's text equivalent.
import { formatPrice } from "./format.ts";
import { formatDetailTime } from "./time.ts";
import { rMultiple, tradePoints } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export function describeTrade(trade: TradeRecord, zone: string, privacy = false) {
  const r = rMultiple(trade);
  const points = tradePoints(trade);
  const result = r != null
    ? `${r >= 0 ? "plus" : "minus"} ${Math.abs(r).toFixed(1)} R`
    : points == null
      ? "result not available"
      : `${points >= 0 ? "plus" : "minus"} ${Math.abs(points)} points, ${trade.stop_loss_price == null ? "no stop recorded" : "stop not usable for R"}`;
  const size = privacy ? "" : `, ${trade.quantity} ${trade.quantity === 1 ? "contract" : "contracts"}`;
  return `${trade.direction === "LONG" ? "Long" : "Short"} ${trade.symbol}${size}, entered ${formatDetailTime(trade.entry_time, zone)} at ${formatPrice(trade.entry_price, trade.symbol)}, exited ${formatDetailTime(trade.exit_time, zone)} at ${formatPrice(trade.exit_price, trade.symbol)}, ${result}.`;
}
