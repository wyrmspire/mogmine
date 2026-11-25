// Real trades overlay (docs/design-2026-11-24/09 §6.1, §8.6, SL-11). Pure: no I/O, no React.
//
// Chris's closed MES trades tagged with the recipe's playbook are read at their own entry bar. The decision bar is
// the bar that closed at or just before the entry time (the same rule as a mark, §4.4). Each trigger leaf is shown
// with its pass/fail and actual value. A trade "fits" when the side, the window, the weekday list and every trigger
// condition hold at that bar. Money is account R: dollars ÷ the fixed R size, never a stop width. Samples are
// excluded unless `includeSamples` is set. Trades before the loaded 1m history are counted, never computed on 5m.

import { tradePnl, type TradeRecord } from "../trades.ts";
import { featureKey } from "./attribution.ts";
import { evaluateCondition } from "./conditions.ts";
import { rBasisLabel, type LabRSize } from "./r.ts";
import { createLevelIndex, levelBookAt, withLevels } from "./levels.ts";
import { formatEtMinute, inEtWindow, majorOfVersion, outputSpecOf } from "./recipe.ts";
import { getSkill, SKILLS, type SkillRegistry } from "./registry.ts";
import { decisionMinute } from "./skills/clock.ts";
import { MES_SPEC, readOutput } from "./runner.ts";
import { vwapLevelsAt } from "./vwap.ts";
import type {
  BarSeries, Condition, Outcome, OverlayRow, Recipe, RunResult, SkillContext, Value,
} from "./types.ts";

const BAR_MS = 60_000;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface OverlayOptions {
  /** A validated recipe (run through validateRecipe first). */
  recipe: Recipe;
  series: BarSeries;
  trades: readonly TradeRecord[];
  /** Fixed account R size (§6.4). Never inferred from a stop. */
  rSize: LabRSize;
  accountName?: string | null;
  /** The recipe's run over the same series. Supplies the simulated outcome for bars where it fired. */
  run?: Pick<RunResult, "matches"> | null;
  /** Sample trades are excluded unless this is true (§8.6). Default false. */
  includeSamples?: boolean;
  registry?: SkillRegistry;
}

/** One line of the legend: what a condition path means, in words. */
export interface OverlayLegendItem { path: string; label: string }

export interface OverlayGroup {
  /** Rows in the group (trades evaluated at a bar). */
  n: number;
  /** Rows whose real result could be priced. Averages use only these. */
  withR: number;
  avgR: number | null;
  totalR: number | null;
}

export interface OverlaySummary {
  /** The R basis line, shown once per screen, for example "R = $300 (SIM Eval 50K)". */
  basis: string;
  /** Closed MES trades tagged with the recipe's playbook (samples only when included). */
  tagged: number;
  /** Tagged trades whose entry falls inside the loaded 1m range and has a decision bar. */
  inRange: number;
  /** Sample trades left out because includeSamples is false. */
  samplesExcluded: number;
  /** Tagged trades entered before the first loaded bar. Counted and listed by id, never computed. */
  olderThanHistory: { count: number; tradeIds: string[] };
  /** Tagged trades entered after the last loaded bar. */
  afterHistory: number;
  /** In range but with no usable 1m decision bar (a gap, or a session that came back as 5m or 1h). */
  noBarAtEntry: number;
  fit: OverlayGroup;
  notFit: OverlayGroup;
  legend: OverlayLegendItem[];
  rows: OverlayRow[];
}

interface Leaf { path: string; condition: Extract<Condition, { skill: string }> }

/** Every trigger leaf with its path, in the same path form the condition evaluator reports. */
function leavesOf(condition: Condition, path: string, out: Leaf[] = []): Leaf[] {
  if ("all" in condition) {
    condition.all.forEach((child, n) => leavesOf(child, `${path}.all[${n}]`, out));
  } else if ("any" in condition) {
    condition.any.forEach((child, n) => leavesOf(child, `${path}.any[${n}]`, out));
  } else if ("not" in condition) {
    leavesOf(condition.not, `${path}.not`, out);
  } else {
    out.push({ path, condition });
  }
  return out;
}

