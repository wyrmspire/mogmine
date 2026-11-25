/**
 * Attribution engine (SL-9). Pure and deterministic: it reads completed `Match`
 * records only, never bars, so it cannot introduce lookahead. Every number here
 * can be recomputed by hand from the matches list.
 *
 * Spec: docs/design-2026-11-24/09-strategy-lab.md §8.2–§8.5, honesty rules §2,
 * open questions SLQ-9 (n gating), SLQ-10 (shrinkage k = 10).
 */
import type {
  Match, OutcomeExitReason, OutputSpec, Separator, SkillOutputRef, Split, SplitBucket, Stats, TodCell, Value,
} from "./types.ts";
import {
  distribution, etHalfHourLabel, mean, median, rangeLabel, shrunkAverage, terciles, wilsonInterval,
} from "./attribution-stats.ts";

export { SHRINK_K, shrunkAverage, wilsonInterval } from "./attribution-stats.ts";

/** Full row and ranking threshold (SLQ-9, same as PLAYBOOK_CARD_MIN_TRADES). */
export const MIN_FULL_N = 10;
/** Below this only counts show; 5–9 is shown greyed as "thin". */
export const MIN_THIN_N = 5;
/** Separators use n ≥ MIN_THIN_N instead of MIN_FULL_N when the whole run has fewer matches. */
export const SMALL_RUN_MATCHES = 40;
/** Scratch floor: |P&L| ≤ this many ticks per contract (D-C). */
export const SCRATCH_TICKS = 2;

const NA_KEY = "__na";
const EXIT_REASONS: readonly OutcomeExitReason[] = ["target", "stop", "time", "session-end", "ambiguous-stop"];

export interface AttributionOptions {
  /** Declared output metadata (categories, buckets). Without it the kind is inferred from values. */
  outputSpec?: (ref: SkillOutputRef) => OutputSpec | undefined;
  /** Key under which a slice's value sits in `Match.features`. Default: `featureKey(ref)`. */
  featureKeyOf?: (ref: SkillOutputRef) => string;
  /** MES defaults. Used only for the scratch floor. */
  tickSize?: number;
  pointValueUsd?: number;
}

export interface WinnerLoserNumeric {
  kind: "number";
  ref: SkillOutputRef;
  winners: number;
  losers: number;
  winnersMedian: number | null;
  losersMedian: number | null;
}

export interface WinnerLoserCategorical {
  kind: "category" | "boolean";
  ref: SkillOutputRef;
  winners: number;
  losers: number;
  shares: { key: string; label: string; winnerShare: number | null; loserShare: number | null }[];
}

export type WinnerLoserRow = WinnerLoserNumeric | WinnerLoserCategorical;

export interface Attribution {
  stats: Stats;
  splits: Split[];
  /** Ranked: clear before suggestive, stable before unstable, then larger gap. */
  separators: Separator[];
  winnersLosers: WinnerLoserRow[];
  timeOfDay: TodCell[];
  slicesTested: number;
  multipleComparison: string;
}

/**
 * Canonical key for a slice in `Match.features`: `skill@major:out(k=v,…)`.
 * The runner (SL-8) must build its keys with this same function.
 */
export function featureKey(ref: SkillOutputRef, major = 1): string {
  const params = ref.params
    ? Object.keys(ref.params).sort().map((k) => `${k}=${String(ref.params?.[k])}`).join(",")
    : "";
  return `${ref.skill}@${major}:${ref.out}${params ? `(${params})` : ""}`;
}

/** Text that always sits under the "what separates" cards (§8.4). */
export function multipleComparisonLine(slicesTested: number): string {
  return `${slicesTested} slices tested. By chance alone about 1 in 20 can look clear. `
    + "Treat single-slice results as leads, not rules.";
}

/** Overall stats for a run (§8.2). Scratches count in n and not as wins. */
export function computeStats(matches: readonly Match[], options: AttributionOptions = {}): Stats {
  return statsOf(matches, resolve(options));
}

/**
 * Rows per ET 30-minute bucket of the decision time (§8.5). `Match.time` is taken as the
 * trigger bar's open time, so the decision time is `time + 60 s` (bar close, §4.4).
 */
