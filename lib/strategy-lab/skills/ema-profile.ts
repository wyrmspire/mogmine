/**
 * Batch-2 skills, part B: `emaRelation` (label) and `profileRelation` (feature).
 * Pure and synchronous. The EMA follows the D-G recipe in lib/ema.ts (`computeEma200`): seed with the
 * simple mean of the first 200 closes, alpha 2/201, points only from the 700th bar. The 20 EMA uses the same
 * shape with a 20-bar seed and alpha 2/21. The volume profile matches `volumeProfile` in lib/session-indicators.ts.
 */
import { equityIndexSessionBounds } from "../../session.ts";
import type {
  BarSeries, OutputSpec, ParamSpec, Skill, SkillContext, SkillMeta, SkillPreflight, SkillResult, Value,
} from "../types.ts";

type Skip = Extract<SkillResult, { ok: false }>;
type Parsed<T> = { ok: true; value: T } | Skip;

const EMA_PERIOD = 200;
const EMA_FAST = 20;
const EMA_MIN_BARS = 700;
const ALPHA_SLOW = 2 / (EMA_PERIOD + 1);
const ALPHA_FAST = 2 / (EMA_FAST + 1);
/** Within this many ticks of the EMA (or of POC) a price reads as "at". */
const AT_TICKS = 2;
const VALUE_AREA_FRACTION = 0.7;
/** More than this share of window bars without volume and the profile is withheld. */
const MAX_MISSING_VOLUME_SHARE = 0.2;
const PROFILE_WARNING = "Estimated from 1-minute OHLCV typical price; true futures volume profile requires tick data.";

function badParams(detail: string): Skip {
  return { ok: false, reason: "bad-params", detail };
}

function warmup(detail: string): Skip {
  return { ok: false, reason: "warmup", detail };
}

