// Playbook Lab model (docs/design-2026-11-24/01 §6). Pure: no React, no DOM, no candles (B-42).
// Every count is taken over the same eligible trades a Feed link returns, so each `n` equals
// `applyFilters(eligible, parseFilters(feedHref))`. Open trades count in `n` only (OD-38).
import { NO_SETUP_ID } from "./playbooks.ts";
import type { Playbook } from "./playbooks.ts";
import { PLAYBOOK_CARD_MIN_TRADES } from "./playbook-card.ts";
import { resolveRSize, resultR } from "./r-size.ts";
import { NO_PLAYBOOK_FILTER, NO_SETUP_TAG_FILTER, filtersToQuery } from "./selectors.ts";
import type { FeedFilters } from "./selectors.ts";
import { adherence, isExitReason, isOpen, isScratch, tradePnl } from "./trades.ts";
import type { TradeExitReason, TradeRecord } from "./trades.ts";

export type TagKind = "setup" | "execution";
export type HoldBand = "under_5m" | "5m_to_30m" | "30m_to_2h" | "over_2h";

export interface TagInput {
  setup: readonly string[];
  execution: readonly string[];
}

export interface LabExampleRef {
  tradeId: string;
  reason: "latest" | "best_rules" | "latest_loss";
}

export interface ShapeFacts {
  longCount: number;
  shortCount: number;
  /** Closed trades only. Trades with no recorded exit reason count as `unknown`. */
  exitReasons: Record<TradeExitReason | "unknown", number>;
  /** Closed trades only. */
  holdBands: Record<HoldBand, number>;
  /** Closed trades with at least one recorded stop move. */
  stopMovedCount: number;
  /** `stopMovedCount ÷ closedCount`, or null with no closed trades. Not gated: it is a shape fact, not a rate. */
  stopMovedShare: number | null;
  wins: number;
  losses: number;
  scratches: number;
}

export interface PlaybookFacet {
  playbookId: string;
  name: string;
  archived: boolean;
  rules: readonly { id: string; label: string }[];
  /** Includes open trades. */
  n: number;
  closedCount: number;
  openCount: number;
  /** Latest `entry_time` ISO among this playbook's trades. */
  lastUsedAt: string | null;
  /** Non-zero setup tags only, most used first. `feedHref` filters by this playbook and tag. */
  setupTags: { tag: string; n: number; feedHref: string }[];
  /** Non-zero execution tags only, most used first. */
  executionTags: { tag: string; n: number; feedHref: string }[];
  shape: ShapeFacts;
  /** Share of graded closed trades with every rule followed. Null below `PLAYBOOK_CARD_MIN_TRADES` graded trades. */
  rulesFollowedRatio: number | null;
  gradedCount: number;
  /** Null below `PLAYBOOK_CARD_MIN_TRADES` closed trades with an R value. */
  avgResultR: number | null;
  /** Up to 3 distinct trade ids: latest, best_rules, latest_loss. Ids only; no candles. */
  examples: LabExampleRef[];
  feedHref: string;
}

export interface TagFacet {
  tag: string;
  kind: TagKind;
  /** Includes open trades. */
  n: number;
  closedCount: number;
  /** Where the tag is used. `playbookId: null` is trades with no playbook. */
  playbooks: { playbookId: string | null; name: string; n: number; feedHref: string }[];
  avgResultR: number | null;
  rulesFollowedRatio: number | null;
  examples: LabExampleRef[];
  feedHref: string;
}

export interface LabView {
  counts: {
    playbooks: number;
    archived: number;
    setupTags: number;
    executionTags: number;
    trades: number;
    withPlaybook: number;
    withSetupTag: number;
  };
  /** Active first, then archived. Input order is kept within each group. */
  playbooks: PlaybookFacet[];
  /** Setup group first, then execution group, in vocabulary order. */
  tags: TagFacet[];
  unknownTags: { label: string; n: number; feedHref: string }[];
  /** Sparse: only cells with `n > 0`. A cell is playbook × setup tag. */
  matrix: { playbookId: string; tag: string; n: number; feedHref: string }[];
  gaps: {
    /** Trade ids with no playbook. */
    noPlaybook: string[];
    noPlaybookHref: string;
    /**
     * Trade ids with a playbook but no setup tag (01 §4.5). Its link (`tag=no-setup-tag`) cannot also
     * filter by playbook, so the Feed shows a superset that includes trades with no playbook.
     */
    noSetupTag: string[];
    noSetupTagHref: string;
    unusedPlaybooks: string[];
    unusedTags: string[];
    impulseCount: number;
    /** Impulse trades ÷ all eligible trades, or null with none. */
    impulseShare: number | null;
    impulseHref: string;
  };
}

type ResultR = (trade: TradeRecord) => number | null;
/** A trade that has an exit. Only these count toward results, shape and examples (OD-38). */
type Done = TradeRecord & { exit_time: string };

