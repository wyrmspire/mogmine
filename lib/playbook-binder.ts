// CD-3b playbook binder (docs/23 §5.4). Pure: which cards the binder shows, in what order, and the
// exact text of each stat cell, so the screen formats nothing on its own (docs/08 §13).
import { formatPercent, formatR } from "./format.ts";
import type { DrillRecord } from "./drills.ts";
import { DRILL_SCORE_MIN_ANSWERS } from "./drills.ts";
import { PLAYBOOK_CARD_MIN_TRADES, playbookCardData } from "./playbook-card.ts";
import type { PlaybookCardData } from "./playbook-card.ts";
import type { Playbook } from "./playbooks.ts";
import type { TradeRecord } from "./trades.ts";

export interface BinderView {
  /** Active playbooks in the trader's own order (R-07 store order). */
  cards: PlaybookCardData[];
  /** Archived playbooks are left out of the binder and counted, never silently dropped. */
  archived: number;
}

export function binderView(
  playbooks: readonly Playbook[],
  trades: readonly TradeRecord[],
  drills: readonly DrillRecord[],
  now: number,
): BinderView {
  const active = playbooks.filter((playbook) => !playbook.archived);
  return {
    cards: active.map((playbook) => playbookCardData(playbook, trades, drills, now)),
    archived: playbooks.length - active.length,
  };
}

export interface StatCell {
  label: string;
  value: string;
}

/**
 * The stats row (§2: three cells max). Below the minimum sample the rates say so instead of printing a
 * number (§1.7). Shield hides results entirely (§5.4), so it returns no cells and the card says why.
 */
export function playbookStatCells(data: PlaybookCardData, shield: boolean): StatCell[] {
  if (shield) return [];
  const { stats } = data;
  const rate = (value: number | null, format: (v: number | null) => string) => (stats.belowMinimum ? "Not enough trades yet" : format(value));
  return [
    { label: "Trades", value: String(stats.trades) },
    { label: "Win rate", value: rate(stats.winRate, formatPercent) },
    { label: "Avg R", value: rate(stats.avgR, formatR) },
  ];
}

/** One line for a binder tile. Below the minimum it says so once; under Shield it says results are hidden. */
export function playbookTileStats(data: PlaybookCardData, shield: boolean): string {
  if (shield) return "Results hidden by Shield";
  if (data.stats.belowMinimum) return `${data.stats.trades} ${data.stats.trades === 1 ? "trade" : "trades"} · not enough for rates yet`;
  return playbookStatCells(data, false).map((cell) => `${cell.label} ${cell.value}`).join(" · ");
}

/** The footer and sample lines: `n` always prints, and so do trades left out of R (§5.3). */
export function playbookSampleLine(data: PlaybookCardData): string {
  const { stats } = data;
  const parts = [`n = ${stats.trades}`];
  if (stats.belowMinimum) parts.push(`rates from ${PLAYBOOK_CARD_MIN_TRADES}`);
  if (stats.skippedR > 0) parts.push(`${stats.skippedR} unpriceable, left out of R`);
  return parts.join(" · ");
}

/** Why the example was picked, or the empty-frame text (§5.1). */
export function playbookExampleCaption(data: PlaybookCardData): string {
  if (!data.example) return "No example yet";
  return data.example.basis === "clean_take" ? "Latest trade with every rule followed and a blind Take it" : "Latest trade with every rule followed";
}

/** The drill result on the back (§4.5). Hidden under Shield along with every other result. */
export function playbookDrillLine(data: PlaybookCardData, shield: boolean): string {
  if (shield) return "Hidden by Shield";
  const { drill } = data;
  const answered = drill.take.n + drill.smaller.n + drill.pass.n + drill.noR;
  if (!drill.ready) return `${answered}/${DRILL_SCORE_MIN_ANSWERS} trades drilled. The take-versus-pass comparison appears at ${DRILL_SCORE_MIN_ANSWERS}.`;
  return `Take it: ${formatR(drill.take.avgR)} avg (n ${drill.take.n}) · Pass: ${formatR(drill.pass.avgR)} avg (n ${drill.pass.n})`;
}