function integerParam(params: Record<string, Value>, key: string, fallback: number, min: number, max: number): number | null {
  const value = params[key] ?? fallback;
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

// ---------- emaRelation ----------

interface EmaParams { minutes: number; farTicks: number; slopeBars: number }

function parseEmaParams(params: Record<string, Value>): Parsed<EmaParams> {
  const minutes = integerParam(params, "minutes", 1, 1, 5);
  if (minutes === null || (minutes !== 1 && minutes !== 5)) return badParams("Timeframe minutes must be 1 or 5");
  const farTicks = integerParam(params, "farTicks", 12, 4, 80);
  if (farTicks === null) return badParams("Far band must be an integer from 4 to 80 ticks");
  const slopeBars = integerParam(params, "slopeBars", 5, 1, 30);
  if (slopeBars === null) return badParams("Slope lookback must be an integer from 1 to 30 bars");
  return { ok: true, value: { minutes, farTicks, slopeBars } };
}

interface EmaTrack {
  /** Completed timeframe bars visible at each series index (count; bars up to i only). */
  completed: Int32Array;
  /** EMA values indexed by completed timeframe bar k (k = count - 1). NaN before the seed. */
  ema200: Float64Array;
  ema20: Float64Array;
}

/** Seeds from the first bars and runs the recurrence forward. Index k is the k-th timeframe bar. */
function emaArrays(closes: ArrayLike<number>): Pick<EmaTrack, "ema200" | "ema20"> {
  const n = closes.length;
  const ema200 = new Float64Array(n).fill(Number.NaN);
  const ema20 = new Float64Array(n).fill(Number.NaN);
  let seedSlow = 0;
  let seedFast = 0;
  let slow = Number.NaN;
  let fast = Number.NaN;
  for (let k = 0; k < n; k += 1) {
    const close = closes[k];
    if (k < EMA_FAST) seedFast += close;
    if (k < EMA_PERIOD) seedSlow += close;
    if (k === EMA_FAST - 1) fast = seedFast / EMA_FAST;
    if (k === EMA_PERIOD - 1) slow = seedSlow / EMA_PERIOD;
    if (k >= EMA_FAST) fast = close * ALPHA_FAST + fast * (1 - ALPHA_FAST);
    if (k >= EMA_PERIOD) slow = close * ALPHA_SLOW + slow * (1 - ALPHA_SLOW);
    if (k >= EMA_FAST - 1) ema20[k] = fast;
    if (k >= EMA_PERIOD - 1) ema200[k] = slow;
  }
  return { ema200, ema20 };
}

/**
 * 5m buckets are ET-aligned and complete once their end is at or before the decision time
 * (`time[i] + barMs`). A bucket's close is its last present 1m bar, which precedes i by construction.
 */
function buildTrack(series: BarSeries, minutes: number): EmaTrack {
  const n = series.time.length;
  if (minutes === 1) {
    const completed = new Int32Array(n);
    for (let i = 0; i < n; i += 1) completed[i] = i + 1;
    return { completed, ...emaArrays(series.close) };
  }
  const ends: number[] = [];
  const closes: number[] = [];
  let currentStart = Number.NaN;
  for (let j = 0; j < n; j += 1) {
    const start = series.time[j] - (series.etMinute[j] % minutes) * series.barMs;
    if (start !== currentStart) {
      ends.push(start + minutes * series.barMs);
      closes.push(series.close[j]);
      currentStart = start;
    } else {
      closes[closes.length - 1] = series.close[j];
    }
  }
  const completed = new Int32Array(n);
  let done = 0;
  for (let i = 0; i < n; i += 1) {
    const decision = series.time[i] + series.barMs;
    while (done < ends.length && ends[done] <= decision) done += 1;
    completed[i] = done;
  }
  return { completed, ...emaArrays(closes) };
}

/** Memoized per series and timeframe, so a full-series recipe scan is one O(N) pass. */
const TRACKS = new WeakMap<BarSeries, Map<number, EmaTrack>>();

function trackFor(series: BarSeries, minutes: number): EmaTrack {
  let byMinutes = TRACKS.get(series);
  if (!byMinutes) {
    byMinutes = new Map();
    TRACKS.set(series, byMinutes);
  }
  let track = byMinutes.get(minutes);
  if (!track) {
    track = buildTrack(series, minutes);
    byMinutes.set(minutes, track);
  }
  return track;
}

const EMA_PARAMS: readonly ParamSpec[] = [
  { key: "minutes", type: "integer", default: 1, min: 1, max: 5, label: "Timeframe minutes (1 or 5)" },
  { key: "farTicks", type: "integer", default: 12, min: 4, max: 80, label: "Far band (ticks)" },
  { key: "slopeBars", type: "integer", default: 5, min: 1, max: 30, label: "Slope lookback (bars)" },
];

const EMA_OUTPUTS: readonly OutputSpec[] = [
  { key: "ema200", type: "number", unit: "points", label: "200 EMA" },
  { key: "ema20", type: "number", unit: "points", label: "20 EMA" },
  { key: "dist200Ticks", type: "number", unit: "ticks", label: "Distance from 200 EMA (ticks)", buckets: [-12, -2, 2, 12] },
  { key: "dist20Ticks", type: "number", unit: "ticks", label: "Distance from 20 EMA (ticks)" },
  {
    key: "side200", type: "category", label: "Side of 200 EMA",
    categories: ["above-far", "above", "at", "below", "below-far"],
  },
  { key: "side20", type: "category", label: "Side of 20 EMA", categories: ["above", "at", "below"] },
  { key: "stack", type: "category", label: "EMA stack", categories: ["bull", "bear", "mixed"] },
  { key: "slope200", type: "number", unit: "points", label: "200 EMA slope (points per bar)" },
];

const emaMeta: SkillMeta = {
  id: "emaRelation",
  version: "1.0.0",
  kind: "label",
  title: "EMA relation",
  description: "Close against the 200 EMA (and 20 EMA) on 1m or completed 5m bars, the EMA stack, and the 200 EMA slope. Seeded from the first 200 closes; values from the 700th bar.",
  status: "active",
  params: EMA_PARAMS,
  outputs: EMA_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 3500, priorSessions: 3, volume: false },
  knownAt: "bar-close",
};

function emaPreflight(ctx: SkillContext): SkillPreflight {
  const parsed = parseEmaParams(ctx.params);
  if (!parsed.ok) return parsed;
  const label = parsed.value.minutes === 1 ? "1m" : "5m";
  const completed = trackFor(ctx.series, parsed.value.minutes).completed[ctx.i];
  if (completed < EMA_MIN_BARS) {
    return warmup(`Needs ${EMA_MIN_BARS} ${label} bars for warm-up (${completed} available)`);
  }
  return { ok: true };
}

