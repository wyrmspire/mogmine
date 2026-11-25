// LV-2 (docs/24 §5, docs/12 §5): turn LV-1 levels into the lines the chart paints. Pure, no I/O.
import { computeLevelsFromInputs, extractSessionInputsFromCandles } from "./levels.ts";
import type { ComputedLevel, ComputedLevelType } from "./levels.ts";
import { planStateAsOf } from "./plans.ts";
import type { PlanningSession } from "./plans.ts";
import { equityIndexSessionBounds, previousRegularSessionDate, sessionDate } from "./session.ts";
import { formatPrice } from "./format.ts";
import { specFor } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import { withheldReasons } from "./level-withheld.ts";
import type { WithheldLevel } from "./level-withheld.ts";
export { stackLabels } from "./label-stack.ts";
export { withheldText } from "./level-withheld.ts";
export type { WithheldLevel } from "./level-withheld.ts";
export { levelPills, levelsSummary, tradeAnchors, MERGE_TICKS } from "./level-pills.ts";
export type { LevelAnchor, LevelPill } from "./level-pills.ts";

export type LevelRole = "resistance" | "support" | "adr" | "neutral";

export interface LevelLine {
  price: number;
  price_ticks: number;
  role: LevelRole;
  /** `7547.50 PDL / ADR Low`: one pill for every level at this price (LV-09). */
  label: string;
  /** The label without its price: `PDL / ADR Low`. */
  names: string;
  keys: string[];
  /** A member is a settlement proxy (LV-1): the ray is dashed. */
  proxy: boolean;
  /** UTC ms where the ray starts. Null runs from the left edge (prior-day levels). */
  startAt: number | null;
  /** A settlement-type level (PDC, 3 PM close, settle): drawn as a quiet 1px dotted ray (Q-7, LB-4). */
  settlement?: boolean;
}

// Planned levels named after a settlement read the same as the computed ones (Q-7).
const SETTLEMENT_LABEL = /\b(pdc|settle|settlement|3\s*pm\s*close)\b/i;
const isSettlement = (level: LineSource) => level.type === "pdc" || level.type === "rth_close"
  || (level.type === "planned" && SETTLEMENT_LABEL.test(level.label));

// Opens, the pivot and settlement are neutral (docs/12 §5). ADR bands are yellow.
const NEUTRAL = new Set<ComputedLevelType>(["pdc", "pp", "rth_open", "rth_close", "globex_open"]);
// Levels formed in the trade's own session start at the bar that formed them.
const SAME_SESSION = new Set<ComputedLevelType>(["globex_open", "onh", "onl", "adr_high", "adr_low", "adr_inner_high", "adr_inner_low"]);
/** One drawable level: computed by LV-1, or authored in a planning session (`planned`, PS-3). */
export type LineSource = Pick<ComputedLevel, "price" | "price_ticks" | "formed_at"> & {
  key: string;
  type: ComputedLevelType | "planned";
  label: string;
};

const ROLE_RANK: Record<LevelRole, number> = { adr: 3, resistance: 2, support: 2, neutral: 1 };

/** Role by type, then by side of the reference price. */
export function levelRole(level: Pick<LineSource, "type" | "price">, referencePrice: number): LevelRole {
  if (level.type.startsWith("adr_")) return "adr";
  if ((level.type !== "planned" && NEUTRAL.has(level.type)) || level.price === referencePrice) return "neutral";
  return level.price > referencePrice ? "resistance" : "support";
}

/** One line per exact price, highest first. Levels at the same tick share one label. */
export function levelLines(levels: readonly LineSource[], referencePrice: number, symbol: string): LevelLine[] {
  const byTick = new Map<number, LineSource[]>();
  for (const level of levels) byTick.set(level.price_ticks, [...(byTick.get(level.price_ticks) ?? []), level]);
  return [...byTick.values()].map((group) => {
    const roles = group.map((level) => levelRole(level, referencePrice));
    const role = roles.reduce((best, next) => ROLE_RANK[next] > ROLE_RANK[best] ? next : best);
    const starts = group.map((level) => level.type !== "planned" && SAME_SESSION.has(level.type) && level.formed_at ? Date.parse(level.formed_at) : null);
    const startAt = starts.some((start) => start == null || !Number.isFinite(start)) ? null : Math.min(...(starts as number[]));
    return {
      price: group[0].price,
      price_ticks: group[0].price_ticks,
      role,
      label: `${formatPrice(group[0].price, symbol)} ${group.map((level) => level.label).join(" / ")}`,
      names: group.map((level) => level.label).join(" / "),
      keys: group.map((level) => level.key),
      proxy: group.some((level) => level.label === "PDC (proxy)"),
      startAt,
      settlement: group.some(isSettlement),
    };
  }).sort((a, b) => b.price_ticks - a.price_ticks);
}