const OP_TEXT: Readonly<Record<string, string>> = { "==": "=", "!=": "≠", "<=": "≤", ">=": "≥" };

function valueText(value: Value | Value[]): string {
  if (Array.isArray(value)) return value.length === 2 ? `${String(value[0])}–${String(value[1])}` : value.map(String).join(", ");
  return String(value);
}

/** Decision bar index for an entry time: the bar that closed at or before it, or null when no bar exists. */
export function decisionIndexAt(series: BarSeries, entryMs: number): number | null {
  if (!Number.isFinite(entryMs)) return null;
  const open = Math.floor((entryMs - BAR_MS) / BAR_MS) * BAR_MS;
  return series.byTime.get(open) ?? null;
}

function majorOf(skill: string, registry: SkillRegistry): number {
  const found = getSkill(skill, registry);
  return found ? majorOfVersion(found.meta.version) : 1;
}

function legendFor(recipe: Recipe, leaves: readonly Leaf[], registry: SkillRegistry): OverlayLegendItem[] {
  const days = recipe.window.days?.length ? ` · ${recipe.window.days.join(" ")}` : "";
  const items: OverlayLegendItem[] = [
    { path: "window", label: `In window ${recipe.window.startEt}–${recipe.window.endEt}${days}` },
    { path: "side", label: `Side is ${recipe.side}` },
  ];
  for (const leaf of leaves) {
    const { skill, out, op, value } = leaf.condition;
    const spec = outputSpecOf({ skill, out, params: leaf.condition.params }, registry);
    items.push({ path: leaf.path, label: `${spec?.label ?? `${skill}.${out}`} ${OP_TEXT[op] ?? op} ${valueText(value)}` });
  }
  return items;
}

function groupOf(rows: readonly OverlayRow[]): OverlayGroup {
  const priced = rows.map((row) => row.realResultR).filter((r): r is number => r !== null && Number.isFinite(r));
  const total = priced.reduce((sum, r) => sum + r, 0);
  return {
    n: rows.length,
    withR: priced.length,
    avgR: priced.length ? total / priced.length : null,
    totalR: priced.length ? total : null,
  };
}

/** Evaluate one trade at its decision bar. The caller has already checked the bar exists and is usable. */
function rowAt(
  trade: TradeRecord, entryMs: number, i: number, options: OverlayOptions,
  leaves: readonly Leaf[], simulated: Map<number, Outcome>, index: ReturnType<typeof createLevelIndex>,
  registry: SkillRegistry,
): OverlayRow {
  const { recipe, series } = options;
  const rSizeUsd = options.rSize.usd;
  const ctx: SkillContext = {
    series, i, params: {}, spec: { ...MES_SPEC }, rSizeUsd,
    levels: withLevels(levelBookAt(index, i), vwapLevelsAt(series, i)),
  };

  const minute = decisionMinute(series, i);
  // Same weekday rule as the runner: the session date is the ET trading date.
  const weekday = WEEKDAY_NAMES[new Date(`${series.sessionDate[i]}T12:00:00Z`).getUTCDay()];
  const inWindow = inEtWindow(minute, recipe.window.startEt, recipe.window.endEt)
    && (!recipe.window.days?.length || (recipe.window.days as string[]).includes(weekday));
  const isLong = trade.direction === "LONG";
  const sideOk = isLong === (recipe.side === "long");

  const conditions: OverlayRow["conditions"] = [
    { path: "window", passed: inWindow, actual: `${formatEtMinute(minute)} ${weekday}` },
    { path: "side", passed: sideOk, actual: trade.direction },
    ...leaves.map((leaf) => ({
      path: leaf.path,
      passed: evaluateCondition(leaf.condition, ctx, registry).passed,
      actual: readOutput({ skill: leaf.condition.skill, params: leaf.condition.params, out: leaf.condition.out }, ctx, registry),
    })),
  ];

  const features: Record<string, Value> = {};
  for (const ref of recipe.sliceBy) {
    features[featureKey(ref, majorOf(ref.skill, registry))] = readOutput(ref, ctx, registry);
  }

  const pnlUsd = tradePnl(trade);
  return {
    tradeId: trade.id,
    time: entryMs,
    fits: conditions.every((c) => c.passed),
    realResultR: pnlUsd === null || !(rSizeUsd > 0) ? null : pnlUsd / rSizeUsd,
    simulated: simulated.get(i) ?? null,
    conditions,
    features,
  };
}

