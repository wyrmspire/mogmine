// UX-A (06 §6): one rule for "how many trades today" and one for the review queue wording.
// Pure: no store, no clock. The account card's "0 trades today" counts closed trades by exit session
// (docs/21 §2); the Today header counts by entry session and says so ("1 trade today (0 closed)").
import { sessionDate } from "./session.ts";
import type { TradeRecord } from "./trades.ts";

export interface DayTradeCounts {
  /** Trades whose entry falls on this trading day. */
  entered: number;
  /** Trades whose exit falls on this trading day. */
  closed: number;
  /** Trades entered on this day that are still open. */
  openEntered: number;
}

/**
 * Counts for one trading day (`YYYY-MM-DD`). Sample trades are dropped when the day has real trades,
 * the same rule `groupByDay` applies, so the header never disagrees with the day's own list.
 */
export function dayTradeCounts(trades: readonly TradeRecord[], date: string): DayTradeCounts {
  const touching = trades.filter((trade) =>
    sessionDate(trade.entry_time) === date || (trade.exit_time != null && sessionDate(trade.exit_time) === date));
  const counted = touching.some((trade) => !trade.is_sample) ? touching.filter((trade) => !trade.is_sample) : touching;
  const entries = counted.filter((trade) => sessionDate(trade.entry_time) === date);
  return {
    entered: entries.length,
    closed: counted.filter((trade) => trade.exit_time != null && sessionDate(trade.exit_time) === date).length,
    openEntered: entries.filter((trade) => trade.exit_time == null).length,
  };
}

/** Today's header line. `entered` is what the trader logged today; `closed` is what finished today. */
export function formatDayTradeHeader(counts: DayTradeCounts, marketClosedForWeekend: boolean): string {
  const { entered, closed } = counts;
  if (marketClosedForWeekend && entered === 0 && closed === 0) return "Markets are closed for the weekend.";
  if (entered === 0 && closed === 0) return "No trades yet today";
  if (entered === closed) return `${entered} ${entered === 1 ? "trade" : "trades"} today`;
  return `${entered} ${entered === 1 ? "trade" : "trades"} today (${closed} closed)`;
}

/** Review queue meta: "12 to review · 1 needs tags". Empty when nothing is waiting. */
export function formatReviewQueueSummary(unreviewedCount: number, needsTagsCount: number): string {
  if (unreviewedCount === 0) return "";
  if (needsTagsCount > 0) return `${unreviewedCount} to review · ${needsTagsCount} ${needsTagsCount === 1 ? "needs" : "need"} tags`;
  return `${unreviewedCount} to review`;
}
