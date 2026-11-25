// SL-5: volume skills V1 rvol, V2 volumeSpike, V4 entryVolume (docs/design-2026-11-24/09-strategy-lab.md §9).
// Pure and synchronous. Every read is at or before the decision bar i (known-at rule, §4.4).
// Volume 0 is missing (NaN in the series), never zero activity (§7.1).
import type {
  BarSeries, LevelKey, OutputSpec, ParamSpec, Skill, SkillContext, SkillMeta,
  SkillPreflight, SkillResult, SkipReason, Value,
} from "../types.ts";

export const LEVEL_KEYS: readonly LevelKey[] = [
  "pdh", "pdl", "pdc", "onh", "onl", "rth_open", "week_high", "week_low",
  "vwap_globex", "vwap_rth", "or_high", "or_low", "or_mid",
];

type Parsed<P> = { ok: true; p: P } | { ok: false; detail: string };

export function skip(reason: SkipReason, detail: string): SkillResult {
  return { ok: false, reason, detail };
}

export function ok(values: Record<string, Value>, notes: string[] = []): SkillResult {
  return notes.length > 0 ? { ok: true, values, notes } : { ok: true, values };
}

/** Integer parameter in [min, max]; null when the value is not an in-range integer. */
export function intParam(params: Record<string, Value>, key: string, fallback: number, min: number, max: number): number | null {
  const raw = params[key] ?? fallback;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= min && raw <= max ? raw : null;
}

/** Finite number parameter in [min, max]; null when out of range. */
export function numParam(params: Record<string, Value>, key: string, fallback: number, min: number, max: number): number | null {
  const raw = params[key] ?? fallback;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= min && raw <= max ? raw : null;
}

function indexCheck(ctx: SkillContext): SkillPreflight {
  return Number.isInteger(ctx.i) && ctx.i >= 0 && ctx.i < ctx.series.time.length
    ? { ok: true }
    : { ok: false, reason: "warmup", detail: "No bar at the decision index" };
}

/** Shared wiring: preflight checks the index and parameters; compute repeats both and runs the body. */
export function volumeSkill<P>(
  meta: SkillMeta,
  parse: (ctx: SkillContext) => Parsed<P>,
  run: (ctx: SkillContext, p: P) => SkillResult,
): Skill {
  return {
    meta,
    preflight(ctx) {
      const index = indexCheck(ctx);
      if (!index.ok) return index;
      const parsed = parse(ctx);
      return parsed.ok ? { ok: true } : { ok: false, reason: "bad-params", detail: parsed.detail };
    },
    compute(ctx) {
      const index = indexCheck(ctx);
      if (!index.ok) return index;
      const parsed = parse(ctx);
      if (!parsed.ok) return { ok: false, reason: "bad-params", detail: parsed.detail };
      return run(ctx, parsed.p);
    },
  };
}

const minuteIndexCache = new WeakMap<BarSeries, Map<string, Map<number, number>>>();

/**
 * ET clock minute → bar index, per session. Built once per series. -1 marks a minute that
 * occurs twice in one session (DST fall-back), which is then unusable rather than guessed.
 */
export function sessionMinuteIndex(series: BarSeries, date: string): Map<number, number> | undefined {
  let bySession = minuteIndexCache.get(series);
  if (!bySession) {
    bySession = new Map();
    for (let j = 0; j < series.time.length; j += 1) {
      const day = series.sessionDate[j];
      let minutes = bySession.get(day);
      if (!minutes) {
        minutes = new Map();
        bySession.set(day, minutes);
      }
      const minute = series.etMinute[j];
      minutes.set(minute, minutes.has(minute) ? -1 : j);
    }
    minuteIndexCache.set(series, bySession);
  }
  return bySession.get(date);
}

/** Session dates strictly before `date`, the most recent `count`, oldest first. */
export function priorSessionDates(series: BarSeries, date: string, count: number): string[] {
  return series.sessions.map((session) => session.date).filter((day) => day < date).slice(-count);
}

/**
 * Sum of volume over the `minutes` one-minute bars ending at `end`, all in the same session.
 * Null when any bar is absent or has missing volume.
 */
export function windowVolume(series: BarSeries, end: number, minutes: number): number | null {
  const day = series.sessionDate[end];
  let total = 0;
  for (let k = 0; k < minutes; k += 1) {
    const j = series.byTime.get(series.time[end] - k * series.barMs);
    if (j === undefined || series.sessionDate[j] !== day) return null;
    const volume = series.volume[j];
    if (Number.isNaN(volume)) return null;
    total += volume;
  }
  return total;
}