function sideOf200(ticks: number, farTicks: number): string {
  if (Math.abs(ticks) <= AT_TICKS) return "at";
  if (ticks > farTicks) return "above-far";
  if (ticks > 0) return "above";
  if (ticks < -farTicks) return "below-far";
  return "below";
}

function sideOf20(ticks: number): string {
  if (Math.abs(ticks) <= AT_TICKS) return "at";
  return ticks > 0 ? "above" : "below";
}

function emaCompute(ctx: SkillContext): SkillResult {
  const { series, i, params, spec } = ctx;
  const parsed = parseEmaParams(params);
  if (!parsed.ok) return parsed;
  const { minutes, farTicks, slopeBars } = parsed.value;
  const track = trackFor(series, minutes);
  const count = track.completed[i];
  if (count < EMA_MIN_BARS) {
    return warmup(`Needs ${EMA_MIN_BARS} ${minutes === 1 ? "1m" : "5m"} bars for warm-up (${count} available)`);
  }

  const k = count - 1;
  const ema200 = track.ema200[k];
  const ema20 = track.ema20[k];
  const close = series.close[i];
  const tick = spec.tickSize;
  const dist200 = (close - ema200) / tick;
  const dist20 = (close - ema20) / tick;
  // The slope needs an earlier point that is itself past warm-up; otherwise it is withheld.
  const earlier = k - slopeBars;
  const slope = earlier >= EMA_MIN_BARS - 1 ? (ema200 - track.ema200[earlier]) / slopeBars : null;
  const stack = close > ema20 && ema20 > ema200 ? "bull" : close < ema20 && ema20 < ema200 ? "bear" : "mixed";

  return {
    ok: true,
    values: {
      ema200,
      ema20,
      dist200Ticks: dist200,
      dist20Ticks: dist20,
      side200: sideOf200(dist200, farTicks),
      side20: sideOf20(dist20),
      stack,
      slope200: slope,
    },
    notes: slope === null ? [`Slope needs ${EMA_MIN_BARS + slopeBars} ${minutes === 1 ? "1m" : "5m"} bars of history`] : undefined,
  };
}

export const emaRelation: Skill = {
  meta: emaMeta,
  preflight: emaPreflight,
  compute: emaCompute,
};

// ---------- profileRelation ----------

type ProfileAnchor = "rth" | "globex";
interface ProfileParams { anchor: ProfileAnchor; toleranceTicks: number; minBars: number }

function parseProfileParams(params: Record<string, Value>): Parsed<ProfileParams> {
  const anchor = params.anchor ?? "rth";
  if (anchor !== "rth" && anchor !== "globex") return badParams("Session anchor must be rth or globex");
  const toleranceTicks = integerParam(params, "toleranceTicks", 2, 1, 10);
  if (toleranceTicks === null) return badParams("POC tolerance must be an integer from 1 to 10 ticks");
  const minBars = integerParam(params, "minBars", 15, 5, 120);
  if (minBars === null) return badParams("Min valid bars must be an integer from 5 to 120");
  return { ok: true, value: { anchor, toleranceTicks, minBars } };
}

/** The RTH anchor is known at 09:31 ET, i.e. once the 09:30 bar has closed. */
function profileGate(ctx: SkillContext, anchor: ProfileAnchor): SkillPreflight {
  if (anchor === "rth" && ctx.series.time[ctx.i] < equityIndexSessionBounds(ctx.series.sessionDate[ctx.i]).rthOpen) {
    return { ok: false, reason: "not-known-yet", detail: "Before RTH open" };
  }
  return { ok: true };
}

function profilePreflight(ctx: SkillContext): SkillPreflight {
  const parsed = parseProfileParams(ctx.params);
  if (!parsed.ok) return parsed;
  return profileGate(ctx, parsed.value.anchor);
}

function profileWindowStart(series: BarSeries, i: number, anchor: ProfileAnchor): number {
  if (anchor === "globex") return series.sessionStart[i];
  const open = equityIndexSessionBounds(series.sessionDate[i]).rthOpen;
  let start = i;
  while (start > 0 && series.time[start - 1] >= open) start -= 1;
  return start;
}

const PROFILE_PARAMS: readonly ParamSpec[] = [
  { key: "anchor", type: "enum", default: "rth", options: ["rth", "globex"], label: "Session anchor" },
  { key: "toleranceTicks", type: "integer", default: 2, min: 1, max: 10, label: "POC tolerance (ticks)" },
  { key: "minBars", type: "integer", default: 15, min: 5, max: 120, label: "Min valid bars" },
];

