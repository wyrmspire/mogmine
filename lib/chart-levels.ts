// LV-2 (docs/24 §5, docs/12 §5): turn LV-1 levels into the lines the chart paints. Pure, no I/O.
import { computeLevelsFromInputs, extractSessionInputsFromCandles } from "./levels.ts";
import type { ComputedLevel, ComputedLevelType } from "./levels.ts";
import { planStateAsOf } from "./plans.ts";
import type { PlanningSession } from "./plans.ts";
import { equityIndexSessionBounds, offsetSessionDate, previousRegularSessionDate, sessionDate, sessionWeekMonday } from "./session.ts";
import { formatPrice } from "./format.ts";
import { specFor } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import { withheldReasons } from "./level-withheld.ts";
import type { WithheldLevel } from "./level-withheld.ts";
import type { IndicatorColor, IndicatorLineStyle } from "./indicator-kit.ts";
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
  /** Optional end of a historical day span. Null/absent extends to the latest chart bar. */
  endAt?: number | null;
  /** A settlement-type level (PDC, 3 PM close, settle): drawn as a quiet 1px dotted ray (Q-7, LB-4). */
  settlement?: boolean;
  color?: IndicatorColor;
  lineStyle?: IndicatorLineStyle;
  lineWidth?: number;
}

export interface LevelZone {
  id: string;
  label: string;
  priceLow: number;
  priceHigh: number;
  role: LevelRole;
  /** Lines shown by the existing level card when this rectangle is tapped. */
  lines?: LevelLine[];
  startAt?: number | null;
  endAt?: number | null;
  color?: IndicatorColor;
  lineStyle?: IndicatorLineStyle;
  lineWidth?: number;
  fillOpacity?: number;
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

const ZONE_LABEL_RANK = ["adr_", "pdh", "pdl", "pdc", "globex_open", "rth_open", "pp", "r1", "s1", "r2", "s2", "onh", "onl", "rth_", "week_"];
const zoneRank = (line: LevelLine) => Math.min(...line.keys.map((key) => {
  const rank = ZONE_LABEL_RANK.findIndex((prefix) => key.includes(prefix));
  return rank < 0 ? ZONE_LABEL_RANK.length : rank;
}));

/** LV-07: merge point levels by nearest edge. Singletons remain rays; merged groups become rectangles. */
export function mergeLevelZones(lines: readonly LevelLine[], tolerancePts: number): { lines: LevelLine[]; zones: LevelZone[] } {
  const tolerance = Number.isFinite(tolerancePts) ? Math.max(0, tolerancePts) : 0;
  const bySpan = new Map<string, LevelLine[]>();
  for (const line of lines) {
    const key = `${line.startAt ?? "left"}:${line.endAt ?? "right"}`;
    bySpan.set(key, [...(bySpan.get(key) ?? []), line]);
  }
  const rays: LevelLine[] = [];
  const zones: LevelZone[] = [];
  for (const groupLines of bySpan.values()) {
    const ordered = [...groupLines].sort((a, b) => a.price - b.price || zoneRank(a) - zoneRank(b));
    let group: LevelLine[] = [];
    const flush = () => {
      if (group.length < 2) { rays.push(...group); group = []; return; }
      const members = [...group].sort((a, b) => zoneRank(a) - zoneRank(b) || b.price - a.price);
      const role: LevelRole = members.some(({ role: item }) => item === "adr") ? "adr"
        : members.some(({ role: item }) => item === "neutral") ? "neutral" : members[0].role;
      zones.push({
        id: `zone:${members.flatMap(({ keys }) => keys).join("+")}`,
        label: members.map(({ names }) => names).join(" / "),
        priceLow: Math.min(...members.map(({ price }) => price)), priceHigh: Math.max(...members.map(({ price }) => price)),
        role, lines: members, startAt: members[0].startAt, endAt: members[0].endAt,
      });
      group = [];
    };
    for (const line of ordered) {
      if (group.length && line.price - Math.max(...group.map(({ price }) => price)) > tolerance) flush();
      group.push(line);
    }
    flush();
  }
  return { lines: rays.sort((a, b) => b.price - a.price), zones };
}

/** Exact Globex day spans, newest first. Historical drawings never leak into an adjacent day. */
export function sessionDaySpans(date: string, daysBack: number) {
  const count = Math.min(10, Math.max(1, Math.trunc(daysBack)));
  let sessionDate = date;
  return Array.from({ length: count }, (_, index) => {
    if (index > 0) sessionDate = previousRegularSessionDate(sessionDate);
    const bounds = equityIndexSessionBounds(sessionDate);
    return { sessionDate, from: bounds.open, to: bounds.close };
  });
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
 * The whole regular sessions of the current week (Monday on) that come before the prior session, in order.
 * They feed `week_high` and `week_low` (LV-1). Monday to Tuesday gives none: the prior session covers them.
 */
export function earlierWeekSessionWindows(sessionDateStr: string): Array<{ sessionDate: string; from: number; to: number }> {
  const prior = previousRegularSessionDate(sessionDateStr);
  const windows: Array<{ sessionDate: string; from: number; to: number }> = [];
  for (let day = sessionWeekMonday(sessionDateStr); day < prior; day = offsetSessionDate(day, 1)) {
    const bounds = equityIndexSessionBounds(day);
    windows.push({ sessionDate: day, from: bounds.open, to: bounds.close });
  }
  return windows;
}

/**
 * The day-mode windows the levels need for a trade: the whole prior session, the trade's session up to
 * entry, and the earlier sessions of its week. Levels are computed as of the entry, never later (no look-ahead, B-14).
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
    earlierWeek: earlierWeekSessionWindows(date),
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
  earlierWeek?: readonly (LevelCandles | null)[],
): ComputedLevel[] | null {
  const report = tradeLevelReport(trade, prior, today, earlierWeek);
  return report?.levels.length ? report.levels : null;
}

/** The levels and, for each candle level withheld, why (OD-55). Null for another instrument or mixed timeframes. */
export function tradeLevelReport(
  trade: { symbol: string; entry_time: string },
  prior: LevelCandles,
  today: LevelCandles | null,
  earlierWeek?: readonly (LevelCandles | null)[],
): { levels: ComputedLevel[]; withheld: WithheldLevel[] } | null {
  const symbol = trade.symbol.toUpperCase();
  if (symbol !== "MES" && symbol !== "MNQ") return null;
  // IK-1 mixed rows carry their own native widths, so session windows may have different finest intervals.
  // Legacy uniform rows still require matching timeframes to avoid reading a 5m bar as one minute.
  const isTagged = (day: LevelCandles) => day.candles.every((bar) => "minutes" in bar && "fillFrom" in bar);
  if (today && today.baseTimeframe !== prior.baseTimeframe && (!isTagged(today) || !isTagged(prior))) return null;
  const matchingEarlier = (earlierWeek ?? []).filter((day): day is LevelCandles => day !== null
    && (day.baseTimeframe === prior.baseTimeframe || (isTagged(day) && isTagged(prior))));
  const windows = tradeLevelWindows(trade.entry_time);
  const inputs = extractSessionInputsFromCandles({
    symbol,
    provider: "yahoo_finance",
    providerSymbol: specFor(symbol)?.yahooTicker ?? "",
    sessionDate: windows.sessionDate,
    candles: [...matchingEarlier.flatMap((day) => day.candles), ...prior.candles, ...(today?.candles ?? [])],
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
    .flatMap((plan) => planLevelsAsOf(plan, asOf).filter((level) => level.kind === "level").map((level) => ({
      key: `plan:${plan.id}:${level.id}`,
      type: "planned" as const,
      price: level.price,
      price_ticks: level.price_ticks,
      label: level.label,
    })));
}

/** PS-3 / IK-3: matching zone_low + zone_high plan levels draw as one right-extending rectangle. */
export function plannedZones(
  plans: readonly PlanningSession[], trade: { symbol: string; entry_time: string }, referencePrice: number,
): LevelZone[] {
  const asOf = Date.parse(trade.entry_time);
  if (!Number.isFinite(asOf)) return [];
  const symbol = trade.symbol.toUpperCase();
  const date = sessionDate(asOf);
  return plans.filter((plan) => !plan.archived && plan.session_date === date && plan.symbol === symbol).flatMap((plan) => {
    const levels = planLevelsAsOf(plan, asOf);
    const byLabel = new Map<string, typeof levels>();
    for (const item of levels.filter(({ kind }) => kind !== "level")) byLabel.set(item.label, [...(byLabel.get(item.label) ?? []), item]);
    return [...byLabel].flatMap(([label, bounds]) => {
      const low = bounds.find(({ kind }) => kind === "zone_low");
      const high = bounds.find(({ kind }) => kind === "zone_high");
      if (!low || !high) return [];
      const priceLow = Math.min(low.price, high.price);
      const priceHigh = Math.max(low.price, high.price);
      const role: LevelRole = priceLow > referencePrice ? "resistance" : priceHigh < referencePrice ? "support" : "neutral";
      const lines = levelLines(bounds.map((item) => ({ key: `plan:${plan.id}:${item.id}`, type: "planned", price: item.price, price_ticks: item.price_ticks, label: item.label })), referencePrice, symbol);
      return [{ id: `plan-zone:${plan.id}:${label}`, label, priceLow, priceHigh, role, lines, startAt: null }];
    });
  });
}
