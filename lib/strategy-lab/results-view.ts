/**
 * Results view model (SL-10, docs/design-2026-11-24/09 §8.2–§8.5, §12.5). Pure: no DOM, no React, no I/O.
 * The Results, Splits and Matches components only render what this file returns, so the rules live here
 * and are testable: thin rows (n < 10) are greyed and never ranked, n < 5 shows counts only, the
 * multiple-comparison line is always present, NaN or missing values read "n/a", and R is shown in R only.
 */
import { featureKey, multipleComparisonLine, MIN_FULL_N, MIN_THIN_N } from "./attribution.ts";
import { clockText, etParts } from "./et-clock.ts";
import { outputSpecOf } from "./recipe.ts";
import { SKILLS, type SkillRegistry } from "./registry.ts";
import type {
  BarSeries, Match, RunResult, Separator, SkillOutputRef, Split, SplitBucket, Stats, TodCell, Value,
} from "./types.ts";

export const MINUS = "−";
/** Matches shown before "Show more". Keeps the phone list short. */
export const MATCH_PAGE_SIZE = 50;
/** Top separators shown as "Works" / "Fails" cards (§8.4). */
export const TOP_SEPARATORS = 3;

export type BucketTone = "full" | "thin" | "counts";
export type Sign = "pos" | "neg" | "zero" | "none";

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** "+0.21R", "−0.25R", "0.00R", or "—" when there is no value. Rounds first so −0.001 reads "0.00R". */
export function signedR(v: number | null | undefined): string {
  if (!finite(v)) return "—";
  const abs = Number(Math.abs(v).toFixed(2));
  const sign = abs === 0 ? "" : v < 0 ? MINUS : "+";
  return `${sign}${abs.toFixed(2)}R`;
}

export function signOf(v: number | null | undefined): Sign {
  if (!finite(v)) return "none";
  if (Number(Math.abs(v).toFixed(2)) === 0) return "zero";
  return v > 0 ? "pos" : "neg";
}

/** Unsigned multiple of risk, for MFE and MAE, e.g. "1.4× risk". */
export function riskMultipleText(v: number | null | undefined): string {
  return finite(v) ? `${Math.abs(v).toFixed(1)}× risk` : "—";
}

/** Whole-number percent, e.g. "50%". */
export function pctText(v: number | null | undefined): string {
  return finite(v) ? `${Math.round(v * 100)}%` : "—";
}

/** Wilson interval as "27–73%", or "—" when absent. */
export function ciText(ci: readonly [number, number] | null | undefined): string {
  return ci ? `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%` : "—";
}

/** Feature values: "n/a" for null, NaN, or missing; yes/no for booleans; short numbers otherwise. */
export function valueText(v: Value | undefined): string {
  if (v === undefined || v === null) return "n/a";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "n/a";
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return v;
}

/** Tone for a bucket by its trade count: full row, greyed thin row, or counts only (n < 5). */
export function bucketTone(n: number): BucketTone {
  if (n >= MIN_FULL_N) return "full";
  if (n >= MIN_THIN_N) return "thin";
  return "counts";
}

/** Default label for a slice: "skill · output (k=v)". The page passes a labelOf with skill titles. */
export function defaultSliceLabel(ref: SkillOutputRef): string {
  const params = ref.params ? Object.keys(ref.params).sort().map((k) => `${k}=${String(ref.params?.[k])}`) : [];
  return `${ref.skill} · ${ref.out}${params.length ? ` (${params.join(", ")})` : ""}`;
}

/** Human-readable slice label resolved from the skill registry's OutputSpec, falling back to `defaultSliceLabel`. */
export function skillSliceLabel(ref: SkillOutputRef, registry: SkillRegistry = SKILLS): string {
  const spec = outputSpecOf(ref, registry);
  return spec?.label ?? defaultSliceLabel(ref);
}

/** Compact run summary for the recipe list (§12.3), e.g. "last run: n 14 · +0.06R · 20 sess". */
export function runSummaryLine(result: Pick<RunResult, "stats" | "data">): string {
  return `last run: n ${result.stats.n} · ${signedR(result.stats.avgR)} · ${result.data.sessionsUsed.length} sess`;
}

export interface MarkSeedFields {
  date: string;
  time: string;
  priceText: string;
  side: "long" | "short";
}

/**
 * Converts a 1m bar's open timestamp (`barOpenMs`) into a Mark form seed at that bar's decision close
 * (`barOpenMs + 60_000`, §4.4 / §12.5 "Open at this time").
 */
