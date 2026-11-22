// CD-3a playbook card data (docs/23 §5, OD-46). Pure. The card UI (CD-3b) sits on the shared card frame
// from CD-1a. Numbers come from the R-08a selectors only (§5.3): gross, real closed trades, R skips counted.
import { takeVsPass } from "./drills.ts";
import type { DrillRecord, TakeVsPass } from "./drills.ts";
import type { Playbook } from "./playbooks.ts";
import { runningStats } from "./selectors.ts";
import { adherence, isOpen } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

/** No rate prints below this many trades (interim, OD-46 e). */
export const PLAYBOOK_CARD_MIN_TRADES = 10;

export interface PlaybookCardData {
  playbook_id: string;
  name: string;
  rules: string[];
  /** §5.1: the best example trade, and why it was chosen. Null prints "No example yet". */
  example: { trade_id: string; basis: "clean_take" | "clean" } | null;
  stats: {
    trades: number;
    /** Null below the minimum sample, so a 2-trade 100% never prints. */
    winRate: number | null;
    avgR: number | null;
    /** Trades in the average, and trades left out because R is unknown (no stop). */
    withR: number;
    skippedR: number;
    belowMinimum: boolean;
  };
  /** §4.5 drill result over this playbook's trades. */
  drill: TakeVsPass;
}

const isClean = (trade: TradeRecord) => {
  const score = adherence(trade);
  return score != null && score.followed === score.total;
};

/**
 * §5.1: the most recent real, closed trade with every rule followed and a blind *Take it* (`take_again`
 * "yes"); else the most recent with every rule followed; else none.
 */
export function playbookExample(playbookId: string, trades: readonly TradeRecord[]): PlaybookCardData["example"] {
  const candidates = trades
    .filter((trade) => trade.playbook_id === playbookId && !trade.is_sample && !isOpen(trade) && isClean(trade))
    .sort((a, b) => Date.parse(b.entry_time) - Date.parse(a.entry_time));
  const take = candidates.find((trade) => trade.take_again === "yes");
  if (take) return { trade_id: take.id, basis: "clean_take" };
  return candidates[0] ? { trade_id: candidates[0].id, basis: "clean" } : null;
}

export function playbookCardData(
  playbook: Pick<Playbook, "id" | "name" | "checklist_rules">,
  trades: readonly TradeRecord[],
  drills: readonly DrillRecord[],
  now: number,
): PlaybookCardData {
  const summary = runningStats(trades, now).byPlaybook.find((group) => group.playbookId === playbook.id);
  const count = summary?.tradeCount ?? 0;
  const belowMinimum = count < PLAYBOOK_CARD_MIN_TRADES;
  return {
    playbook_id: playbook.id,
    name: playbook.name,
    rules: playbook.checklist_rules.map((rule) => rule.label),
    example: playbookExample(playbook.id, trades),
    stats: {
      trades: count,
      winRate: belowMinimum ? null : summary?.winRate ?? null,
      avgR: belowMinimum ? null : summary?.avgR ?? null,
      withR: summary?.withR ?? 0,
      skippedR: summary?.skippedRCount ?? 0,
      belowMinimum,
    },
    drill: takeVsPass(drills, trades.filter((trade) => trade.playbook_id === playbook.id && !trade.is_sample)),
  };
}
