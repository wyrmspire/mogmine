// Multi-timeframe and 1m structure skills (09 §9 S2–S4).
// S2 mtfCandle: the ET-aligned 5m/15m/60m candle containing bar i, and the last completed one.
// S3 structure5m: confirmed 5m swings from completed candles only.
// S4 confirm1m: 1m reclaim of the extreme made before bar i.
// Every reader stops at bar i: a bucket is "complete" only when its last minute is <= i.

import type {
  BarSeries, OutputSpec, ParamSpec, Skill, SkillContext, SkillMeta, SkillPreflight, SkillResult, Value,
} from "../types.ts";

const MTF_MINUTES = [5, 15, 60] as const;
/** A bucket with more than 20% of its minutes missing is a coverage skip (09 §9 S2). */
const MAX_MISSING_FRACTION = 0.2;
/** Fewer usable prior candles than this makes a percentile null (warmup). */
const MIN_PERCENTILE_SAMPLE = 20;
const EPS = 1e-9;

// ---------- shared helpers ----------

interface Candle {
  start: number;
  minutes: number;
  open: number;
  high: number;
  low: number;
  close: number;
  present: number;
  /** Minutes elapsed up to the decision time, or the full size for a complete candle. */
  expected: number;
  /** True when the decision time has reached the candle's last minute. */
  ended: boolean;
}

/** Aggregate the ET-aligned bucket starting at `start`, using only bars with time <= upTo. */
export function candleAt(series: BarSeries, start: number, minutes: number, upTo: number): Candle | null {
  const end = start + (minutes - 1) * series.barMs;
  const last = Math.min(upTo, end);
  let open = Number.NaN;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let close = Number.NaN;
  let present = 0;
  for (let t = start; t <= last; t += series.barMs) {
    const index = series.byTime.get(t);
    if (index === undefined) continue;
    if (present === 0) open = series.open[index];
    present += 1;
    high = Math.max(high, series.high[index]);
    low = Math.min(low, series.low[index]);
    close = series.close[index];
  }
  if (present === 0) return null;
  return {
    start, minutes, open, high, low, close, present,
    expected: Math.round((last - start) / series.barMs) + 1,
    ended: last === end,
  };
}

function usable(candle: Candle | null): candle is Candle {
  return candle !== null && candle.present >= (1 - MAX_MISSING_FRACTION) * candle.expected;
}

/** Start of the ET-aligned bucket containing bar i, and whether that bucket has ended by i. */
function bucketOf(series: BarSeries, i: number, minutes: number) {
  const offset = series.etMinute[i] % minutes;
  return { start: series.time[i] - offset * series.barMs, ended: offset === minutes - 1 };
}

interface Shape {
  range: number;
  body: number;
  bodyPct: number | null;
  upperWick: number;
  lowerWick: number;
  direction: "up" | "down" | "doji";
}

function shapeOf(candle: Candle, tick: number): Shape {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const top = Math.max(candle.open, candle.close);
  const bottom = Math.min(candle.open, candle.close);
  const direction = body <= tick + EPS ? "doji" : candle.close > candle.open ? "up" : "down";
  return {
    range,
    body,
    bodyPct: range > 0 ? body / range : null,
    upperWick: candle.high - top,
    lowerWick: bottom - candle.low,
    direction,
  };
}

/** Midrank percentile (0–100) of x against the reference sample; ties count half. Null below the sample floor. */
export function midrankPercentile(x: number, sample: readonly number[]): number | null {
  if (sample.length < MIN_PERCENTILE_SAMPLE) return null;
  let less = 0;
  let equal = 0;
  for (const value of sample) {
    if (value < x) less += 1;
    else if (value === x) equal += 1;
  }
  return ((less + equal / 2) / sample.length) * 100;
}