/** Overlay a recipe on the user's tagged real trades. The result is deterministic for the same inputs. */
export function overlayRecipe(options: OverlayOptions): OverlaySummary {
  const registry = options.registry ?? SKILLS;
  const { recipe, series } = options;
  const rSizeUsd = options.rSize.usd;
  if (!(Number.isFinite(rSizeUsd) && rSizeUsd > 0)) throw new Error("R size must be a positive dollar amount");

  const leaves = leavesOf(recipe.trigger, "trigger");
  const summary: OverlaySummary = {
    basis: rBasisLabel(options.rSize, options.accountName ?? null),
    tagged: 0,
    inRange: 0,
    samplesExcluded: 0,
    olderThanHistory: { count: 0, tradeIds: [] },
    afterHistory: 0,
    noBarAtEntry: 0,
    fit: groupOf([]),
    notFit: groupOf([]),
    legend: legendFor(recipe, leaves, registry),
    rows: [],
  };
  // No playbook means nothing is tagged, so there is nothing to overlay (§6.1).
  if (recipe.playbookId === null) return summary;

  const tagged = options.trades.filter((t) => t.status === "closed" && t.exit_time !== null
    && t.symbol === recipe.symbol && t.playbook_id === recipe.playbookId);
  const candidates = options.includeSamples ? tagged : tagged.filter((t) => !t.is_sample);
  summary.samplesExcluded = tagged.length - candidates.length;
  summary.tagged = candidates.length;

  const usable = new Set(series.sessions.filter((s) => !s.excluded && s.baseTimeframe === "1m").map((s) => s.date));
  const simulated = new Map<number, Outcome>();
  for (const match of options.run?.matches ?? []) simulated.set(match.i, match.outcome);
  const index = createLevelIndex(series);
  const firstBar = series.time.length > 0 ? series.time[0] : Number.POSITIVE_INFINITY;
  const afterBar = series.time.length > 0 ? series.time[series.time.length - 1] + BAR_MS : Number.NEGATIVE_INFINITY;

  for (const trade of candidates) {
    const entryMs = Date.parse(trade.entry_time);
    if (entryMs < firstBar) {
      summary.olderThanHistory.count += 1;
      summary.olderThanHistory.tradeIds.push(trade.id);
      continue;
    }
    if (entryMs >= afterBar) {
      summary.afterHistory += 1;
      continue;
    }
    const i = decisionIndexAt(series, entryMs);
    if (i === null || !usable.has(series.sessionDate[i])) {
      summary.noBarAtEntry += 1;
      continue;
    }
    summary.inRange += 1;
    summary.rows.push(rowAt(trade, entryMs, i, options, leaves, simulated, index, registry));
  }

  summary.rows.sort((a, b) => a.time - b.time || (a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : 0));
  summary.fit = groupOf(summary.rows.filter((r) => r.fits));
  summary.notFit = groupOf(summary.rows.filter((r) => !r.fits));
  return summary;
}

function signedR(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}R`;
}

/** One summary line, for example "7 tagged trades in range · 3 meet the recipe · real avg +0.40R on those 3". */
export function overlayHeadline(summary: OverlaySummary): string {
  if (summary.tagged === 0) return "No closed trades are tagged with this recipe's playbook yet.";
  const parts = [`${summary.inRange} tagged trades in range`, `${summary.fit.n} meet the recipe`];
  if (summary.fit.avgR !== null) parts.push(`real avg ${signedR(summary.fit.avgR)} on those ${summary.fit.withR}`);
  if (summary.notFit.avgR !== null) parts.push(`${signedR(summary.notFit.avgR)} on the other ${summary.notFit.withR}`);
  if (summary.olderThanHistory.count > 0) parts.push(`${summary.olderThanHistory.count} older than the bar history`);
  return parts.join(" · ");
}
