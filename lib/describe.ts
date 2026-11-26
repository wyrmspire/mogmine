// One sentence that says what the chart shows (UX-84). Used as the chart's text equivalent.
import { formatPrice } from "./format.ts";
import { formatDetailTime } from "./time.ts";
import { tradePoints } from "./trades.ts";
import type { RSizeOptions, TradeRecord } from "./trades.ts";
import { resolveRSize, resultR } from "./r-size.ts";

export function describeTrade(trade: TradeRecord, zone: string, privacy = false, opts?: RSizeOptions) {
  const r = resultR(trade, resolveRSize(trade, opts?.accounts, opts?.prefs));
  const points = tradePoints(trade);
  const result = r != null
    ? `${r >= 0 ? "plus" : "minus"} ${Math.abs(r).toFixed(2)} R`
    : points == null
      ? "result not available"
      : `${points >= 0 ? "plus" : "minus"} ${Math.abs(points)} points, ${trade.stop_loss_price == null ? "no stop recorded" : "R not available"}`;
  const size = privacy ? "" : `, ${trade.quantity} ${trade.quantity === 1 ? "contract" : "contracts"}`;
  return `${trade.direction === "LONG" ? "Long" : "Short"} ${trade.symbol}${size}, entered ${formatDetailTime(trade.entry_time, zone)} at ${formatPrice(trade.entry_price, trade.symbol)}, ${trade.exit_time == null || trade.exit_price == null ? "still open, no result yet" : `exited ${formatDetailTime(trade.exit_time, zone)} at ${formatPrice(trade.exit_price, trade.symbol)}, ${result}`}.`;
}
