// LV-1, docs/12 §3A and docs/24 §5. All session boundaries use America/New_York.
import {
  equityIndexSessionBounds, offsetSessionDate, previousRegularSessionDate, sessionWeekMonday,
} from "./session.ts";
import { snapToTick, specFor, TIMEFRAME_MINUTES, toTicks } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";
import { asMixedCandle, readMixedWindow } from "./mixed-resolution.ts";
import type { MixedCandle } from "./mixed-resolution.ts";

const LABELS = {
  pdh: "PDH", pdl: "PDL", pdc: "PDC", rth_open: "RTH open", rth_high: "RTH high",
  rth_low: "RTH low", rth_close: "3 PM close", globex_open: "Globex open", onh: "ONH", onl: "ONL",
  pp: "PP", r1: "R1", s1: "S1", r2: "R2", s2: "S2", adr_high: "ADR High", adr_low: "ADR Low",
  adr_inner_high: "ADR inner high", adr_inner_low: "ADR inner low", week_high: "Wk high", week_low: "Wk low",
} as const;

export type ComputedLevelType = keyof typeof LABELS;

/** Display name of a level type (`PDH`, `Wk high`). */
export const levelLabel = (type: ComputedLevelType) => LABELS[type];

export interface ComputedLevel {
  key: ComputedLevelType;
  type: ComputedLevelType;
  label: (typeof LABELS)[ComputedLevelType] | "PDC (proxy)";
  price: number;
  price_ticks: number;
  formed_at?: string;
  formula: string;
}

interface DailyRange {
  session_date: string;
  high: number;
  low: number;
}

interface SettlementQuote {
  symbol: "MES" | "MNQ";
  sessionDate: string;
  availableAt: number;
  price: number;
  source: string;
  isProxy: boolean;
}

interface LevelSetInputs {
  prior_session: {
    session_date: string;
    high?: number;
    high_at?: string;
    low?: number;
    low_at?: string;
    settle?: number;
    settle_at?: string;
    settle_provenance?: Pick<SettlementQuote, "source" | "isProxy">;
  };
  prior_rth?: {
    open?: number;
    open_at?: string;
    high?: number;
    high_at?: string;
    low?: number;
    low_at?: string;
    close_1500?: number;
    close_at?: string;
  };
  overnight?: {
    globex_open?: number;
    open_at?: string;
    onh?: number;
    onh_at?: string;
    onl?: number;
    onl_at?: string;
  };
  adr?: { value?: number; history?: readonly DailyRange[]; length?: number; inner_multiplier?: number };
  week?: { week_high: number; week_high_at: string; week_low: number; week_low_at: string };
}

interface ComputeLevelsOptions {
  symbol: string;
  sessionDate: string;
  inputs: LevelSetInputs;
}

function level(
  symbol: string, type: ComputedLevelType, value: number | undefined, formula: string, formed_at?: string,
  label: ComputedLevel["label"] = LABELS[type],
): ComputedLevel[] {
  if (value === undefined) return [];
  const price = snapToTick(value, symbol);
  const price_ticks = price === null ? null : toTicks(price, symbol);
  if (price === null || price_ticks === null || !Number.isSafeInteger(price_ticks)) return [];
  return [{ key: type, type, label, price, price_ticks, formula, ...(formed_at ? { formed_at } : {}) }];
}

export function computeFloorPivots(h: number, l: number, c: number, symbol: string): ComputedLevel[] {
  if (![h, l, c].every(Number.isFinite) || h < l) return [];
  const pp = (h + l + c) / 3;
  return [
    ...level(symbol, "pp", pp, "(H + L + C)/3"),
    ...level(symbol, "r1", 2 * pp - l, "2·PP − L"),
    ...level(symbol, "s1", 2 * pp - h, "2·PP − H"),
    ...level(symbol, "r2", pp + (h - l), "PP + (H − L)"),
    ...level(symbol, "s2", pp - (h - l), "PP − (H − L)"),
  ];
}

