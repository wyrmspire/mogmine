// LV-2 (docs/24 §5, docs/12 §5): turn LV-1 levels into the lines the chart paints. Pure, no I/O.
import { computeLevelsFromInputs, extractSessionInputsFromCandles } from "./levels.ts";
import type { ComputedLevel, ComputedLevelType } from "./levels.ts";
import {
  equityIndexSessionBounds,
  offsetSessionDate,
  previousRegularSessionDate,
  sessionDate,
  sessionWeekMonday,
} from "./session.ts";
import { formatPrice } from "./format.ts";
import { specFor } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
export { stackLabels } from "./label-stack.ts";

export type LevelRole = "resistance" | "support" | "adr" | "neutral";

export interface LevelLine {
  price: number;
  price_ticks: number;
  role: LevelRole;
  /** `7547.50 PDL / ADR Low`: one pill for every level at this price (LV-09). */
  label: string;
  keys: ComputedLevelType[];
  /** A member is a settlement proxy (LV-1): the ray is dashed. */
  proxy: boolean;
  /** UTC ms where the ray starts. Null runs from the left edge (prior-day levels). */
  startAt: number | null;
}

// Opens, the pivot and settlement are neutral (docs/12 §5). ADR bands are yellow.
const NEUTRAL = new Set<ComputedLevelType>(["pdc", "pp", "rth_open", "rth_close", "globex_open"]);
// Levels formed in the trade's own session start at the bar that formed them.
const SAME_SESSION = new Set<ComputedLevelType>(["globex_open", "onh", "onl", "adr_high", "adr_low", "adr_inner_high", "adr_inner_low"]);
// docs/12 LV-07: ADR wins, then any open/pivot/settlement makes a group neutral.
const ROLE_RANK: Record<LevelRole, number> = { adr: 3, neutral: 2, resistance: 1, support: 1 };
const LABEL_PRIORITY: Record<ComputedLevelType, number> = {
  adr_high: 0, adr_low: 1, adr_inner_high: 2, adr_inner_low: 3,
  pdh: 10, pdl: 11, pdc: 12,
  rth_open: 20, globex_open: 21,
  pp: 30, r1: 31, s1: 32, r2: 33, s2: 34,
  onh: 40, onl: 41,
  rth_high: 50, rth_low: 51, rth_close: 52,
  week_high: 60, week_low: 61,
};

/** Role by type, then by side of the reference price. */
export function levelRole(level: Pick<ComputedLevel, "type" | "price">, referencePrice: number): LevelRole {
  if (level.type.startsWith("adr_")) return "adr";
  if (NEUTRAL.has(level.type) || level.price === referencePrice) return "neutral";
  return level.price > referencePrice ? "resistance" : "support";
}

/** One line per exact price, highest first. Levels at the same tick share one label. */
export function levelLines(levels: readonly ComputedLevel[], referencePrice: number, symbol: string): LevelLine[] {
  const byTick = new Map<number, ComputedLevel[]>();
  for (const level of levels) byTick.set(level.price_ticks, [...(byTick.get(level.price_ticks) ?? []), level]);
  return [...byTick.values()].map((members) => {
    const group = [...members].sort((a, b) => LABEL_PRIORITY[a.type] - LABEL_PRIORITY[b.type]);
    const roles = group.map((level) => levelRole(level, referencePrice));
    const role = roles.reduce((best, next) => ROLE_RANK[next] > ROLE_RANK[best] ? next : best);
    const starts = group.map((level) => SAME_SESSION.has(level.type) && level.formed_at ? Date.parse(level.formed_at) : null);
    const startAt = starts.some((start) => start == null || !Number.isFinite(start)) ? null : Math.min(...(starts as number[]));
    return {
      price: group[0].price,
      price_ticks: group[0].price_ticks,
      role,
      label: `${formatPrice(group[0].price, symbol)} ${group.map((level) => level.label).join(" / ")}`,
      keys: group.map((level) => level.key),
      proxy: group.some((level) => level.label === "PDC (proxy)"),
      startAt,
    };
  }).sort((a, b) => b.price_ticks - a.price_ticks);
}

// The LV-2 set advertised in the chart. Settlement needs a dated source and is therefore normally
// unavailable in Yahoo-only mode; it still has to be counted rather than silently disappearing.
const DISPLAY_LEVELS: readonly ComputedLevelType[] = [
  "pdh", "pdl", "pdc", "rth_open", "rth_high", "rth_low", "rth_close", "globex_open", "onh", "onl", "week_high", "week_low",
];

/** Candle levels withheld for missing bars. Docs/12 §5: missing-level warnings show at every preset. */
export function missingCandleLevels(levels: readonly Pick<ComputedLevel, "key">[]): ComputedLevelType[] {
  const present = new Set(levels.map((level) => level.key));
  return DISPLAY_LEVELS.filter((key) => !present.has(key));
}

/**
 * Day-mode windows for the prior session and every current-week session through entry. One request
 * stays within the route's 26-hour bound. Levels are computed as of entry, never later (B-14).
 */
export function tradeLevelWindows(entryTime: string) {
  const asOf = Date.parse(entryTime);
  const date = sessionDate(asOf);
  const prior = equityIndexSessionBounds(previousRegularSessionDate(date));
  const today = equityIndexSessionBounds(date);
  const requests = new Map<string, { from: number; to: number }>();
  const add = (from: number, to: number) => {
    if (to > from) requests.set(`${from}:${to}`, { from, to });
  };
  add(prior.open, prior.close);
  for (let day = sessionWeekMonday(date); day <= date; day = offsetSessionDate(day, 1)) {
    const bounds = equityIndexSessionBounds(day);
    add(bounds.open, Math.min(asOf, bounds.close));
  }
  return {
    sessionDate: date,
    asOf,
    prior: { from: prior.open, to: prior.close },
    today: asOf > today.open ? { from: today.open, to: Math.min(asOf, today.close) } : null,
    requests: [...requests.values()],
  };
}

export interface LevelCandles {
  candles: Candle[];
  baseTimeframe: Timeframe;
}

/** LV-1 levels for a trade from day-mode candles of its own series (LV-06). Null when nothing can be computed. */
export function tradeLevels(
  trade: { symbol: string; entry_time: string },
  sources: readonly LevelCandles[],
): ComputedLevel[] | null {
  const symbol = trade.symbol.toUpperCase();
  if ((symbol !== "MES" && symbol !== "MNQ") || !sources.length) return null;
  // Every window must be one native series and timeframe. Mixing 1m and 5m would mis-read coverage.
  const timeframe = sources[0].baseTimeframe;
  if (sources.some((source) => source.baseTimeframe !== timeframe)) return null;
  const candles = sources.flatMap((source) => source.candles);
  if (!candles.length) return null;
  const windows = tradeLevelWindows(trade.entry_time);
  const inputs = extractSessionInputsFromCandles({
    symbol,
    provider: "yahoo_finance",
    providerSymbol: specFor(symbol)?.yahooTicker ?? "",
    sessionDate: windows.sessionDate,
    candles,
    timeframe,
    asOf: windows.asOf,
  });
  const levels = computeLevelsFromInputs({ symbol, sessionDate: windows.sessionDate, inputs: inputs.inputs });
  return levels.length ? levels : null;
}