/** Up to `count` valid (non-missing) volumes strictly before i, most recent first. */
export function previousValidVolumes(series: BarSeries, i: number, count: number): number[] {
  const out: number[] = [];
  for (let j = i - 1; j >= 0 && out.length < count; j -= 1) {
    const volume = series.volume[j];
    if (!Number.isNaN(volume)) out.push(volume);
  }
  return out;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// V1 rvol: same-time-of-day relative volume.
// ---------------------------------------------------------------------------

interface RvolParams { windowMinutes: number; sessions: number; minSessions: number }

const RVOL_PARAMS: readonly ParamSpec[] = [
  { key: "windowMinutes", type: "integer", default: 5, min: 1, max: 60, label: "Window (minutes)" },
  { key: "sessions", type: "integer", default: 10, min: 1, max: 60, label: "Prior sessions" },
  { key: "minSessions", type: "integer", default: 5, min: 1, max: 60, label: "Minimum usable sessions" },
];

const RVOL_OUTPUTS: readonly OutputSpec[] = [
  { key: "rvol", type: "number", label: "RVOL (today ÷ baseline median)", unit: "ratio", buckets: [0.7, 1.3, 2] },
  { key: "rvolBucket", type: "category", label: "RVOL bucket", categories: ["low", "normal", "high", "very-high"] },
  { key: "baselineSessions", type: "number", label: "Usable baseline sessions" },
];

export const RVOL_META: SkillMeta = {
  id: "rvol",
  version: "1.0.0",
  kind: "feature",
  title: "Relative volume (RVOL)",
  description: "Volume over the last window ÷ the median volume of the same ET clock window in prior sessions.",
  status: "active",
  params: RVOL_PARAMS,
  outputs: RVOL_OUTPUTS,
  needs: { baseTimeframe: "1m", lookbackMinutes: 5, priorSessions: 10, volume: true },
  knownAt: "bar-close",
};

function rvolBucket(rvol: number): string {
  if (rvol < 0.7) return "low";
  if (rvol < 1.3) return "normal";
  if (rvol < 2) return "high";
  return "very-high";
}

export const rvolSkill: Skill = volumeSkill<RvolParams>(
  RVOL_META,
  (ctx) => {
    const windowMinutes = intParam(ctx.params, "windowMinutes", 5, 1, 60);
    const sessions = intParam(ctx.params, "sessions", 10, 1, 60);
    const minSessions = intParam(ctx.params, "minSessions", 5, 1, 60);
    if (windowMinutes === null || sessions === null || minSessions === null || minSessions > sessions) {
      return { ok: false, detail: "windowMinutes 1–60, sessions 1–60, minSessions 1–sessions" };
    }
    return { ok: true, p: { windowMinutes, sessions, minSessions } };
  },
  ({ series, i }, { windowMinutes, sessions, minSessions }) => {
    const today = windowVolume(series, i, windowMinutes);
    if (today === null) {
      return skip("volume-missing", `Today's ${windowMinutes}-minute window has a missing bar or missing volume`);
    }
    // Same ET clock minute in each prior session (DST-correct: ET minute, never UTC).
    const minute = series.etMinute[i];
    const baseline: number[] = [];
    for (const day of priorSessionDates(series, series.sessionDate[i], sessions)) {
      const end = sessionMinuteIndex(series, day)?.get(minute);
      if (end === undefined || end < 0) continue;
      const sum = windowVolume(series, end, windowMinutes);
      if (sum !== null) baseline.push(sum);
    }
    if (baseline.length < minSessions) {
      return skip("warmup", `${baseline.length} usable prior sessions; need ${minSessions}`);
    }
    const rvol = today / median(baseline);
    return ok({ rvol, rvolBucket: rvolBucket(rvol), baselineSessions: baseline.length });
  },
);

// ---------------------------------------------------------------------------
// V2 volumeSpike: volume at i against the median of the previous valid bars.
// ---------------------------------------------------------------------------

interface SpikeParams { lookbackBars: number; multiple: number; minValid: number }

export const VOLUME_SPIKE_META: SkillMeta = {
  id: "volumeSpike",
  version: "1.0.0",
  kind: "label",
  title: "Volume spike",
  description: "Volume at the decision bar against the median and log-z of the previous valid bars.",
  status: "active",
  params: [
    { key: "lookbackBars", type: "integer", default: 30, min: 2, max: 500, label: "Lookback (valid bars)" },
    { key: "multiple", type: "number", default: 3, min: 1, max: 100, label: "Spike multiple of median" },
    { key: "minValid", type: "integer", default: 20, min: 1, max: 500, label: "Minimum valid bars" },
  ],
  outputs: [
    { key: "ratio", type: "number", label: "Volume ÷ median", unit: "ratio" },
    { key: "logZ", type: "number", label: "Log z-score" },
    { key: "spike", type: "boolean", label: "Spike" },
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 30, volume: true },
  knownAt: "bar-close",
};

export const volumeSpikeSkill: Skill = volumeSkill<SpikeParams>(
  VOLUME_SPIKE_META,
  (ctx) => {
    const lookbackBars = intParam(ctx.params, "lookbackBars", 30, 2, 500);
    const multiple = numParam(ctx.params, "multiple", 3, 1, 100);
    const minValid = intParam(ctx.params, "minValid", 20, 1, 500);
    if (lookbackBars === null || multiple === null || minValid === null || minValid > lookbackBars) {
      return { ok: false, detail: "lookbackBars 2–500, multiple 1–100, minValid 1–lookbackBars" };
    }
    return { ok: true, p: { lookbackBars, multiple, minValid } };
  },
  ({ series, i }, { lookbackBars, multiple, minValid }) => {
    const volume = series.volume[i];
    if (Number.isNaN(volume)) return skip("volume-missing", "Decision bar has missing volume");
    // Walks back over valid bars only; the window may cross the 17:00 halt.
    const prior = previousValidVolumes(series, i, lookbackBars);
    if (prior.length < minValid) return skip("warmup", `${prior.length} valid prior bars; need ${minValid}`);

    const medianVolume = median(prior);
    const ratio = volume / medianVolume;
    // A flat window is detected by exact equality: its log-sd is floating-point noise, not zero.
    const flat = prior.every((value) => value === prior[0]);
    const logs = prior.map(Math.log);
    const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / logs.length);
    const notes: string[] = [];
    let logZ: number | null = null;
    if (!flat && sd > 0) logZ = (Math.log(volume) - mean) / sd;
    else notes.push("Flat prior window: log z-score undefined (null)");
    return ok({ ratio, logZ, spike: ratio >= multiple }, notes);
  },
);

