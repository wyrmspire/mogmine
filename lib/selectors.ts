// Pure list logic: grouping, filtering, day statistics, and running statistics across days (R-08a).
// Lists never see candles (B-42).
import { formatSessionDate, offsetSessionDate, sessionDate, sessionWeekMonday } from "./session.ts";
import { SETUP_TAGS, playbookName } from "./playbooks.ts";
import { adherence, isOpen, rMultiple, tradePnl } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export interface DayStats {
  count: number;
  wins: number;
  /** Wins divided by priced (eligible) trades. Null when nothing can be priced. */
  winRate: number | null;
  /** Gross P&L of priced trades only. Not net of fees or commissions. */
  gross: number;
  pricedCount: number;
  unpriceableCount: number;
  /** True when the gross total omits at least one trade that could not be priced. */
  incomplete: boolean;
  /** Sum of R over trades that have a stop, and how many that was. */
  netR: number | null;
  withR: number;
  /** Process score: trades that followed every rule, out of trades that were graded (UX-13). */
  processFollowed: number;
  processGraded: number;
  needsReview: number;
  /** Open trades (R-03): no result yet, so left out of P&L, win rate and R. Shown as a count only (OD-38). */
  openCount: number;
}

export function dayStats(trades: TradeRecord[]): DayStats {
  let wins = 0, gross = 0, pricedCount = 0, unpriceableCount = 0, netR = 0, withR = 0, processFollowed = 0, processGraded = 0, needsReview = 0, openCount = 0;
  for (const trade of trades) {
    // An open trade has no result yet: counted apart, never in P&L, win rate or R (OD-38).
    if (isOpen(trade)) {
      openCount += 1;
    } else {
      // A trade that cannot be priced is counted, but adds nothing to the money totals.
      const pnl = tradePnl(trade);
      if (pnl != null) {
        pricedCount += 1;
        if (pnl > 0) wins += 1;
        gross += pnl;
      } else {
        unpriceableCount += 1;
      }
      const r = rMultiple(trade);
      if (r != null) { netR += r; withR += 1; }
    }
    const score = adherence(trade);
    if (score) { processGraded += 1; if (score.followed === score.total) processFollowed += 1; }
    if (trade.review_status !== "reviewed") needsReview += 1;
  }
  return {
    count: trades.length,
    wins,
    winRate: pricedCount ? wins / pricedCount : null,
    gross,
    pricedCount,
    unpriceableCount,
    incomplete: unpriceableCount > 0,
    netR: withR ? netR : null,
    withR,
    processFollowed,
    processGraded,
    needsReview,
    openCount,
  };
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

/** Feed URL values that stand for "no playbook", "no account" and "no setup tag" (the Lab's Gaps links use them). */
export const NO_PLAYBOOK_FILTER = "none";
export const UNASSIGNED_ACCOUNT_FILTER = "unassigned";
export const NO_SETUP_TAG_FILTER = "no-setup-tag";

export interface FeedFilters {
  status: StatusFilter;
  /** `YYYY-MM-DD` session date of the trade's entry. */
  date?: string | null;
  /** An account id, or `unassigned` for trades with no account. */
  account?: string | null;
  /** A playbook id, or `none` for trades with no playbook. */
  playbook?: string | null;
  /** An exact quick tag, or `no-setup-tag` for trades with no setup tag. */
  tag?: string | null;
}

const SESSION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` label that is a real calendar date, otherwise null (`2026-02-30` is rejected). */
export function parseSessionDateParam(value: string | null | undefined): string | null {
  if (!value || !SESSION_DATE_PATTERN.test(value)) return null;
  return offsetSessionDate(value, 0) === value ? value : null;
}

/** The day Today shows: the `?date=` value when it is a real day on or before today, otherwise today. */
export function resolveViewedDate(param: string | null | undefined, todayDate: string): string {
  const parsed = parseSessionDateParam(param);
  return parsed && parsed <= todayDate ? parsed : todayDate;
}

function isWeekendLabel(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** The next or previous regular trading date. Saturday and Sunday are skipped (exchange holidays are OD-35). */
export function stepRegularSessionDate(date: string, delta: -1 | 1): string {
  let next = date;
  do {
    next = offsetSessionDate(next, delta);
  } while (isWeekendLabel(next));
  return next;
}

export function parseFilters(params: { get(name: string): string | null }): FeedFilters {
  const status = params.get("status");
  return {
    status: status === "unreviewed" || status === "flagged" ? status : "all",
    date: parseSessionDateParam(params.get("date")),
    account: params.get("account") || null,
    playbook: params.get("playbook") || null,
    tag: params.get("tag") || null,
  };
}

export function filtersToQuery(filters: Partial<FeedFilters>) {
  const params = new URLSearchParams();
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.date) params.set("date", filters.date);
  if (filters.account) params.set("account", filters.account);
  if (filters.playbook) params.set("playbook", filters.playbook);
  if (filters.tag) params.set("tag", filters.tag);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** True when any Feed filter narrows the list, including the status pills. */
export function hasActiveFilters(filters: FeedFilters) {
  return filters.status !== "all" || Boolean(filters.date || filters.account || filters.playbook || filters.tag);
}

export function matchesFeedFilters(trade: TradeRecord, filters: FeedFilters): boolean {
  if (filters.status === "flagged" && !trade.flagged) return false;
  if (filters.status === "unreviewed" && trade.review_status === "reviewed") return false;
  if (filters.date && sessionDate(trade.entry_time) !== filters.date) return false;
  if (filters.account) {
    const match = filters.account === UNASSIGNED_ACCOUNT_FILTER ? trade.account_id == null : trade.account_id === filters.account;
    if (!match) return false;
  }
  if (filters.playbook) {
    const match = filters.playbook === NO_PLAYBOOK_FILTER ? trade.playbook_id == null : trade.playbook_id === filters.playbook;
    if (!match) return false;
  }
  if (filters.tag) {
    const match = filters.tag === NO_SETUP_TAG_FILTER
      ? !trade.quick_tags.some((tag) => SETUP_TAGS.includes(tag))
      : trade.quick_tags.includes(filters.tag);
    if (!match) return false;
  }
  return true;
}

export function applyFilters(trades: TradeRecord[], filters: FeedFilters) {
  return trades.filter((trade) => matchesFeedFilters(trade, filters));
}

const STATUS_NAMES: Record<StatusFilter, string> = { all: "Any status", unreviewed: "Needs review", flagged: "Flagged" };

export interface FilterLookup {
  /** Account name for an id. Falls back to the id when not supplied. */
  accountName?: (id: string) => string | null;
  /** Playbook name for an id. Falls back to the seeded or registered playbook name, then the id. */
  playbookName?: (id: string) => string | null;
}

export interface FilterPart {
  key: keyof FeedFilters;
  label: string;
}

/** Each active filter as a readable part, in display order. The status part is only present when status is narrowed. */
export function describeFilterParts(filters: FeedFilters, lookup: FilterLookup = {}): FilterPart[] {
  const parts: FilterPart[] = [];
  if (filters.status !== "all") parts.push({ key: "status", label: STATUS_NAMES[filters.status] });
  if (filters.date) parts.push({ key: "date", label: formatSessionDate(filters.date) });
  if (filters.account) {
    const label = filters.account === UNASSIGNED_ACCOUNT_FILTER
      ? "Unassigned"
      : lookup.accountName?.(filters.account) ?? filters.account;
    parts.push({ key: "account", label });
  }
  if (filters.playbook) {
    const label = filters.playbook === NO_PLAYBOOK_FILTER
      ? "No playbook"
      : lookup.playbookName?.(filters.playbook) ?? playbookName(filters.playbook) ?? filters.playbook;
    parts.push({ key: "playbook", label });
  }
  if (filters.tag) parts.push({ key: "tag", label: filters.tag === NO_SETUP_TAG_FILTER ? "No setup tag" : filters.tag });
  return parts;
}

/** Plain-language name of the active filters, for the empty state and the pager. */
export function describeFilters(filters: FeedFilters, lookup: FilterLookup = {}) {
  const parts = describeFilterParts(filters, lookup).map((part) => part.label);
  return parts.length ? parts.join(" · ") : "All trades";
}

export function withSamples(trades: TradeRecord[], showSamples: boolean) {
  if (showSamples) return trades;
  const real = trades.filter((trade) => !trade.is_sample);
  // With nothing of their own yet, a trader still sees the labelled samples (docs/08 §4, first run).
  return real.length ? real : trades;
}

export interface SummaryStats {
  tradeCount: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;
  grossPnl: number;
  pricedCount: number;
  unpriceableCount: number;
  incomplete: boolean;
  totalR: number | null;
  avgR: number | null;
  withR: number;
  /** Trades for which rMultiple returns null, including unpriceable trades. */
  skippedRCount: number;
  ruleAdherence: {
    followed: number;
    total: number;
    ratio: number;
    perfectTrades: number;
    gradedTrades: number;
  } | null;
}

export interface PlaybookStats extends SummaryStats {
  playbookId: string | null;
}

export interface TagStats extends SummaryStats {
  tag: string;
}

export interface RunningStats {
  overall: SummaryStats;
  last20: SummaryStats;
  thisWeek: SummaryStats;
  thisMonth: SummaryStats;
  byPlaybook: PlaybookStats[];
  byTag: TagStats[];
  excludedSampleCount: number;
  excludedOpenCount: number;
  /** Closed trades whose results can be included in all-time summaries only. */
  undatedCount: number;
}

function summarizeTrades(trades: TradeRecord[]): SummaryStats {
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  let grossCents = 0;
  let pricedCount = 0;
  let unpriceableCount = 0;
  let totalR = 0;
  let withR = 0;
  let checklistFollowedSum = 0;
  let checklistTotalSum = 0;
  let perfectTrades = 0;
  let gradedTrades = 0;

  for (const trade of trades) {
    const pnl = tradePnl(trade);
    if (pnl != null) {
      pricedCount += 1;
      grossCents += Math.round(pnl * 100);
      if (pnl > 0) wins += 1;
      else if (pnl < 0) losses += 1;
      else scratches += 1;
    } else {
      unpriceableCount += 1;
    }

    const r = rMultiple(trade);
    if (r != null) {
      totalR += r;
      withR += 1;
    }

    const score = adherence(trade);
    if (score) {
      gradedTrades += 1;
      checklistFollowedSum += score.followed;
      checklistTotalSum += score.total;
      if (score.followed === score.total) {
        perfectTrades += 1;
      }
    }
  }

  return {
    tradeCount: trades.length,
    wins,
    losses,
    scratches,
    winRate: pricedCount > 0 ? wins / pricedCount : null,
    grossPnl: grossCents / 100,
    pricedCount,
    unpriceableCount,
    incomplete: unpriceableCount > 0,
    totalR: withR > 0 ? totalR : null,
    avgR: withR > 0 ? totalR / withR : null,
    withR,
    skippedRCount: trades.length - withR,
    ruleAdherence:
      gradedTrades > 0
        ? {
            followed: checklistFollowedSum,
            total: checklistTotalSum,
            ratio: checklistFollowedSum / checklistTotalSum,
            perfectTrades,
            gradedTrades,
          }
        : null,
  };
}

/**
 * Running statistics across closed real trades (R-08a). The caller supplies the
 * current instant and calendar windows use New York session dates at exit.
 */
export function runningStats(
  trades: readonly TradeRecord[],
  now: number | string,
): RunningStats {
  let excludedSampleCount = 0;
  let excludedOpenCount = 0;
  const dated: Array<{ trade: TradeRecord; exitMs: number }> = [];
  const undated: TradeRecord[] = [];

  for (const trade of trades) {
    if (trade.is_sample) {
      excludedSampleCount += 1;
      continue;
    }
    if (trade.status === "open" || trade.exit_time == null) {
      excludedOpenCount += 1;
      continue;
    }
    const exitMs = Date.parse(trade.exit_time);
    if (Number.isFinite(exitMs)) dated.push({ trade, exitMs });
    else undated.push(trade);
  }

  dated.sort((a, b) => {
    if (a.exitMs !== b.exitMs) return a.exitMs - b.exitMs;
    if (a.trade.id === b.trade.id) return 0;
    return a.trade.id < b.trade.id ? -1 : 1;
  });
  const refSession = sessionDate(now);
  const week = sessionWeekMonday(refSession);
  const month = refSession.slice(0, 7);
  const weekTrades: TradeRecord[] = [];
  const monthTrades: TradeRecord[] = [];
  for (const { trade, exitMs } of dated) {
    const date = sessionDate(exitMs);
    if (sessionWeekMonday(date) === week) weekTrades.push(trade);
    if (date.startsWith(month)) monthTrades.push(trade);
  }

  const datedTrades = dated.map(({ trade }) => trade);
  const eligible = datedTrades.concat(undated);

  const playbookGroups = new Map<string | null, TradeRecord[]>();
  const tagGroups = new Map<string, TradeRecord[]>();
  for (const trade of eligible) {
    const key = trade.playbook_id ?? null;
    const list = playbookGroups.get(key);
    if (list) list.push(trade);
    else playbookGroups.set(key, [trade]);

    for (const tag of new Set(trade.quick_tags)) {
      const tagged = tagGroups.get(tag);
      if (tagged) tagged.push(trade);
      else tagGroups.set(tag, [trade]);
    }
  }
  const byPlaybook: PlaybookStats[] = [...playbookGroups.entries()]
    .map(([playbookId, list]) => ({
      playbookId,
      ...summarizeTrades(list),
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount || (a.playbookId ?? "").localeCompare(b.playbookId ?? "", "en"));
  const byTag: TagStats[] = [...tagGroups.entries()]
    .map(([tag, list]) => ({
      tag,
      ...summarizeTrades(list),
    }))
    .sort((a, b) => b.tradeCount - a.tradeCount || a.tag.localeCompare(b.tag, "en"));

  return {
    overall: summarizeTrades(eligible),
    last20: summarizeTrades(datedTrades.slice(-20)),
    thisWeek: summarizeTrades(weekTrades),
    thisMonth: summarizeTrades(monthTrades),
    byPlaybook,
    byTag,
    excludedSampleCount,
    excludedOpenCount,
    undatedCount: undated.length,
  };
}