export function computeAdrBands(
  open: number, adr: number, symbol: string, multiplier = 0.33, formedAt?: string,
): ComputedLevel[] {
  if (!Number.isFinite(adr) || adr < 0 || !Number.isFinite(multiplier) || multiplier < 0) return [];
  const outer = adr / 2;
  const inner = multiplier * outer;
  return [
    ...level(symbol, "adr_high", open + outer, "Open + ADR/2", formedAt),
    ...level(symbol, "adr_low", open - outer, "Open − ADR/2", formedAt),
    ...level(symbol, "adr_inner_high", open + inner, `Open + ${multiplier}·ADR/2`, formedAt),
    ...level(symbol, "adr_inner_low", open - inner, `Open − ${multiplier}·ADR/2`, formedAt),
  ];
}

/** Average over the latest completed sessions. A gap or duplicate leaves the range unavailable (OD-35). */
export function calculateAdrValue(history: readonly DailyRange[], sessionDate: string, length = 14): number | null {
  if (!Number.isSafeInteger(length) || length < 1 || history.length < length) return null;
  const ranges = new Map<string, DailyRange | null>();
  for (const range of history) {
    ranges.set(range.session_date, ranges.has(range.session_date) ? null : range);
  }
  let date = sessionDate;
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    date = previousRegularSessionDate(date);
    const range = ranges.get(date);
    if (!range || !Number.isFinite(range.high) || !Number.isFinite(range.low) || range.high < range.low) return null;
    sum += range.high - range.low;
  }
  return sum / length;
}

/** Turn session inputs into displayable levels. Missing inputs leave the corresponding levels absent. */
export function computeLevelsFromInputs({ symbol, sessionDate, inputs }: ComputeLevelsOptions): ComputedLevel[] {
  const { prior_session: prior, prior_rth: rth, overnight: on, adr, week } = inputs;
  const { high, low } = prior;
  const settle = prior.settle_provenance?.source.trim() ? prior.settle : undefined;
  const isSettlementProxy = prior.settle_provenance?.isProxy;
  const pivots = high !== undefined && low !== undefined && settle !== undefined
    ? computeFloorPivots(high, low, settle, symbol)
    : [];
  const average = adr?.value ?? (adr?.history ? calculateAdrValue(adr.history, sessionDate, adr.length) : null);
  const bands = on?.globex_open !== undefined && average !== null
    ? computeAdrBands(on.globex_open, average, symbol, adr?.inner_multiplier, on.open_at)
    : [];
  return [
    ...level(symbol, "pdh", high, `Globex high ${prior.session_date}`, prior.high_at),
    ...level(symbol, "pdl", low, `Globex low ${prior.session_date}`, prior.low_at),
    ...level(symbol, "pdc", settle,
      `${isSettlementProxy ? "Settlement proxy" : "Settlement"} ${prior.session_date}`, prior.settle_at,
      isSettlementProxy ? "PDC (proxy)" : "PDC"),
    ...level(symbol, "rth_open", rth?.open, "Open of prior 08:30 CT bar", rth?.open_at),
    ...level(symbol, "rth_high", rth?.high, "Prior RTH high", rth?.high_at),
    ...level(symbol, "rth_low", rth?.low, "Prior RTH low", rth?.low_at),
    ...level(symbol, "rth_close", rth?.close_1500, "Close of prior 14:59 CT bar", rth?.close_at),
    ...level(symbol, "globex_open", on?.globex_open, "Open of 17:00 CT bar", on?.open_at),
    ...level(symbol, "onh", on?.onh, "Overnight high as of cutoff", on?.onh_at),
    ...level(symbol, "onl", on?.onl, "Overnight low as of cutoff", on?.onl_at),
    ...pivots,
    ...bands,
    ...level(symbol, "week_high", week?.week_high, "High of current Globex week as of cutoff", week?.week_high_at),
    ...level(symbol, "week_low", week?.week_low, "Low of current Globex week as of cutoff", week?.week_low_at),
  ];
}

function extremes(bars: readonly Candle[]) {
  const first = bars[0];
  if (!first) return undefined;
  const high = bars.reduce((best, bar) => bar.high > best.high ? bar : best, first);
  const low = bars.reduce((best, bar) => bar.low < best.low ? bar : best, first);
  return { high: high.high, high_at: iso(high.time), low: low.low, low_at: iso(low.time) };
}

const iso = (time: number) => new Date(time).toISOString();