// ---------------------------------------------------------------------------
// V4 entryVolume: the decision bar and the k bars before it, against the recent median.
// ---------------------------------------------------------------------------

interface EntryParams { k: number; medianBars: number }

export const ENTRY_VOLUME_META: SkillMeta = {
  id: "entryVolume",
  version: "1.0.0",
  kind: "feature",
  title: "Entry-bar volume",
  description: "Volume on the decision bar and the k bars before it: sum, trend, and size against the recent median.",
  status: "active",
  params: [
    { key: "k", type: "integer", default: 5, min: 1, max: 60, label: "Bars before the entry" },
    { key: "medianBars", type: "integer", default: 30, min: 2, max: 500, label: "Median window (bars)" },
  ],
  outputs: [
    { key: "entryBarVolume", type: "number", label: "Entry bar volume", unit: "contracts" },
    { key: "priorSum", type: "number", label: "Volume in the k bars before", unit: "contracts" },
    { key: "trend", type: "category", label: "Volume trend", categories: ["rising", "falling", "flat"] },
    { key: "entryVsMedian", type: "number", label: "Entry ÷ median", unit: "ratio", buckets: [0.75, 1.5] },
    { key: "entryVsMedianBucket", type: "category", label: "Entry vs median", categories: ["low", "normal", "high"] },
  ],
  needs: { baseTimeframe: "1m", lookbackMinutes: 30, volume: true },
  knownAt: "bar-close",
};

const MIN_MEDIAN_VALID = 20;
const FLAT_SLOPE_FRACTION = 0.05;

export const entryVolumeSkill: Skill = volumeSkill<EntryParams>(
  ENTRY_VOLUME_META,
  (ctx) => {
    const k = intParam(ctx.params, "k", 5, 1, 60);
    const medianBars = intParam(ctx.params, "medianBars", 30, 2, 500);
    if (k === null || medianBars === null) return { ok: false, detail: "k 1–60, medianBars 2–500" };
    return { ok: true, p: { k, medianBars } };
  },
  ({ series, i }, { k, medianBars }) => {
    const entry = series.volume[i];
    if (Number.isNaN(entry)) return skip("volume-missing", "Decision bar has missing volume");

    // The k bars before the entry, oldest first. A missing minute inside k makes the skill unusable.
    const prior: number[] = [];
    for (let m = k; m >= 1; m -= 1) {
      const j = series.byTime.get(series.time[i] - m * series.barMs);
      const volume = j === undefined ? Number.NaN : series.volume[j];
      if (Number.isNaN(volume)) return skip("volume-missing", `Bar ${m} minute(s) before the entry is missing or has no volume`);
      prior.push(volume);
    }

    const ys = [...prior, entry];
    const n = ys.length;
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    let covariance = 0;
    let varianceX = 0;
    ys.forEach((value, x) => {
      covariance += (x - meanX) * (value - meanY);
      varianceX += (x - meanX) ** 2;
    });
    const slope = covariance / varianceX;
    const trend = Math.abs(slope) < FLAT_SLOPE_FRACTION * meanY ? "flat" : slope > 0 ? "rising" : "falling";

    const recent = previousValidVolumes(series, i, medianBars);
    const minimum = Math.min(MIN_MEDIAN_VALID, medianBars);
    if (recent.length < minimum) return skip("warmup", `${recent.length} valid prior bars; need ${minimum}`);
    const entryVsMedian = entry / median(recent);
    const bucket = entryVsMedian < 0.75 ? "low" : entryVsMedian < 1.5 ? "normal" : "high";

    return ok({
      entryBarVolume: entry,
      priorSum: prior.reduce((sum, value) => sum + value, 0),
      trend,
      entryVsMedian,
      entryVsMedianBucket: bucket,
    });
  },
);
