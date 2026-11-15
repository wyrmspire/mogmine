import { formatPoints, formatPrice } from "@/lib/format";
import type { TradeRecord } from "@/lib/trades";

/** Shown in place of a blank chart when a trade has no candles: the trade on a price axis (docs/08 §4). */
export function PriceLadder({ trade }: { trade: TradeRecord }) {
  const sign = trade.direction === "LONG" ? 1 : -1;
  const rows = [
    { key: "target", label: "Target", price: trade.planned_target_price, tone: "profit" },
    { key: "exit", label: "Exit", price: trade.exit_price, tone: "exit" },
    { key: "entry", label: "Entry", price: trade.entry_price, tone: "entry" },
    { key: "key", label: "Key level", price: trade.key_level_price, tone: "key" },
    { key: "stop", label: "Stop", price: trade.stop_loss_price, tone: "risk" },
  ].filter((row): row is typeof row & { price: number } => row.price != null).sort((a, b) => b.price - a.price);
  return (
    <ol className="ladder" aria-label="Trade prices, highest first">
      {rows.map((row) => (
        <li key={row.key} data-tone={row.tone}>
          <span className="ladder-label">{row.label}</span>
          <span className="ladder-price num">{formatPrice(row.price, trade.symbol)}</span>
          <span className="ladder-distance num">{row.key === "entry" ? "—" : formatPoints((row.price - trade.entry_price) * sign, trade.symbol)}</span>
        </li>
      ))}
    </ol>
  );
}
