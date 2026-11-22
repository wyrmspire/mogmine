// lib/neighbour-trades.ts — Archived neighbouring-trade projection (K, #40, docs/12 §14, D-010)
import { tradeTicks } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface NeighbourTradeProjection {
  tradeId: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;
  pnlTicks: number | null;
  isProfit: boolean | null;
  /** Restrained opacity for faint rendering (D-010: 0.08–0.15) */
  opacity: number;
}

export interface NeighbourProjectionOptions {
  /** Time window in hours around active trade to search for neighbours (default: 6h) */
  windowHours?: number;
  /** Restrained opacity multiplier (default 0.12) */
  opacity?: number;
}

/**
 * Pure selector finding historical trades that occurred around the active trade's chart window.
 * Returns minimal faint geometry without text labels or price tags (D-010).
 */
export function findNeighbourTrades(
  activeTrade: TradeRecord,
  allTrades: TradeRecord[],
  options: NeighbourProjectionOptions = {},
): NeighbourTradeProjection[] {
  const { windowHours = 6, opacity = 0.12 } = options;

  const activeEntryMs = Date.parse(activeTrade.entry_time);
  if (!Number.isFinite(activeEntryMs)) return [];

  const activeExitMs = activeTrade.exit_time ? Date.parse(activeTrade.exit_time) : activeEntryMs;
  const windowMs = windowHours * 60 * 60 * 1000;

  const minTime = Math.min(activeEntryMs, activeExitMs) - windowMs;
  const maxTime = Math.max(activeEntryMs, activeExitMs) + windowMs;

  const neighbours: NeighbourTradeProjection[] = [];

  for (const trade of allTrades) {
    // Exclude the active trade itself
    if (trade.id === activeTrade.id) continue;

    // Must be the same instrument
    if (trade.symbol !== activeTrade.symbol) continue;

    const entryMs = Date.parse(trade.entry_time);
    if (!Number.isFinite(entryMs)) continue;

    const exitMs = trade.exit_time ? Date.parse(trade.exit_time) : entryMs;

    // Check if temporal span intersects the window
    const tradeMin = Math.min(entryMs, exitMs);
    const tradeMax = Math.max(entryMs, exitMs);

    if (tradeMax >= minTime && tradeMin <= maxTime) {
      const ticks = tradeTicks(trade);
      const isProfit = ticks == null ? null : ticks > 0;

      neighbours.push({
        tradeId: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entryTime: trade.entry_time,
        exitTime: trade.exit_time,
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        pnlTicks: ticks,
        isProfit,
        opacity,
      });
    }
  }

  // Sort by entry time
  return neighbours.sort((a, b) => Date.parse(a.entryTime) - Date.parse(b.entryTime));
}