/** The caller supplies native candles from the stated MES or MNQ series and timeframe. */
export function extractSessionInputsFromCandles(options: {
  symbol: "MES" | "MNQ";
  provider: string;
  providerSymbol: string;
  sessionDate: string;
  candles: readonly Candle[];
  timeframe: Timeframe;
  asOf: number;
  settlement?: SettlementQuote;
  adr?: LevelSetInputs["adr"];
}) {
  const { symbol, provider, providerSymbol, sessionDate, candles, timeframe, asOf, settlement, adr } = options;
  const spec = specFor(symbol);
  if (provider === "yahoo_finance" && providerSymbol !== spec?.yahooTicker) {
    throw new RangeError(`Expected ${spec?.yahooTicker} candles for ${symbol}, received ${providerSymbol}`);
  }
  const priorDate = previousRegularSessionDate(sessionDate);
  const prior = equityIndexSessionBounds(priorDate);
  const today = equityIndexSessionBounds(sessionDate);
  const tagged = candles.every((bar) => "minutes" in bar && "fillFrom" in bar);
  const converted = candles.map((bar) => "minutes" in bar && "fillFrom" in bar
    ? bar as MixedCandle : asMixedCandle(bar, timeframe));
  const duplicateKeys = new Set(converted.flatMap((bar, index) => converted.some((other, otherIndex) => otherIndex !== index
    && other.time === bar.time && other.minutes === bar.minutes) ? [`${bar.time}:${bar.minutes}`] : []));
  const mixed = converted.filter((bar) => !duplicateKeys.has(`${bar.time}:${bar.minutes}`));
  const read = (from: number, to: number) => readMixedWindow(mixed, symbol, from, to, asOf, tagged ? 1 : TIMEFRAME_MINUTES[timeframe]);
  const previous = read(prior.open, prior.close);
  const rth = read(prior.rthOpen, prior.rthClose);
  const overnight = read(today.open, today.rthOpen);
  const rthOpen = mixed.find((bar) => bar.time === prior.rthOpen);
  const globexOpen = mixed.find((bar) => bar.time === today.open);
  const rthClose = mixed.find((bar) => bar.time + bar.minutes * 60_000 === prior.rthClose);
  const on = overnight.coverage.complete ? extremes(overnight.bars) : undefined;
  const weekWindows = [];
  for (let day = sessionWeekMonday(sessionDate); day <= sessionDate; day = offsetSessionDate(day, 1)) {
    const bounds = equityIndexSessionBounds(day);
    weekWindows.push(read(bounds.open, bounds.close));
  }
  const week = weekWindows.every(({ coverage }) => coverage.complete)
    ? extremes(weekWindows.flatMap(({ bars }) => bars))
    : undefined;
  const knownSettle = settlement?.symbol === symbol && settlement.sessionDate === priorDate
    && Number.isFinite(settlement.price) && settlement.source.trim().length > 0
    && Number.isFinite(new Date(settlement.availableAt).getTime()) && settlement.availableAt <= asOf
    ? settlement : undefined;
  const inputs: LevelSetInputs = {
    prior_session: {
      session_date: priorDate,
      ...(previous.coverage.complete && previous.coverage.to === prior.close ? extremes(previous.bars) : undefined),
      settle: knownSettle?.price,
      settle_at: knownSettle && iso(knownSettle.availableAt),
      settle_provenance: knownSettle && { source: knownSettle.source, isProxy: knownSettle.isProxy },
    },
    prior_rth: {
      ...(rth.coverage.complete && rth.coverage.to === prior.rthClose ? extremes(rth.bars) : undefined),
      open: rthOpen?.open,
      open_at: rthOpen && iso(rthOpen.time),
      close_1500: rthClose?.close,
      close_at: rthClose && iso(prior.rthClose),
    },
    overnight: {
      globex_open: globexOpen?.open,
      open_at: globexOpen && iso(globexOpen.time),
      onh: on?.high, onh_at: on?.high_at,
      onl: on?.low, onl_at: on?.low_at,
    },
    adr,
    week: week && {
      week_high: week.high, week_high_at: week.high_at,
      week_low: week.low, week_low_at: week.low_at,
    },
  };
  return {
    symbol, provider, providerSymbol, calcVersion: "levels-v2-mixed-resolution", sessionDate, timeframe, asOf, inputs,
    coverage: { previous: previous.coverage, rth: rth.coverage, overnight: overnight.coverage, week: weekWindows.map(({ coverage }) => coverage) },
  };
}