export function timeOfDay(matches: readonly Match[], options: AttributionOptions = {}): TodCell[] {
  const o = resolve(options);
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    const key = etHalfHourLabel(m.time + 60_000); // decision time = bar close (§4.4)
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.keys()].sort().map((bucket) => {
    const members = groups.get(bucket) ?? [];
    const n = members.length;
    const wins = members.filter((m) => classify(m, o) === "win").length;
    const gated = n >= MIN_THIN_N;
    return {
      bucket,
      n,
      wins,
      winRate: gated ? wins / n : null,
      avgR: gated ? mean(members.map((m) => m.outcome.resultR)) : null,
    };
  });
}

/** Everything the results view needs, computed from one run's matches. */
export function attribute(
  matches: readonly Match[],
  sliceBy: readonly SkillOutputRef[],
  options: AttributionOptions = {},
): Attribution {
  const o = resolve(options);
  const stats = statsOf(matches, o);
  const sides = matches.map((m) => classify(m, o));
  const splits: Split[] = [];
  const separators: Separator[] = [];
  const winnersLosers: WinnerLoserRow[] = [];

  for (const ref of sliceBy) {
    const bucketing = bucketize(matches, ref, o);
    const split: Split = {
      ref,
      buckets: bucketing.groups.map((g) => bucketRow(g.key, g.label, g.members.map((i) => matches[i]), stats.avgR, o)),
    };
    splits.push(split);
    const separator = separatorFor(ref, split, matches, bucketing.keyAt, stats.avgR);
    if (separator) separators.push(separator);
    winnersLosers.push(winnersLosersRow(ref, matches, bucketing, sides, o));
  }

  separators.sort(compareSeparators);
  return {
    stats,
    splits,
    separators,
    winnersLosers,
    timeOfDay: timeOfDay(matches, options),
    slicesTested: sliceBy.length,
    multipleComparison: multipleComparisonLine(sliceBy.length),
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Resolved {
  tickSize: number;
  pointValueUsd: number;
  keyOf: (ref: SkillOutputRef) => string;
  specOf: (ref: SkillOutputRef) => OutputSpec | undefined;
}

interface Group {
  key: string;
  label: string;
  members: number[];
}

interface Bucketing {
  kind: OutputSpec["type"];
  groups: Group[];
  /** Bucket key per match index. Missing values sit in the n/a bucket. */
  keyAt: string[];
}

type Side = "win" | "loss" | "scratch";

function resolve(options: AttributionOptions): Resolved {
  return {
    tickSize: options.tickSize ?? 0.25,
    pointValueUsd: options.pointValueUsd ?? 5,
    keyOf: options.featureKeyOf ?? ((ref) => featureKey(ref)),
    specOf: options.outputSpec ?? (() => undefined),
  };
}

function classify(m: Match, o: Resolved): Side {
  const floor = SCRATCH_TICKS * o.tickSize * o.pointValueUsd * m.qty + 1e-9;
  if (Math.abs(m.outcome.pnlUsd) <= floor) return "scratch";
  return m.outcome.pnlUsd > 0 ? "win" : "loss";
}

function statsOf(matches: readonly Match[], o: Resolved): Stats {
  const n = matches.length;
  const sides = matches.map((m) => classify(m, o));
  const wins = sides.filter((s) => s === "win").length;
  const losses = sides.filter((s) => s === "loss").length;
  const scratches = n - wins - losses;
  const rs = matches.map((m) => m.outcome.resultR);
  const pts = matches.map((m) => m.outcome.pnlPoints);
  const exits = Object.fromEntries(EXIT_REASONS.map((r) => [r, 0])) as Record<OutcomeExitReason, number>;
  for (const m of matches) exits[m.outcome.exitReason] += 1;
  const grossWin = matches.reduce((sum, m) => sum + Math.max(0, m.outcome.pnlUsd), 0);
  const grossLoss = matches.reduce((sum, m) => sum + Math.max(0, -m.outcome.pnlUsd), 0);
  const toTarget = matches.map((m) => m.outcome.minutesToTarget).filter(isNumber);
  return {
    n,
    wins,
    losses,
    scratches,
    winRate: n > 0 ? wins / n : null,
    winRate95: wilsonInterval(wins, n),
    avgR: mean(rs),
    medianR: median(rs),
    totalR: rs.reduce((sum, r) => sum + r, 0),
    avgPoints: mean(pts),
    medianPoints: median(pts),
    profitFactor: n >= MIN_FULL_N && grossLoss > 0 ? grossWin / grossLoss : null,
    exits,
    mfePoints: distribution(matches.map((m) => m.outcome.mfePoints)),
    maePoints: distribution(matches.map((m) => m.outcome.maePoints)),
    mfeR: distribution(matches.map((m) => m.outcome.mfeR)),
    maeR: distribution(matches.map((m) => m.outcome.maeR)),
    medianMinutesToTarget: median(toTarget),
  };
}

function bucketRow(
  key: string,
  label: string,
  members: readonly Match[],
  overallAvgR: number | null,
  o: Resolved,
): SplitBucket {
  const n = members.length;
  const wins = members.filter((m) => classify(m, o) === "win").length;
  const gated = n >= MIN_THIN_N;
  const avgR = gated ? mean(members.map((m) => m.outcome.resultR)) : null;
  return {
    key,
    label,
    n,
    wins,
    winRate: gated ? wins / n : null,
    winRate95: gated ? wilsonInterval(wins, n) : null,
    avgR,
    shrunkAvgR: avgR !== null && overallAvgR !== null ? shrunkAverage(n, avgR, overallAvgR) : null,
    avgMfeR: gated ? mean(members.map((m) => m.outcome.mfeR)) : null,
    avgMaeR: gated ? mean(members.map((m) => m.outcome.maeR)) : null,
    thin: n < MIN_FULL_N,
  };
}

function bucketize(matches: readonly Match[], ref: SkillOutputRef, o: Resolved): Bucketing {
  const featureKeyName = o.keyOf(ref);
  const values = matches.map((m) => valueOf(m.features[featureKeyName]));
  const spec = o.specOf(ref);
  const kind = spec?.type ?? inferKind(values);
  const defs: Group[] = [];
  let keyOf: (v: Exclude<Value, null>) => string | null;

  if (kind === "boolean") {
    defs.push(group("yes", "yes"), group("no", "no"));
    keyOf = (v) => (typeof v === "boolean" ? (v ? "yes" : "no") : null);
  } else if (kind === "category") {
    const declared = spec?.categories ?? [];
    const extra = [...new Set(values.filter(isString))].filter((v) => !declared.includes(v)).sort();
    for (const c of [...declared, ...extra]) defs.push(group(c, c));
    keyOf = (v) => (typeof v === "string" ? v : null);
  } else {
    const declaredEdges = spec?.buckets;
    const edges = declaredEdges ? [...declaredEdges] : terciles(values.filter(isNumber));
    const names = declaredEdges ? null : ["low", "mid", "high"];
    const keyFor = (j: number) => names?.[j] ?? `b${j}`;
    for (let j = 0; j <= edges.length; j++) {
      const range = rangeLabel(edges, j);
      defs.push(group(keyFor(j), names ? `${names[j]} (${range})` : range));
    }
    keyOf = (v) => (typeof v === "number" ? keyFor(edges.filter((e) => e <= v).length) : null);
  }

  const keyAt = values.map((v) => (v === null ? NA_KEY : (keyOf(v) ?? NA_KEY)));
  const byKey = new Map(defs.map((g) => [g.key, g]));
  keyAt.forEach((key, idx) => {
    let g = byKey.get(key);
    if (!g) {
      g = group(key, key === NA_KEY ? "n/a" : key);
      defs.push(g);
      byKey.set(key, g);
    }
    g.members.push(idx);
  });
  // Declared and unseen-category buckets first; the n/a bucket is always last.
  const groups = [...defs.filter((g) => g.key !== NA_KEY), ...defs.filter((g) => g.key === NA_KEY)];
  return { kind, groups, keyAt };
}

function separatorFor(
  ref: SkillOutputRef,
  split: Split,
  matches: readonly Match[],
  keyAt: readonly string[],
  overallAvgR: number | null,
): Separator | null {
  const minN = matches.length < SMALL_RUN_MATCHES ? MIN_THIN_N : MIN_FULL_N;
  const eligible = split.buckets.flatMap((b) => (
    b.key !== NA_KEY && b.n >= minN && b.shrunkAvgR !== null && b.winRate95 !== null && b.winRate !== null
      ? [{ bucket: b, shrunk: b.shrunkAvgR, ci: b.winRate95, rate: b.winRate }]
      : []
  ));
  if (eligible.length < 2) return null;

  let best = eligible[0];
  let worst = eligible[0];
  for (const e of eligible) {
    if (e.shrunk > best.shrunk) best = e;
    if (e.shrunk < worst.shrunk) worst = e;
  }
  if (best.bucket.key === worst.bucket.key) return null;

  const rates = eligible.map((e) => e.rate);
  const clear = best.ci[0] > worst.ci[1] || best.ci[1] < worst.ci[0];
  return {
    ref,
    best: best.bucket.key,
    worst: worst.bucket.key,
    gapR: best.shrunk - worst.shrunk,
    winRateGap: Math.max(...rates) - Math.min(...rates),
    clarity: clear ? "clear" : "suggestive",
    stability: stabilityOf(matches, keyAt, overallAvgR),
    thin: eligible.some((e) => e.bucket.n < MIN_FULL_N),
  };
}

/**
 * "Stable": the best bucket (by shrunk avg R within the half) is the same in the
 * first and second half of the sessions, split chronologically by session date.
 * A half with fewer than two populated buckets has no best bucket, so it is "unstable".
 */
function stabilityOf(
  matches: readonly Match[],
  keyAt: readonly string[],
  overallAvgR: number | null,
): "stable" | "unstable" {
  const dates = [...new Set(matches.map((m) => m.sessionDate))].sort();
  const firstDates = new Set(dates.slice(0, Math.ceil(dates.length / 2)));
  const bestIn = (inFirst: boolean): string | null => {
    const acc = new Map<string, { n: number; sum: number }>();
    matches.forEach((m, idx) => {
      const key = keyAt[idx];
      if (firstDates.has(m.sessionDate) !== inFirst || key === NA_KEY) return;
      const a = acc.get(key) ?? { n: 0, sum: 0 };
      a.n += 1;
      a.sum += m.outcome.resultR;
      acc.set(key, a);
    });
    if (acc.size < 2) return null;
    let best: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const [key, a] of acc) {
      const avg = a.sum / a.n;
      const score = overallAvgR === null ? avg : shrunkAverage(a.n, avg, overallAvgR);
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
    return best;
  };
  const first = bestIn(true);
  return first !== null && first === bestIn(false) ? "stable" : "unstable";
}

function winnersLosersRow(
  ref: SkillOutputRef,
  matches: readonly Match[],
  bucketing: Bucketing,
  sides: readonly Side[],
  o: Resolved,
): WinnerLoserRow {
  const winners = matches.flatMap((_, i) => (sides[i] === "win" ? [i] : []));
  const losers = matches.flatMap((_, i) => (sides[i] === "loss" ? [i] : []));
  if (bucketing.kind === "number") {
    const key = o.keyOf(ref);
    const numbersAt = (idxs: readonly number[]) => idxs
      .map((i) => valueOf(matches[i].features[key]))
      .filter(isNumber);
    return {
      kind: "number",
      ref,
      winners: winners.length,
      losers: losers.length,
      winnersMedian: median(numbersAt(winners)),
      losersMedian: median(numbersAt(losers)),
    };
  }
  const winnerSet = new Set(winners);
  const loserSet = new Set(losers);
  return {
    kind: bucketing.kind === "boolean" ? "boolean" : "category",
    ref,
    winners: winners.length,
    losers: losers.length,
    shares: bucketing.groups.map((g) => ({
      key: g.key,
      label: g.label,
      winnerShare: winners.length > 0 ? g.members.filter((i) => winnerSet.has(i)).length / winners.length : null,
      loserShare: losers.length > 0 ? g.members.filter((i) => loserSet.has(i)).length / losers.length : null,
    })),
  };
}

function rankOf(s: Separator): number {
  return (s.clarity === "clear" ? 0 : 2) + (s.stability === "stable" ? 0 : 1);
}

function compareSeparators(a: Separator, b: Separator): number {
  return rankOf(a) - rankOf(b)
    || b.gapR - a.gapR
    || featureKey(a.ref).localeCompare(featureKey(b.ref));
}

function group(key: string, label: string): Group {
  return { key, label, members: [] };
}

function valueOf(v: Value | undefined): Value {
  if (v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return v;
}

function inferKind(values: readonly Value[]): OutputSpec["type"] {
  const first = values.find((v) => v !== null);
  if (typeof first === "number") return "number";
  if (typeof first === "boolean") return "boolean";
  return "category";
}

function isNumber(v: Value | undefined): v is number {
  return typeof v === "number";
}

function isString(v: Value | undefined): v is string {
  return typeof v === "string";
}