// Levels the trade's own candles can supply. Settlement, pivots and ADR need other inputs (docs/12 §3A).
const CANDLE_LEVELS: readonly ComputedLevelType[] = [
  "pdh", "pdl", "rth_open", "rth_high", "rth_low", "rth_close", "globex_open", "onh", "onl", "week_high", "week_low",
];

/** Candle levels withheld for missing bars. Docs/12 §5: missing-level warnings show at every preset. */
export function missingCandleLevels(levels: readonly Pick<ComputedLevel, "key">[]): ComputedLevelType[] {
  const present = new Set(levels.map((level) => level.key));
  return CANDLE_LEVELS.filter((key) => !present.has(key));
}

/**
 * The two day-mode windows the levels need for a trade: the whole prior session and the trade's
 * session up to entry. Levels are computed as of the entry, never later (no look-ahead, B-14).
 */
export function tradeLevelWindows(entryTime: string) {
  const asOf = Date.parse(entryTime);
  const date = sessionDate(asOf);
  const prior = equityIndexSessionBounds(previousRegularSessionDate(date));
  const today = equityIndexSessionBounds(date);
  return {
    sessionDate: date,
    asOf,
    prior: { from: prior.open, to: prior.close },
    today: asOf > today.open ? { from: today.open, to: Math.min(asOf, today.close) } : null,
  };
}

export interface LevelCandles {
  candles: Candle[];
  baseTimeframe: Timeframe;
}

/** LV-1 levels for a trade from day-mode candles of its own series (LV-06). Null when nothing can be computed. */
export function tradeLevels(
  trade: { symbol: string; entry_time: string },
  prior: LevelCandles,
  today: LevelCandles | null,
): ComputedLevel[] | null {
  const report = tradeLevelReport(trade, prior, today);
  return report?.levels.length ? report.levels : null;
}

/** The levels and, for each candle level withheld, why (OD-55). Null for another instrument or mixed timeframes. */
export function tradeLevelReport(
  trade: { symbol: string; entry_time: string },
  prior: LevelCandles,
  today: LevelCandles | null,
): { levels: ComputedLevel[]; withheld: WithheldLevel[] } | null {
  const symbol = trade.symbol.toUpperCase();
  if (symbol !== "MES" && symbol !== "MNQ") return null;
  // Both windows must be one native series and timeframe. Mixing 1m and 5m would mis-read coverage.
  if (today && today.baseTimeframe !== prior.baseTimeframe) return null;
  const windows = tradeLevelWindows(trade.entry_time);
  const inputs = extractSessionInputsFromCandles({
    symbol,
    provider: "yahoo_finance",
    providerSymbol: specFor(symbol)?.yahooTicker ?? "",
    sessionDate: windows.sessionDate,
    candles: [...prior.candles, ...(today?.candles ?? [])],
    timeframe: prior.baseTimeframe,
    asOf: windows.asOf,
  });
  const levels = computeLevelsFromInputs({ symbol, sessionDate: windows.sessionDate, inputs: inputs.inputs });
  return { levels, withheld: withheldReasons(missingCandleLevels(levels), inputs.coverage, prior.baseTimeframe) };
}

/** A planning session's levels as they stood at `asOf` (PS-3, B-14). Empty when the plan did not exist yet. */
export function planLevelsAsOf(plan: PlanningSession, asOf: number) {
  return planStateAsOf(plan, asOf)?.levels ?? [];
}

/** Planned levels for a trade: same instrument (OD-15), same session date, as of the entry. */
export function plannedLineSources(
  plans: readonly PlanningSession[], trade: { symbol: string; entry_time: string },
): LineSource[] {
  const asOf = Date.parse(trade.entry_time);
  if (!Number.isFinite(asOf)) return [];
  const symbol = trade.symbol.toUpperCase();
  const date = sessionDate(asOf);
  return plans
    .filter((plan) => !plan.archived && plan.session_date === date && plan.symbol === symbol)
    .flatMap((plan) => planLevelsAsOf(plan, asOf).map((level) => ({
      key: `plan:${plan.id}:${level.id}`,
      type: "planned" as const,
      price: level.price,
      price_ticks: level.price_ticks,
      label: level.label,
    })));
}