const PROFILE_OUTPUTS: readonly OutputSpec[] = [
  { key: "poc", type: "number", unit: "points", label: "POC" },
  { key: "vah", type: "number", unit: "points", label: "VAH" },
  { key: "val", type: "number", unit: "points", label: "VAL" },
  { key: "vaWidthPoints", type: "number", unit: "points", label: "Value area width" },
  { key: "pocDistTicks", type: "number", unit: "ticks", label: "Distance from POC (ticks)" },
  { key: "vahDistTicks", type: "number", unit: "ticks", label: "Distance from VAH (ticks)" },
  { key: "valDistTicks", type: "number", unit: "ticks", label: "Distance from VAL (ticks)" },
  {
    key: "location", type: "category", label: "Location in value",
    categories: ["above-va", "inside-va", "below-va", "at-poc"],
  },
];

const profileMeta: SkillMeta = {
  id: "profileRelation",
  version: "1.0.0",
  kind: "feature",
  title: "Volume profile relation",
  description: "POC, value area and the close's location against them, for the session so far (RTH from 09:30 ET, or Globex). Estimated from 1-minute typical price.",
  status: "degraded",
  params: PROFILE_PARAMS,
  outputs: PROFILE_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 1380, volume: true },
  knownAt: "bar-close",
  warnings: [PROFILE_WARNING],
};

function profileCompute(ctx: SkillContext): SkillResult {
  const { series, i, params, spec } = ctx;
  const parsed = parseProfileParams(params);
  if (!parsed.ok) return parsed;
  const { anchor, toleranceTicks, minBars } = parsed.value;
  const gate = profileGate(ctx, anchor);
  if (!gate.ok) return gate;

  const tick = spec.tickSize;
  const start = profileWindowStart(series, i, anchor);
  const length = i - start + 1;
  const rows = new Map<number, number>();
  let missing = 0;
  let total = 0;
  let valid = 0;
  for (let j = start; j <= i; j += 1) {
    const volume = series.volume[j];
    if (!(Number.isFinite(volume) && volume > 0)) {
      missing += 1;
      continue;
    }
    const tickIndex = Math.round(((series.high[j] + series.low[j] + series.close[j]) / 3) / tick);
    rows.set(tickIndex, (rows.get(tickIndex) ?? 0) + volume);
    total += volume;
    valid += 1;
  }
  if (missing * 5 > length || total === 0) {
    return { ok: false, reason: "volume-missing", detail: `${missing} of ${length} window bars lack volume` };
  }
  if (valid < minBars) return warmup(`${valid} valid-volume bars (need ${minBars})`);

  // Same walk as volumeProfile: first peak in price order, then widen toward the heavier neighbour.
  const sorted = [...rows].sort(([a], [b]) => a - b);
  let poc = 0;
  for (let r = 1; r < sorted.length; r += 1) if (sorted[r][1] > sorted[poc][1]) poc = r;
  let low = poc;
  let high = poc;
  let included = sorted[poc][1];
  const target = total * VALUE_AREA_FRACTION;
  while (included < target && (low > 0 || high < sorted.length - 1)) {
    if ((sorted[low - 1]?.[1] ?? -1) >= (sorted[high + 1]?.[1] ?? -1)) included += sorted[--low][1];
    else included += sorted[++high][1];
  }

  const pocPrice = sorted[poc][0] * tick;
  const vahPrice = sorted[high][0] * tick;
  const valPrice = sorted[low][0] * tick;
  const close = series.close[i];
  const location = Math.abs(close - pocPrice) <= toleranceTicks * tick ? "at-poc"
    : close > vahPrice ? "above-va"
      : close < valPrice ? "below-va"
        : "inside-va";

  return {
    ok: true,
    values: {
      poc: pocPrice,
      vah: vahPrice,
      val: valPrice,
      vaWidthPoints: vahPrice - valPrice,
      pocDistTicks: (close - pocPrice) / tick,
      vahDistTicks: (close - vahPrice) / tick,
      valDistTicks: (close - valPrice) / tick,
      location,
    },
  };
}

export const profileRelation: Skill = {
  meta: profileMeta,
  preflight: profilePreflight,
  compute: profileCompute,
};

export const EMA_PROFILE_SKILLS: readonly Skill[] = [emaRelation, profileRelation];
