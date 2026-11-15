// Pure list logic: grouping, filtering and day statistics. Lists never see candles (B-42).
import { sessionDate } from "./session.ts";
import { adherence, rMultiple, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface DayStats {
  count: number;
  wins: number;
  winRate: number | null;
  net: number;
  /** Sum of R over trades that have a stop, and how many that was. */
  netR: number | null;
  withR: number;
  /** Process score: trades that followed every rule, out of trades that were graded (UX-13). */
  processFollowed: number;
  processGraded: number;
  needsReview: number;
}

export function dayStats(trades: TradeRecord[]): DayStats {
  let wins = 0, net = 0, netR = 0, withR = 0, processFollowed = 0, processGraded = 0, needsReview = 0;
  for (const trade of trades) {
    const pnl = tradePnl(trade);
    if (pnl > 0) wins += 1;
    net += pnl;
    const r = rMultiple(trade);
    if (r != null) { netR += r; withR += 1; }
    const score = adherence(trade);
    if (score) { processGraded += 1; if (score.followed === score.total) processFollowed += 1; }
    if (trade.review_status !== "reviewed") needsReview += 1;
  }
  return { count: trades.length, wins, winRate: trades.length ? wins / trades.length : null, net, netR: withR ? netR : null, withR, processFollowed, processGraded, needsReview };
}

export interface DayGroup {
  date: string;
  trades: TradeRecord[];
  stats: DayStats;
  /** Every trade that day is a sample. */
  sampleOnly: boolean;
}

/** Trades grouped by trading day, newest day first. Statistics never count sample trades next to real ones. */
export function groupByDay(trades: TradeRecord[]): DayGroup[] {
  const groups = new Map<string, TradeRecord[]>();
  for (const trade of trades) {
    const date = sessionDate(trade.entry_time);
    const list = groups.get(date);
    if (list) list.push(trade); else groups.set(date, [trade]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([date, list]) => {
    const real = list.filter((trade) => !trade.is_sample);
    return { date, trades: list, stats: dayStats(real.length ? real : list), sampleOnly: real.length === 0 };
  });
}

export type StatusFilter = "all" | "unreviewed" | "flagged";

export interface FeedFilters {
  status: StatusFilter;
}

export function parseFilters(params: { get(name: string): string | null }): FeedFilters {
  const status = params.get("status");
  return {
    status: status === "unreviewed" || status === "flagged" ? status : "all",
  };
}

export function filtersToQuery(filters: FeedFilters) {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function applyFilters(trades: TradeRecord[], filters: FeedFilters) {
  return trades.filter((trade) =>
    (filters.status === "all" || (filters.status === "flagged" ? trade.flagged : trade.review_status !== "reviewed")));
}

const STATUS_NAMES: Record<StatusFilter, string> = { all: "Any status", unreviewed: "Needs review", flagged: "Flagged" };

/** Plain-language name of the active filters, for the empty state and the pager. */
export function describeFilters(filters: FeedFilters) {
  return filters.status !== "all" ? STATUS_NAMES[filters.status] : "All trades";
}

export function withSamples(trades: TradeRecord[], showSamples: boolean) {
  if (showSamples) return trades;
  const real = trades.filter((trade) => !trade.is_sample);
  // With nothing of their own yet, a trader still sees the labelled samples (docs/08 §4, first run).
  return real.length ? real : trades;
}