const defaultResultR: ResultR = (trade) => resultR(trade, resolveRSize(trade));
const entryMs = (trade: TradeRecord) => Date.parse(trade.entry_time);
const isDone = (trade: TradeRecord): trade is Done => !isOpen(trade) && trade.exit_time != null;
const feedHref = (filters: Partial<FeedFilters>) => `/feed${filtersToQuery({ status: "all", ...filters })}`;
const byCountDesc = (a: { n: number }, b: { n: number }) => b.n - a.n;

function holdBand(seconds: number): HoldBand {
  if (seconds < 300) return "under_5m";
  if (seconds < 1800) return "5m_to_30m";
  if (seconds < 7200) return "30m_to_2h";
  return "over_2h";
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function examplesOf(byRecency: readonly TradeRecord[], closed: readonly Done[]): LabExampleRef[] {
  let bestRules: { trade: Done; ratio: number } | null = null;
  for (const trade of closed) {
    const score = adherence(trade);
    if (score && (!bestRules || score.ratio > bestRules.ratio)) bestRules = { trade, ratio: score.ratio };
  }
  const latestLoss = closed.find((trade) => !isScratch(trade) && (tradePnl(trade) ?? 0) < 0);
  const picks: LabExampleRef[] = [];
  const add = (trade: TradeRecord | undefined, reason: LabExampleRef["reason"]) => {
    if (trade && !picks.some((pick) => pick.tradeId === trade.id)) picks.push({ tradeId: trade.id, reason });
  };
  add(byRecency[0], "latest");
  add(bestRules?.trade, "best_rules");
  add(latestLoss, "latest_loss");
  return picks;
}

/** Results, rates and examples for a group of trades. Open trades stay out of every rate. */
function summarize(trades: readonly TradeRecord[], rOf: ResultR) {
  const byRecency = [...trades].sort((a, b) => entryMs(b) - entryMs(a));
  const closed = byRecency.filter(isDone);
  const rValues = closed.flatMap((trade) => {
    const r = rOf(trade);
    return r == null ? [] : [r];
  });
  const graded = closed.flatMap((trade) => {
    const score = adherence(trade);
    return score ? [score] : [];
  });
  const followedAll = graded.filter((score) => score.followed === score.total).length;
  return {
    closed,
    closedCount: closed.length,
    openCount: trades.length - closed.length,
    gradedCount: graded.length,
    avgResultR: rValues.length >= PLAYBOOK_CARD_MIN_TRADES ? mean(rValues) : null,
    rulesFollowedRatio: graded.length >= PLAYBOOK_CARD_MIN_TRADES ? followedAll / graded.length : null,
    examples: examplesOf(byRecency, closed),
  };
}

function shapeOf(trades: readonly TradeRecord[], closed: readonly Done[]): ShapeFacts {
  const exitReasons: Record<TradeExitReason | "unknown", number> = { target: 0, stop: 0, trail: 0, breakeven: 0, manual: 0, unknown: 0 };
  const holdBands: Record<HoldBand, number> = { under_5m: 0, "5m_to_30m": 0, "30m_to_2h": 0, over_2h: 0 };
  let stopMovedCount = 0;
  let wins = 0;
  let losses = 0;
  let scratches = 0;
  for (const trade of closed) {
    exitReasons[isExitReason(trade.exit_reason) ? trade.exit_reason : "unknown"] += 1;
    const seconds = (Date.parse(trade.exit_time) - entryMs(trade)) / 1000;
    if (Number.isFinite(seconds)) holdBands[holdBand(seconds)] += 1;
    if (trade.stop_moves?.length) stopMovedCount += 1;
    if (isScratch(trade)) {
      scratches += 1;
      continue;
    }
    const pnl = tradePnl(trade);
    if (pnl != null && pnl > 0) wins += 1;
    else if (pnl != null && pnl < 0) losses += 1;
  }
  return {
    longCount: trades.filter((trade) => trade.direction === "LONG").length,
    shortCount: trades.filter((trade) => trade.direction === "SHORT").length,
    exitReasons,
    holdBands,
    stopMovedCount,
    stopMovedShare: closed.length ? stopMovedCount / closed.length : null,
    wins,
    losses,
    scratches,
  };
}

function latestEntry(trades: readonly TradeRecord[]) {
  return trades.reduce<string | null>((latest, trade) => (latest == null || entryMs(trade) > Date.parse(latest) ? trade.entry_time : latest), null);
}

function playbookFacet(playbook: Playbook, eligible: readonly TradeRecord[], tags: TagInput, rOf: ResultR): PlaybookFacet {
  const mine = eligible.filter((trade) => trade.playbook_id === playbook.id);
  const summary = summarize(mine, rOf);
  const tagRows = (list: readonly string[]) =>
    list
      .flatMap((tag) => {
        const n = mine.filter((trade) => trade.quick_tags.includes(tag)).length;
        return n ? [{ tag, n, feedHref: feedHref({ playbook: playbook.id, tag }) }] : [];
      })
      .sort(byCountDesc);
  return {
    playbookId: playbook.id,
    name: playbook.name,
    archived: playbook.archived,
    rules: playbook.checklist_rules.map((rule) => ({ id: rule.id, label: rule.label })),
    n: mine.length,
    closedCount: summary.closedCount,
    openCount: summary.openCount,
    lastUsedAt: latestEntry(mine),
    setupTags: tagRows([...new Set(tags.setup)]),
    executionTags: tagRows([...new Set(tags.execution)]),
    shape: shapeOf(mine, summary.closed),
    rulesFollowedRatio: summary.rulesFollowedRatio,
    gradedCount: summary.gradedCount,
    avgResultR: summary.avgResultR,
    examples: summary.examples,
    feedHref: feedHref({ playbook: playbook.id }),
  };
}

function tagFacet(tag: string, kind: TagKind, eligible: readonly TradeRecord[], names: ReadonlyMap<string, string>, rOf: ResultR): TagFacet {
  const withTag = eligible.filter((trade) => trade.quick_tags.includes(tag));
  const summary = summarize(withTag, rOf);
  const counts = new Map<string | null, number>();
  for (const trade of withTag) {
    const id = trade.playbook_id ?? null;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const playbooks = [...counts]
    .map(([id, n]) =>
      id == null
        ? { playbookId: null, name: "No playbook", n, feedHref: feedHref({ playbook: NO_PLAYBOOK_FILTER, tag }) }
        : { playbookId: id, name: names.get(id) ?? id, n, feedHref: feedHref({ playbook: id, tag }) },
    )
    .sort(byCountDesc);
  return {
    tag,
    kind,
    n: withTag.length,
    closedCount: summary.closedCount,
    playbooks,
    avgResultR: summary.avgResultR,
    rulesFollowedRatio: summary.rulesFollowedRatio,
    examples: summary.examples,
    feedHref: feedHref({ tag }),
  };
}

export function labView(
  playbooks: readonly Playbook[],
  tags: TagInput,
  trades: readonly TradeRecord[],
  opts: { includeSamples: boolean; now: number; rOf?: (trade: TradeRecord) => number | null },
): LabView {
  const rOf = opts.rOf ?? defaultResultR;
  const eligible = opts.includeSamples ? trades : trades.filter((trade) => !trade.is_sample);
  const setupSet = new Set(tags.setup);
  const knownSet = new Set([...tags.setup, ...tags.execution]);
  const names = new Map(playbooks.map((playbook) => [playbook.id, playbook.name]));

  const ordered = [...playbooks.filter((playbook) => !playbook.archived), ...playbooks.filter((playbook) => playbook.archived)];
  const playbookFacets = ordered.map((playbook) => playbookFacet(playbook, eligible, tags, rOf));
  const tagFacets = [
    ...[...setupSet].map((tag) => tagFacet(tag, "setup", eligible, names, rOf)),
    ...[...new Set(tags.execution)].filter((tag) => !setupSet.has(tag)).map((tag) => tagFacet(tag, "execution", eligible, names, rOf)),
  ];

  const unknown = new Map<string, number>();
  for (const trade of eligible) {
    for (const label of new Set(trade.quick_tags)) {
      if (label && !knownSet.has(label)) unknown.set(label, (unknown.get(label) ?? 0) + 1);
    }
  }
  const unknownTags = [...unknown]
    .map(([label, n]) => ({ label, n, feedHref: feedHref({ tag: label }) }))
    .sort((a, b) => b.n - a.n || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

  const impulseCount = eligible.filter((trade) => trade.playbook_id === NO_SETUP_ID).length;
  const withPlaybook = eligible.filter((trade) => trade.playbook_id != null);
  const noSetupTag = withPlaybook.filter((trade) => !trade.quick_tags.some((tag) => setupSet.has(tag)));

  return {
    counts: {
      playbooks: playbooks.length,
      archived: playbooks.filter((playbook) => playbook.archived).length,
      setupTags: setupSet.size,
      executionTags: new Set(tags.execution).size,
      trades: eligible.length,
      withPlaybook: withPlaybook.length,
      withSetupTag: eligible.filter((trade) => trade.quick_tags.some((tag) => setupSet.has(tag))).length,
    },
    playbooks: playbookFacets,
    tags: tagFacets,
    unknownTags,
    matrix: playbookFacets.flatMap((facet) =>
      facet.setupTags.map((row) => ({ playbookId: facet.playbookId, tag: row.tag, n: row.n, feedHref: row.feedHref })),
    ),
    gaps: {
      noPlaybook: eligible.filter((trade) => trade.playbook_id == null).map((trade) => trade.id),
      noPlaybookHref: feedHref({ playbook: NO_PLAYBOOK_FILTER }),
      noSetupTag: noSetupTag.map((trade) => trade.id),
      noSetupTagHref: feedHref({ tag: NO_SETUP_TAG_FILTER }),
      unusedPlaybooks: playbookFacets.filter((facet) => !facet.archived && facet.n === 0).map((facet) => facet.playbookId),
      unusedTags: tagFacets.filter((facet) => facet.n === 0).map((facet) => facet.tag),
      impulseCount,
      impulseShare: eligible.length ? impulseCount / eligible.length : null,
      impulseHref: feedHref({ playbook: NO_SETUP_ID }),
    },
  };
}