export function markSeedFromBar(barOpenMs: number, price: number, side: "long" | "short"): MarkSeedFields {
  const decisionMs = barOpenMs + 60_000;
  const p = etParts(decisionMs);
  const date = `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const time = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const snapped = Math.round(price / 0.25) * 0.25;
  return { date, time, priceText: String(snapped), side };
}

export function headerLine(title: string, version: number, sessionsUsed: number, sessionsRequested: number): string {
  const sessions = sessionsUsed === sessionsRequested
    ? `${sessionsUsed} sessions`
    : `${sessionsUsed} of ${sessionsRequested} sessions`;
  return `${title} v${version} · ${sessions}`;
}

/** The overall stats lines under the header (§8.2). The first line is the one the screen leads with. */
export function statLines(stats: Stats): string[] {
  if (stats.n === 0) return ["No matches in this run. Widen the window or relax a condition."];
  const lines = [
    `n ${stats.n} · win ${pctText(stats.winRate)} (${ciText(stats.winRate95)}) · ${signedR(stats.avgR)} avg`,
  ];
  const e = stats.exits;
  const exitParts = [
    `T ${e.target ?? 0}`, `S ${e.stop ?? 0}`, `time ${e.time ?? 0}`, `amb ${e["ambiguous-stop"] ?? 0}`,
    ...((e["session-end"] ?? 0) > 0 ? [`end ${e["session-end"]}`] : []),
  ];
  lines.push(`exits: ${exitParts.join(" · ")}`);
  lines.push(`MFE p50 ${riskMultipleText(stats.mfeR.p50)} · MAE p50 ${riskMultipleText(stats.maeR.p50)}`);
  if (finite(stats.profitFactor)) lines.push(`profit factor ${stats.profitFactor.toFixed(2)}`);
  return lines;
}

/** One line on a Works or Fails card: the bucket, its count, and its shrunk average against the run's. */
export interface EdgeRow {
  role: "works" | "fails";
  slice: string;
  bucket: string;
  n: number;
  wins: number;
  shrunkR: string;
  overallR: string;
  clarity: Separator["clarity"];
  stability: Separator["stability"];
  thin: boolean;
  /** Rows from a thin slice are greyed. */
  greyed: boolean;
}

/**
 * Works and Fails rows from the ranked separators (the engine already ranks them: clear before
 * suggestive, stable before unstable, then gap). Thin buckets are greyed, never hidden.
 */
export function edgeRows(
  separators: readonly Separator[],
  splits: readonly Split[],
  overallAvgR: number | null,
  labelOf: (ref: SkillOutputRef) => string = defaultSliceLabel,
  limit = TOP_SEPARATORS,
): { works: EdgeRow[]; fails: EdgeRow[] } {
  const works: EdgeRow[] = [];
  const fails: EdgeRow[] = [];
  for (const sep of separators.slice(0, limit)) {
    const split = splits.find((s) => featureKey(s.ref) === featureKey(sep.ref));
    if (!split) continue;
    const best = split.buckets.find((b) => b.key === sep.best);
    const worst = split.buckets.find((b) => b.key === sep.worst);
    const slice = labelOf(sep.ref);
    if (best) works.push(edgeRow("works", slice, best, sep, overallAvgR));
    if (worst) fails.push(edgeRow("fails", slice, worst, sep, overallAvgR));
  }
  return { works, fails };
}

function edgeRow(
  role: EdgeRow["role"],
  slice: string,
  bucket: SplitBucket,
  sep: Separator,
  overallAvgR: number | null,
): EdgeRow {
  return {
    role,
    slice,
    bucket: bucket.label,
    n: bucket.n,
    wins: bucket.wins,
    shrunkR: signedR(bucket.shrunkAvgR),
    overallR: signedR(overallAvgR),
    clarity: sep.clarity,
    stability: sep.stability,
    thin: sep.thin || bucket.n < MIN_FULL_N,
    greyed: sep.thin || bucketTone(bucket.n) !== "full",
  };
}

/** The multiple-comparison line. Always rendered under the cards, even with no separators. */
export function comparisonNote(slicesTested: number): string {
  return multipleComparisonLine(slicesTested);
}

/** One row of a split table (§8.3). Counts-only rows show "—" for every rate. */
export interface SplitRowView {
  key: string;
  label: string;
  n: number;
  win: string;
  winCi: string;
  avgR: string;
  shrunkR: string;
  tone: BucketTone;
  note: string;
}

export function splitRowViews(split: Split): SplitRowView[] {
  return split.buckets.map((b) => {
    const tone = bucketTone(b.n);
    return {
      key: b.key,
      label: b.label,
      n: b.n,
      win: tone === "counts" ? "—" : pctText(b.winRate),
      winCi: tone === "counts" ? "" : ciText(b.winRate95),
      avgR: tone === "counts" ? "—" : signedR(b.avgR),
      shrunkR: tone === "counts" ? "—" : signedR(b.shrunkAvgR),
      tone,
      note: tone === "thin" ? "thin" : tone === "counts" ? "counts only" : "",
    };
  });
}

/** One row of the time-of-day list (§8.5). The bar length is |avg R| as a share of the largest. */
export interface TodRowView {
  bucket: string;
  n: number;
  win: string;
  avgR: string;
  barPct: number;
  sign: Sign;
  tone: BucketTone;
}

export function todRowViews(cells: readonly TodCell[]): TodRowView[] {
  const maxAbs = Math.max(0, ...cells.map((c) => (finite(c.avgR) ? Math.abs(c.avgR) : 0)));
  return cells.map((c) => {
    const tone = bucketTone(c.n);
    const shown = tone === "counts" ? null : c.avgR;
    return {
      bucket: c.bucket,
      n: c.n,
      win: tone === "counts" ? "—" : pctText(c.winRate),
      avgR: signedR(shown),
      barPct: finite(shown) && maxAbs > 0 ? (Math.abs(shown) / maxAbs) * 100 : 0,
      sign: signOf(shown),
      tone,
    };
  });
}

/** One match row (§12.5): time, outcome in R, exit reason, and the first few slice values. */
export interface MatchRowView {
  index: number;
  when: string;
  r: string;
  sign: Sign;
  exit: string;
  features: { label: string; value: string }[];
}

export interface MatchPage {
  rows: MatchRowView[];
  total: number;
  hidden: number;
}

const EXIT_TEXT: Record<Match["outcome"]["exitReason"], string> = {
  target: "target",
  stop: "stop",
  time: "time",
  "session-end": "session end",
  "ambiguous-stop": "ambiguous stop",
};

export function matchPage(
  matches: readonly Match[],
  sliceBy: readonly SkillOutputRef[],
  shown = MATCH_PAGE_SIZE,
  labelOf: (ref: SkillOutputRef) => string = defaultSliceLabel,
): MatchPage {
  const keys = sliceBy.slice(0, 3).map((ref) => ({ label: labelOf(ref), key: featureKey(ref) }));
  const rows = matches.slice(0, shown).map((m, index) => ({
    index,
    when: `${m.sessionDate} ${clockText(m.time)} ET`,
    r: signedR(m.outcome.resultR),
    sign: signOf(m.outcome.resultR),
    exit: EXIT_TEXT[m.outcome.exitReason],
    features: keys.map((k) => ({ label: k.label, value: valueText(m.features[k.key]) })),
  }));
  return { rows, total: matches.length, hidden: Math.max(0, matches.length - rows.length) };
}

export interface SparkPoint { x: number; y: number }
export interface Sparkline {
  points: SparkPoint[];
  /** Index into `points` of the match bar, or -1 when that bar has no close. */
  markerAt: number;
}

/**
 * Close prices of the bars around a match, from the same session only, scaled to 0–1 (y inverted so
 * up is up). NaN closes are skipped. Used for the match sheet's bar window (§12.5).
 */
export function sparkline(series: BarSeries, i: number, span = 30): Sparkline {
  const date = series.sessionDate[i];
  const lo = Math.max(0, i - span);
  const hi = Math.min(series.close.length - 1, i + span);
  const idx: number[] = [];
  for (let j = lo; j <= hi; j += 1) {
    if (series.sessionDate[j] === date && Number.isFinite(series.close[j])) idx.push(j);
  }
  if (idx.length === 0) return { points: [], markerAt: -1 };
  const closes = idx.map((j) => series.close[j]);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min;
  const points = idx.map((j, k) => ({
    x: idx.length === 1 ? 0.5 : k / (idx.length - 1),
    y: range === 0 ? 0.5 : 1 - (series.close[j] - min) / range,
  }));
  return { points, markerAt: idx.indexOf(i) };
}

/** Lines for the Data footer (§12.5): sessions used, exclusions, missing-bar counts, and the R basis. */
export function dataLines(data: RunResult["data"], rBasis: string): string[] {
  const lines = [
    `Sessions used ${data.sessionsUsed.length} of ${data.sessionsRequested}`,
    `Bars missing ${data.barsMissing} · volume missing ${data.volumeMissing}`,
    rBasis,
  ];
  for (const ex of data.excluded) lines.push(`Not used: ${ex.date} (${ex.reason})`);
  return lines;
}