function intParam(params: Record<string, Value>, key: string, fallback: number, min: number, max: number): number | null {
  const raw = params[key] ?? fallback;
  const value = typeof raw === "number" ? raw : Number.NaN;
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function indexOk(ctx: SkillContext): SkillPreflight {
  return Number.isInteger(ctx.i) && ctx.i >= 0 && ctx.i < ctx.series.time.length
    ? { ok: true }
    : { ok: false, reason: "warmup", detail: "No bar at the decision index" };
}

// ---------- S2 mtfCandle ----------

const MTF_PARAMS: readonly ParamSpec[] = [
  { key: "minutes", type: "integer", default: 15, min: 5, max: 60, options: ["5", "15", "60"], label: "Candle size (minutes: 5, 15 or 60)" },
  { key: "pctileLookback", type: "integer", default: 40, min: 20, max: 100, label: "Completed candles for percentiles" },
];

const CANDLE_FIELDS = ["range", "body", "bodyPct", "upperWick", "lowerWick", "rangePctile", "upperWickPctile", "lowerWickPctile", "direction"] as const;
const CANDLE_LABELS: Record<(typeof CANDLE_FIELDS)[number], [string, OutputSpec["type"], OutputSpec["unit"]?]> = {
  range: ["Range (pt)", "number", "points"],
  body: ["Body (pt)", "number", "points"],
  bodyPct: ["Body ÷ range", "number", "ratio"],
  upperWick: ["Upper wick (pt)", "number", "points"],
  lowerWick: ["Lower wick (pt)", "number", "points"],
  rangePctile: ["Range (pctile)", "number", "pct"],
  upperWickPctile: ["Upper wick (pctile)", "number", "pct"],
  lowerWickPctile: ["Lower wick (pctile)", "number", "pct"],
  direction: ["Direction", "category", undefined],
};
const DIRECTIONS = ["up", "down", "doji"] as const;

/** Output key for a candle field: "range" for the current candle, "prevRange" for the last completed one. */
function keyOf(prefix: "" | "prev", field: (typeof CANDLE_FIELDS)[number]): string {
  return prefix === "" ? field : `prev${field.charAt(0).toUpperCase()}${field.slice(1)}`;
}

function candleOutputs(prefix: "" | "prev"): OutputSpec[] {
  return CANDLE_FIELDS.map((field) => {
    const [label, type, unit] = CANDLE_LABELS[field];
    const text = prefix === "" ? label : `Last completed ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
    return type === "category"
      ? { key: keyOf(prefix, field), type, label: text, categories: DIRECTIONS }
      : { key: keyOf(prefix, field), type, label: text, unit };
  });
}

export const mtfCandleMeta: SkillMeta = {
  id: "mtfCandle",
  version: "1.0.0",
  kind: "feature",
  title: "Multi-timeframe candle",
  description: "The ET-aligned 5m/15m/60m candle containing bar i (forming or complete) and the last completed one, with percentiles against prior completed candles of the same size.",
  status: "active",
  params: MTF_PARAMS,
  outputs: [
    ...candleOutputs(""),
    { key: "forming", type: "boolean", label: "Candle containing bar i is still forming" },
    ...candleOutputs("prev"),
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 60 * 102, volume: false },
  knownAt: "bar-close",
  warnings: ["Forming candle values are partial at the decision time; percentiles compare against completed candles only."],
};

interface Measured {
  shape: Shape;
  rangePctile: number | null;
  upperWickPctile: number | null;
  lowerWickPctile: number | null;
  refs: number;
}

function measureCandle(series: BarSeries, start: number, minutes: number, upTo: number, lookback: number, tick: number): Measured | null {
  const anchor = candleAt(series, start, minutes, upTo);
  if (!usable(anchor)) return null;
  const refs: Shape[] = [];
  for (let k = 1; k <= lookback; k += 1) {
    const priorStart = start - k * minutes * series.barMs;
    const prior = candleAt(series, priorStart, minutes, priorStart + (minutes - 1) * series.barMs);
    if (usable(prior)) refs.push(shapeOf(prior, tick));
  }
  const shape = shapeOf(anchor, tick);
  return {
    shape,
    rangePctile: midrankPercentile(shape.range, refs.map((r) => r.range)),
    upperWickPctile: midrankPercentile(shape.upperWick, refs.map((r) => r.upperWick)),
    lowerWickPctile: midrankPercentile(shape.lowerWick, refs.map((r) => r.lowerWick)),
    refs: refs.length,
  };
}

function candleValues(prefix: "" | "prev", m: Measured | null): Record<string, Value> {
  const v = m && {
    range: m.shape.range, body: m.shape.body, bodyPct: m.shape.bodyPct,
    upperWick: m.shape.upperWick, lowerWick: m.shape.lowerWick,
    rangePctile: m.rangePctile, upperWickPctile: m.upperWickPctile, lowerWickPctile: m.lowerWickPctile,
    direction: m.shape.direction,
  };
  return Object.fromEntries(CANDLE_FIELDS.map((field) => [keyOf(prefix, field), v ? v[field] : null]));
}

function mtfPreflight(ctx: SkillContext): SkillPreflight {
  const parsed = mtfParams(ctx.params);
  if (!parsed) return { ok: false, reason: "bad-params", detail: "minutes must be 5, 15 or 60; pctileLookback 20–100" };
  return indexOk(ctx);
}

function mtfParams(params: Record<string, Value>): { minutes: number; lookback: number } | null {
  const minutes = intParam(params, "minutes", 15, 5, 60);
  const lookback = intParam(params, "pctileLookback", 40, 20, 100);
  if (minutes === null || lookback === null || !(MTF_MINUTES as readonly number[]).includes(minutes)) return null;
  return { minutes, lookback };
}

function mtfCompute(ctx: SkillContext): SkillResult {
  const parsed = mtfParams(ctx.params);
  if (!parsed) return { ok: false, reason: "bad-params", detail: "Invalid mtfCandle params" };
  const { minutes, lookback } = parsed;
  const { series, i } = ctx;
  const tick = ctx.spec.tickSize;
  const bucket = bucketOf(series, i, minutes);

  const current = measureCandle(series, bucket.start, minutes, series.time[i], lookback, tick);
  if (!current) {
    return { ok: false, reason: "coverage", detail: `${minutes}m candle has more than 20% of its minutes missing` };
  }
  const notes: string[] = [];
  if (current.refs < MIN_PERCENTILE_SAMPLE) notes.push(`warmup: ${current.refs} usable prior ${minutes}m candles (<${MIN_PERCENTILE_SAMPLE})`);

  // The last completed candle is the current one when it has ended by i; otherwise the one before it.
  const lastCompletedStart = bucket.ended ? bucket.start : bucket.start - minutes * series.barMs;
  const prev = bucket.ended
    ? current
    : measureCandle(series, lastCompletedStart, minutes, lastCompletedStart + (minutes - 1) * series.barMs, lookback, tick);
  if (!prev) notes.push(`coverage: last completed ${minutes}m candle unusable`);

  return {
    ok: true,
    values: {
      ...candleValues("", current),
      forming: !bucket.ended,
      ...candleValues("prev", prev),
    },
    notes,
  };
}

export const mtfCandleSkill: Skill = { meta: mtfCandleMeta, preflight: mtfPreflight, compute: mtfCompute };

// ---------- S3 structure5m ----------

const STRUCTURE_CATEGORIES = ["up", "down", "mixed", "none"] as const;

export const structure5mMeta: SkillMeta = {
  id: "structure5m",
  version: "1.0.0",
  kind: "label",
  title: "5m structure",
  description: "Confirmed 5m swing highs and lows over the last candles, and whether the latest low is the first higher low after two lower lows.",
  status: "active",
  params: [
    { key: "swingBars", type: "integer", default: 2, min: 1, max: 5, label: "Candles each side to confirm a swing" },
    { key: "lookbackCandles", type: "integer", default: 12, min: 4, max: 60, label: "5m candles to scan for swings" },
  ],
  outputs: [
    { key: "structure", type: "category", label: "5m structure", categories: STRUCTURE_CATEGORIES },
    { key: "higherLows", type: "number", label: "Higher lows in lookback", unit: "contracts" },
    { key: "lowerHighs", type: "number", label: "Lower highs in lookback", unit: "contracts" },
    { key: "lastSwingLow", type: "number", label: "Last confirmed swing low", unit: "points" },
    { key: "lastSwingHigh", type: "number", label: "Last confirmed swing high", unit: "points" },
    { key: "firstHigherLow", type: "boolean", label: "Latest low is the first higher low after two lower lows" },
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 5 * 80, volume: false },
  knownAt: "bar-close",
};

const structure5mParams = (params: Record<string, Value>) => {
  const swingBars = intParam(params, "swingBars", 2, 1, 5);
  const lookbackCandles = intParam(params, "lookbackCandles", 12, 4, 60);
  return swingBars === null || lookbackCandles === null ? null : { swingBars, lookbackCandles };
};

function structurePreflight(ctx: SkillContext): SkillPreflight {
  if (!structure5mParams(ctx.params)) return { ok: false, reason: "bad-params", detail: "swingBars 1–5, lookbackCandles 4–60" };
  return indexOk(ctx);
}

function structureCompute(ctx: SkillContext): SkillResult {
  const parsed = structure5mParams(ctx.params);
  if (!parsed) return { ok: false, reason: "bad-params", detail: "Invalid structure5m params" };
  const { swingBars, lookbackCandles } = parsed;
  const { series, i } = ctx;
  const bucket = bucketOf(series, i, 5);
  // Only completed candles may confirm a swing (no lookahead into the forming candle).
  const last = bucket.ended ? bucket.start : bucket.start - 5 * series.barMs;

  const count = lookbackCandles + 2 * swingBars;
  const candles: (Candle | null)[] = [];
  for (let k = 0; k < count; k += 1) {
    const start = last - (count - 1 - k) * 5 * series.barMs;
    const candle = candleAt(series, start, 5, start + 4 * series.barMs);
    candles.push(usable(candle) ? candle : null);
  }

  const highs: number[] = [];
  const lows: number[] = [];
  const unusable = candles.filter((candle) => candle === null).length;
  for (let k = count - lookbackCandles; k <= count - 1 - swingBars; k += 1) {
    const neighbourhood = candles.slice(k - swingBars, k + swingBars + 1);
    const centre = candles[k];
    if (!centre || neighbourhood.some((candle) => candle === null)) continue;
    const others = neighbourhood.filter((_, offset) => offset !== swingBars) as Candle[];
    if (others.every((other) => centre.high > other.high)) highs.push(centre.high);
    if (others.every((other) => centre.low < other.low)) lows.push(centre.low);
  }

  const n = lows.length - 1;
  const hUp = highs.length >= 2 && highs[highs.length - 1] > highs[highs.length - 2];
  const hDown = highs.length >= 2 && highs[highs.length - 1] < highs[highs.length - 2];
  const lUp = lows.length >= 2 && lows[n] > lows[n - 1];
  const lDown = lows.length >= 2 && lows[n] < lows[n - 1];
  let structure: (typeof STRUCTURE_CATEGORIES)[number] = "mixed";
  if (highs.length < 2 || lows.length < 2) structure = "none";
  else if (hUp && lUp) structure = "up";
  else if (hDown && lDown) structure = "down";

  let higherLows = 0;
  for (let k = 1; k < lows.length; k += 1) if (lows[k] > lows[k - 1]) higherLows += 1;
  let lowerHighs = 0;
  for (let k = 1; k < highs.length; k += 1) if (highs[k] < highs[k - 1]) lowerHighs += 1;

  const firstHigherLow = lows.length >= 4 && lows[n] > lows[n - 1] && lows[n - 1] < lows[n - 2] && lows[n - 2] < lows[n - 3];

  return {
    ok: true,
    values: {
      structure,
      higherLows,
      lowerHighs,
      lastSwingLow: lows.length > 0 ? lows[n] : null,
      lastSwingHigh: highs.length > 0 ? highs[highs.length - 1] : null,
      firstHigherLow,
    },
    notes: unusable > 0 ? [`gap: ${unusable} of ${count} 5m candles unusable`] : [],
  };
}

export const structure5mSkill: Skill = { meta: structure5mMeta, preflight: structurePreflight, compute: structureCompute };

// ---------- S4 confirm1m ----------

const SIDES = ["long", "short"] as const;

export const confirm1mMeta: SkillMeta = {
  id: "confirm1m",
  version: "1.0.0",
  kind: "label",
  title: "1m confirmation",
  description: "Whether bar i reclaims the extreme made in the bars before it (long: the lowest low, close above its high; short mirrors), and whether a 1m swing formed above it.",
  status: "active",
  params: [
    { key: "lookbackBars", type: "integer", default: 15, min: 2, max: 240, label: "1m bars before i to search for the extreme" },
    { key: "side", type: "enum", default: "long", options: SIDES, label: "Side" },
  ],
  outputs: [
    { key: "reclaim", type: "boolean", label: "Reclaim of the prior extreme" },
    { key: "higherLow", type: "boolean", label: "1m swing after the extreme holds (short: lower high)" },
    { key: "barsSinceExtreme", type: "number", label: "1m bars since the extreme", unit: "bars" },
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 240, volume: false },
  knownAt: "bar-close",
};

const confirmParams = (params: Record<string, Value>) => {
  const lookbackBars = intParam(params, "lookbackBars", 15, 2, 240);
  const side = params.side ?? "long";
  return lookbackBars === null || (side !== "long" && side !== "short") ? null : { lookbackBars, side };
};

function confirmPreflight(ctx: SkillContext): SkillPreflight {
  if (!confirmParams(ctx.params)) return { ok: false, reason: "bad-params", detail: "lookbackBars 2–240; side long or short" };
  return indexOk(ctx);
}

function confirmCompute(ctx: SkillContext): SkillResult {
  const parsed = confirmParams(ctx.params);
  if (!parsed) return { ok: false, reason: "bad-params", detail: "Invalid confirm1m params" };
  const { lookbackBars, side } = parsed;
  const { series, i } = ctx;
  const long = side === "long";
  // Extreme is the most extreme 1m bar strictly before i (ties → the latest), so j < i by construction.
  const toPrice = (k: number) => (long ? series.low[k] : series.high[k]);
  const beats = (a: number, b: number) => (long ? a <= b : a >= b);
  let extreme = -1;
  let missing = 0;
  for (let t = series.time[i] - lookbackBars * series.barMs; t < series.time[i]; t += series.barMs) {
    const index = series.byTime.get(t);
    if (index === undefined) {
      missing += 1;
      continue;
    }
    if (extreme < 0 || beats(toPrice(index), toPrice(extreme))) extreme = index;
  }
  if (extreme < 0) return { ok: false, reason: "coverage", detail: "No 1m bars in the lookback window" };

  const barsSinceExtreme = Math.round((series.time[i] - series.time[extreme]) / series.barMs);
  const extremePrice = toPrice(extreme);
  const breakOut = long ? series.high[extreme] : series.low[extreme];
  // A bar after the extreme (bar i included) that takes out its price means it is no longer the extreme: no reclaim.
  let stillHolds = true;
  for (let k = extreme + 1; k <= i; k += 1) {
    if (long ? series.low[k] < extremePrice : series.high[k] > extremePrice) stillHolds = false;
  }
  const reclaim = stillHolds && (long ? series.close[i] > breakOut : series.close[i] < breakOut);
  let holdingSwing = false;

  // A 1m swing confirmed by bar p+1 <= i: strictly beyond both neighbours, and on the holding side of the extreme.
  for (let p = extreme + 1; p <= i - 1; p += 1) {
    const before = series.byTime.get(series.time[p] - series.barMs);
    const after = series.byTime.get(series.time[p] + series.barMs);
    if (before === undefined || after === undefined) continue;
    const pivot = long
      ? series.low[p] < series.low[before] && series.low[p] < series.low[after] && series.low[p] > extremePrice
      : series.high[p] > series.high[before] && series.high[p] > series.high[after] && series.high[p] < extremePrice;
    if (pivot) {
      holdingSwing = true;
      break;
    }
  }

  return {
    ok: true,
    values: { reclaim, higherLow: holdingSwing, barsSinceExtreme },
    notes: missing > 0 ? [`gap: ${missing} missing 1m bars in the lookback`] : [],
  };
}

export const confirm1mSkill: Skill = { meta: confirm1mMeta, preflight: confirmPreflight, compute: confirmCompute };

export const MTF_SKILLS: readonly Skill[] = [mtfCandleSkill, structure5mSkill, confirm1mSkill];
