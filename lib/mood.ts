// Mood Shape: the trader's discretionary and emotional state on one trade, drawn as a soft radar blob.
// Pure: no I/O, no DOM, no clock (callers pass `now`).
//
// Truth and derivation (docs/15 §3.1, "events are the truth"):
// - The trader's notes and voice transcripts are the source. A score is a derived, versioned record
//   (`MoodRecord`) that names the spoke set it was made against, its source and its evidence.
// - Records are append-only. The newest user value for a spoke wins over any AI value, whenever either
//   was written (UX-33, guardrail 11). Execution tags only seed a default where nothing is recorded.
// - A spoke with no score is unknown (`null`), never 0. It is drawn dashed and left out of all math.
//
// No table and no migration until OD-30 is settled. See docs/18.

import { rMultiple } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";

export type MoodSource = "user" | "voice_ai";
/** Where a resolved value came from. `tag` is a default read from execution tags, never stored. */
export type MoodOrigin = MoodSource | "tag";
/** Whether a score was captured before the exit (decision time) or after it (hindsight can leak in). */
export type MoodPhase = "pre_exit" | "post_exit" | "unknown";

export interface MoodSpoke {
  /** Stable key, e.g. `fomo`. Never reused for another meaning. */
  id: string;
  label: string;
  /** Short axis label for small shapes. */
  short: string;
  /** Registry version that added this spoke. Records older than this cannot have scored it. */
  added_in_version: number;
}

export interface MoodSpokeRegistry {
  version: number;
  spokes: MoodSpoke[];
}

/** Standard score assigned by one-tap capture at entry or pre-exit (docs/19 §4, OD-39 c). */
export const ONE_TAP_MOOD_SCORE = 0.8;

/** Concise chip label for one-tap mood selection (e.g. "Calm" instead of "Calm / patience"). */
export function spokeChipLabel(spoke: Pick<MoodSpoke, "id" | "label">): string {
  return spoke.id === "calm" ? "Calm" : spoke.label;
}

/**
 * Starting spokes (owner to confirm, OD-39). Ordered so opposites face each other on the ring:
 * calm ↔ FOMO, confidence ↔ fear, hope ↔ frustration.
 */
export const DEFAULT_MOOD_REGISTRY: MoodSpokeRegistry = {
  version: 1,
  spokes: [
    { id: "calm", label: "Calm / patience", short: "Calm", added_in_version: 1 },
    { id: "confidence", label: "Confidence", short: "Conf", added_in_version: 1 },
    { id: "hope", label: "Hope", short: "Hope", added_in_version: 1 },
    { id: "fomo", label: "FOMO", short: "FOMO", added_in_version: 1 },
    { id: "fear", label: "Fear", short: "Fear", added_in_version: 1 },
    { id: "frustration", label: "Frustration", short: "Frus", added_in_version: 1 },
  ],
};

/** Execution tags that seed a default score when nothing is recorded for that spoke (docs/03 §2A). */
export const MOOD_TAG_SEEDS: Record<string, { spoke: string; value: number }> = {
  "A+ Patience": { spoke: "calm", value: 0.8 },
  "Chased Entry": { spoke: "fomo", value: 0.8 },
  "Cut Early": { spoke: "fear", value: 0.7 },
  "Moved Stop": { spoke: "hope", value: 0.7 },
  Revenge: { spoke: "frustration", value: 0.8 },
};

/** Occurrences (distinct trades) before a new emotion is offered as a spoke (owner to confirm, OD-39). */
export const DEFAULT_CANDIDATE_THRESHOLD = 3;
/** Fewest trades before a comparison is shown as more than "not enough data yet". */
export const MIN_MOOD_SAMPLE = 20;
/** A spoke dominates when it is at least this high and this far above the next one. */
export const MOOD_DOMINANT_MIN = 0.5;
export const MOOD_DOMINANT_MARGIN = 0.15;
/** Scored spokes within this range of each other read as a balanced (round) shape. */
export const MOOD_DOMINANCE_SPREAD = 0.25;
/** Fewest spokes two trades must both have scored before their shapes are compared. */
export const MIN_SPOKE_OVERLAP = 3;

/** A derived, versioned score record. Append-only: a correction is a new record. */
export interface MoodRecord {
  id: string;
  trade_id: string;
  spoke_set_version: number;
  /** 0–1 per spoke. `null` only on a user record: the trader set that spoke back to unknown. */
  scores: Record<string, number | null>;
  /** Short quote from the source text for each scored spoke. Always present on `voice_ai` scores. */
  evidence: Record<string, string>;
  source: MoodSource;
  /** Parser or model that made a `voice_ai` record. Null for the trader's own. */
  model: string | null;
  /** When the feeling was captured (the tap, the memo), or null when not known (a re-score of old notes). */
  captured_at: string | null;
  created_at: string;
}

export function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** `Overconfidence after a win` → `overconfidence-after-a-win`. */
export function spokeIdFor(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export function spokeById(registry: MoodSpokeRegistry, id: string) {
  return registry.spokes.find((spoke) => spoke.id === id) ?? null;
}

/**
 * Before or after the exit, from when the feeling was captured. An open trade's captures are pre-exit.
 * An unknown capture time is `unknown`, never guessed.
 */
export function capturePhase(record: Pick<MoodRecord, "captured_at">, trade: Pick<TradeRecord, "exit_time">): MoodPhase {
  if (record.captured_at == null) return "unknown";
  const captured = Date.parse(record.captured_at);
  if (!Number.isFinite(captured)) return "unknown";
  if (trade.exit_time == null) return "pre_exit";
  const exit = Date.parse(trade.exit_time);
  if (!Number.isFinite(exit)) return "unknown";
  return captured < exit ? "pre_exit" : "post_exit";
}

export interface ResolvedSpoke {
  spoke: MoodSpoke;
  value: number | null;
  origin: MoodOrigin | null;
  evidence: string | null;
  phase: MoodPhase;
  record_id: string | null;
}

export interface MoodVector {
  trade_id: string;
  spoke_set_version: number;
  spokes: string[];
  values: Array<number | null>;
  detail: ResolvedSpoke[];
}

export interface MoodVectorOptions {
  /** `pre_exit`: only scores captured before the exit, and no tag defaults (tags carry no time). */
  phase?: "any" | "pre_exit";
}

const byCreated = (a: MoodRecord, b: MoodRecord) => Date.parse(a.created_at) - Date.parse(b.created_at);

/**
 * The trade's score vector over the registry's current spokes.
 * Per spoke: newest user value, else newest AI value, else a tag default, else unknown (null).
 */
export function moodVector(
  trade: Pick<TradeRecord, "id" | "exit_time" | "quick_tags">,
  records: MoodRecord[],
  registry: MoodSpokeRegistry,
  options: MoodVectorOptions = {},
): MoodVector {
  const phaseFilter = options.phase ?? "any";
  const own = records
    .filter((record) => record.trade_id === trade.id)
    .filter((record) => phaseFilter === "any" || capturePhase(record, trade) === "pre_exit")
    .sort(byCreated);
  const detail = registry.spokes.map((spoke): ResolvedSpoke => {
    const latest = (source: MoodSource) => {
      for (let index = own.length - 1; index >= 0; index -= 1) {
        const record = own[index];
        if (record.source !== source || !(spoke.id in record.scores)) continue;
        const value = record.scores[spoke.id];
        // An AI record never says "unknown"; a user record may.
        if (value == null && source === "voice_ai") continue;
        return record;
      }
      return null;
    };
    const fromRecord = (record: MoodRecord): ResolvedSpoke => {
      const value = record.scores[spoke.id];
      return {
        spoke,
        value: value == null ? null : clampScore(value),
        origin: value == null ? null : record.source,
        evidence: record.evidence[spoke.id] ?? null,
        phase: capturePhase(record, trade),
        record_id: record.id,
      };
    };
    const user = latest("user");
    if (user) return fromRecord(user);
    const ai = latest("voice_ai");
    if (ai) return fromRecord(ai);
    if (phaseFilter === "any") {
      const seeds = trade.quick_tags.map((tag) => ({ tag, seed: MOOD_TAG_SEEDS[tag] })).filter((item) => item.seed?.spoke === spoke.id);
      if (seeds.length) {
        const best = seeds.reduce((a, b) => (b.seed.value > a.seed.value ? b : a));
        return { spoke, value: best.seed.value, origin: "tag", evidence: best.tag, phase: "unknown", record_id: null };
      }
    }
    return { spoke, value: null, origin: null, evidence: null, phase: "unknown", record_id: null };
  });
  return {
    trade_id: trade.id,
    spoke_set_version: registry.version,
    spokes: detail.map((item) => item.spoke.id),
    values: detail.map((item) => item.value),
    detail,
  };
}

export function knownCount(vector: Pick<MoodVector, "values">) {
  return vector.values.filter((value) => value != null).length;
}

/** The spoke that pulls the shape, or null when the state is balanced or unknown. */
export function dominantSpoke(vector: Pick<MoodVector, "spokes" | "values">): string | null {
  const known = vector.spokes.map((id, index) => ({ id, value: vector.values[index] })).filter((item): item is { id: string; value: number } => item.value != null);
  if (!known.length) return null;
  known.sort((a, b) => b.value - a.value);
  const [top, next] = known;
  if (top.value < MOOD_DOMINANT_MIN) return null;
  if (next && top.value - next.value < MOOD_DOMINANT_MARGIN) return null;
  return top.id;
}

function level(value: number) {
  return value >= 0.67 ? "high" : value <= 0.33 ? "low" : "moderate";
}

/**
 * Plain description of the shape. Describes, never judges (UX-67): "FOMO high", not "You chased".
 */
export function describeMood(vector: MoodVector): string {
  const known = vector.detail.filter((item): item is ResolvedSpoke & { value: number } => item.value != null);
  if (!known.length) return "No mood recorded";
  const dominant = dominantSpoke(vector);
  const sorted = [...known].sort((a, b) => b.value - a.value);
  const parts = sorted.slice(0, 2).map((item) => `${item.spoke.label} ${level(item.value)}`);
  const unknown = vector.values.length - known.length;
  // "Balanced" only when the scored spokes sit close together; two strong feelings are not balance.
  const spread = sorted[0].value - sorted[sorted.length - 1].value;
  const lead = !dominant && known.length >= 3 && spread < MOOD_DOMINANCE_SPREAD ? `Balanced · ${parts.join(" · ")}` : parts.join(" · ");
  return unknown ? `${lead} · ${unknown} not scored` : lead;
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface MoodPathOptions {
  /** Width and height of the square drawing, in user units. */
  size: number;
  /** Space kept clear around the outermost radius. */
  padding?: number;
  /** Radius fraction used for a score of 0, so a low spoke does not collapse into the centre. */
  floor?: number;
  /** Radius fraction an unknown spoke is drawn at. It is dashed and carries no meaning. */
  unknownRadius?: number;
}

export interface MoodPoint {
  x: number;
  y: number;
  /** Radians, 0 = right, measured clockwise in screen space. */
  angle: number;
  known: boolean;
  /** Where the spoke ends at a score of 1. */
  axisX: number;
  axisY: number;
}

export interface MoodGeometry {
  center: number;
  radius: number;
  /** Closed blob for the fill. */
  fill: string;
  /** Outline segments whose two ends are both scored. */
  solid: string;
  /** Outline segments that touch an unknown spoke. */
  dashed: string;
  points: MoodPoint[];
}

const fmt = (value: number) => (Math.round(value * 100) / 100).toString();

/** Angle of spoke `index` of `count`, first spoke at the top, clockwise. */
export function spokeAngle(index: number, count: number) {
  return -Math.PI / 2 + (index * 2 * Math.PI) / count;
}

/** Map a 0–1 score to a radius fraction above the floor. */
export function scoreRadius(value: number, floor: number) {
  return floor + clampScore(value) * (1 - floor);
}

/**
 * The blob outline: a closed uniform Catmull-Rom curve through one point per spoke, as cubic Béziers.
 * Same family as d3-shape's `curveCatmullRomClosed`, written out so segments can be split into
 * solid (both ends scored) and dashed (an end is unknown). Returns null below three spokes.
 */
export function moodPath(values: Array<number | null>, options: MoodPathOptions): MoodGeometry | null {
  const count = values.length;
  if (count < 3) return null;
  const padding = options.padding ?? 2;
  const floor = options.floor ?? 0.12;
  const unknownRadius = options.unknownRadius ?? 0.5;
  const center = options.size / 2;
  const radius = Math.max(0, center - padding);
  const points: MoodPoint[] = values.map((value, index) => {
    const angle = spokeAngle(index, count);
    const fraction = value == null ? scoreRadius(unknownRadius, floor) : scoreRadius(value, floor);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: center + cos * radius * fraction,
      y: center + sin * radius * fraction,
      angle,
      known: value != null,
      axisX: center + cos * radius,
      axisY: center + sin * radius,
    };
  });
  const at = (index: number) => points[(index + count) % count];
  const segment = (index: number) => {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    return `C${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(p2.x)},${fmt(p2.y)}`;
  };
  const move = (point: MoodPoint) => `M${fmt(point.x)},${fmt(point.y)}`;
  const fill = `${move(points[0])}${points.map((_, index) => segment(index)).join("")}Z`;
  const solid: string[] = [];
  const dashed: string[] = [];
  points.forEach((point, index) => {
    const piece = `${move(point)}${segment(index)}`;
    (point.known && at(index + 1).known ? solid : dashed).push(piece);
  });
  return { center, radius, fill, solid: solid.join(""), dashed: dashed.join(""), points };
}

/** Score at a point dragged along spoke `index`: the projection onto the axis, clamped to 0–1. */
export function scoreAtPoint(x: number, y: number, index: number, count: number, size: number, options: Pick<MoodPathOptions, "padding" | "floor"> = {}) {
  const padding = options.padding ?? 2;
  const floor = options.floor ?? 0.12;
  const center = size / 2;
  const radius = Math.max(1e-9, center - padding);
  const angle = spokeAngle(index, count);
  const along = ((x - center) * Math.cos(angle) + (y - center) * Math.sin(angle)) / radius;
  return round2(clampScore((along - floor) / (1 - floor)));
}

// ---------------------------------------------------------------------------------------------
// Comparing shapes
// ---------------------------------------------------------------------------------------------

export interface MoodSimilarity {
  similarity: number;
  /** 1 − cosine similarity. */
  distance: number;
  /** Spokes both trades scored. Unknown spokes are left out, never read as 0. */
  overlap: number;
}

/** Cosine similarity over the spokes both vectors scored. Null when they share too few or one is all zero. */
export function moodSimilarity(a: Pick<MoodVector, "spokes" | "values">, b: Pick<MoodVector, "spokes" | "values">, minOverlap = MIN_SPOKE_OVERLAP): MoodSimilarity | null {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  let overlap = 0;
  a.spokes.forEach((id, index) => {
    const valueA = a.values[index];
    const otherIndex = b.spokes.indexOf(id);
    const valueB = otherIndex >= 0 ? b.values[otherIndex] : null;
    if (valueA == null || valueB == null) return;
    overlap += 1;
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  });
  if (overlap < minOverlap || normA === 0 || normB === 0) return null;
  const similarity = Math.min(1, dot / Math.sqrt(normA * normB));
  return { similarity, distance: 1 - similarity, overlap };
}

export interface RSummary {
  /** Trades with an R. */
  n: number;
  /** Trades left out because they have no R (no stop, or still open). Never counted as 0. */
  skipped: number;
  wins: number;
  losses: number;
  meanR: number | null;
  medianR: number | null;
  /** Every R, ascending, for a distribution strip. */
  values: number[];
  enough: boolean;
}

export function summarizeR(values: Array<number | null>): RSummary {
  const rs = values.filter((value): value is number => value != null && Number.isFinite(value)).sort((a, b) => a - b);
  const n = rs.length;
  const middle = Math.floor(n / 2);
  return {
    n,
    skipped: values.length - n,
    wins: rs.filter((value) => value > 0).length,
    losses: rs.filter((value) => value < 0).length,
    meanR: n ? rs.reduce((sum, value) => sum + value, 0) / n : null,
    medianR: n ? (n % 2 ? rs[middle] : (rs[middle - 1] + rs[middle]) / 2) : null,
    values: rs,
    enough: n >= MIN_MOOD_SAMPLE,
  };
}

export interface SimilarTradesOptions {
  /** Cosine similarity a trade needs to count as "felt like this". */
  minSimilarity?: number;
  limit?: number;
  minOverlap?: number;
  phase?: MoodVectorOptions["phase"];
}

export interface SimilarTrade {
  trade: TradeRecord;
  similarity: number;
  r: number | null;
}

export interface SimilarTradesResult {
  matches: SimilarTrade[];
  summary: RSummary;
}

/**
 * Trades whose shape is close to this one's, most similar first, with their R distribution.
 * Sample trades are compared only with samples, and real trades only with real ones (docs/10 §5).
 */
export function similarTrades(
  target: TradeRecord,
  trades: TradeRecord[],
  records: MoodRecord[],
  registry: MoodSpokeRegistry,
  options: SimilarTradesOptions = {},
): SimilarTradesResult {
  const minSimilarity = options.minSimilarity ?? 0.9;
  const limit = options.limit ?? 50;
  const vectorOptions = { phase: options.phase ?? "any" } as const;
  const base = moodVector(target, records, registry, vectorOptions);
  const matches = trades
    .filter((trade) => trade.id !== target.id && trade.is_sample === target.is_sample)
    .flatMap((trade) => {
      const score = moodSimilarity(base, moodVector(trade, records, registry, vectorOptions), options.minOverlap ?? MIN_SPOKE_OVERLAP);
      return score && score.similarity >= minSimilarity ? [{ trade, similarity: score.similarity, r: rMultiple(trade) }] : [];
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  return { matches, summary: summarizeR(matches.map((match) => match.r)) };
}

export interface MoodGroupShape {
  /** Trades in the group. */
  n: number;
  /** Mean score per spoke over the trades that scored it; null where none did. */
  shape: Array<number | null>;
  /** Trades that scored each spoke. */
  perSpoke: number[];
}

export interface MoodOutcomeStats {
  spokes: string[];
  winners: MoodGroupShape;
  losers: MoodGroupShape;
  /** Expectancy (mean R) by the spoke that dominated; `spoke: null` is the balanced group. */
  byDominant: Array<{ spoke: string | null; summary: RSummary }>;
  /** Trades used: closed, real, with an R and at least one scored spoke. */
  used: number;
  skipped: { sample: number; open: number; noR: number; noMood: number };
  enough: boolean;
}

function groupShape(vectors: MoodVector[], count: number): MoodGroupShape {
  const sums = Array<number>(count).fill(0);
  const perSpoke = Array<number>(count).fill(0);
  for (const vector of vectors) {
    vector.values.forEach((value, index) => {
      if (value == null) return;
      sums[index] += value;
      perSpoke[index] += 1;
    });
  }
  return { n: vectors.length, shape: sums.map((sum, index) => (perSpoke[index] ? Math.round((sum / perSpoke[index]) * 1e4) / 1e4 : null)), perSpoke };
}

/**
 * Average shape of winners against losers, and expectancy by dominant spoke. Samples and open trades
 * never count; trades without R are counted as skipped, never as 0 (R-08 rules, docs/16).
 * With `phase: "pre_exit"` only scores captured before the exit are used, so results cannot shape them.
 */
export function moodOutcomeStats(trades: TradeRecord[], records: MoodRecord[], registry: MoodSpokeRegistry, options: MoodVectorOptions = {}): MoodOutcomeStats {
  const skipped = { sample: 0, open: 0, noR: 0, noMood: 0 };
  const rows: Array<{ vector: MoodVector; r: number }> = [];
  for (const trade of trades) {
    if (trade.is_sample) { skipped.sample += 1; continue; }
    if (trade.exit_time == null) { skipped.open += 1; continue; }
    const r = rMultiple(trade);
    if (r == null) { skipped.noR += 1; continue; }
    const vector = moodVector(trade, records, registry, options);
    if (!knownCount(vector)) { skipped.noMood += 1; continue; }
    rows.push({ vector, r });
  }
  const count = registry.spokes.length;
  const groups = new Map<string | null, number[]>();
  for (const row of rows) {
    const key = dominantSpoke(row.vector);
    groups.set(key, [...(groups.get(key) ?? []), row.r]);
  }
  const order = [...registry.spokes.map((spoke) => spoke.id), null];
  return {
    spokes: registry.spokes.map((spoke) => spoke.id),
    winners: groupShape(rows.filter((row) => row.r > 0).map((row) => row.vector), count),
    losers: groupShape(rows.filter((row) => row.r < 0).map((row) => row.vector), count),
    byDominant: order.filter((key) => groups.has(key)).map((spoke) => ({ spoke, summary: summarizeR(groups.get(spoke) ?? []) })),
    used: rows.length,
    skipped,
    enough: rows.length >= MIN_MOOD_SAMPLE,
  };
}

// ---------------------------------------------------------------------------------------------
// Suggestions from text (stand-in for the AI auto-parser) and the parser's output contract
// ---------------------------------------------------------------------------------------------

/** A suggestion is shown for Accept / Adjust. It is never a score until the trader accepts it (UX-33). */
export interface MoodSuggestion {
  trade_id: string;
  spoke_set_version: number;
  scores: Record<string, number>;
  evidence: Record<string, string>;
  /** Emotions the text names that are not spokes yet. */
  candidates: Array<{ label: string; evidence: string }>;
  model: string;
  captured_at: string | null;
  created_at: string;
}

/** The on-device phrase matcher. It only scores what the text says; no cue means unknown, not 0. */
export const LOCAL_MOOD_MODEL = "mogmine-phrases-v1";

type Cue = [RegExp, number];

/** Phrases per spoke. Values are the score a clear statement of that feeling suggests. */
const SPOKE_CUES: Record<string, Cue[]> = {
  calm: [[/\bpatien(t|ce|tly)\b/, 0.8], [/\bcalm\b/, 0.8], [/\bwaited for\b/, 0.7], [/\bheld through\b/, 0.7], [/\blet (it|the target) (fill|work|play out)\b/, 0.7], [/\bno rush\b/, 0.7]],
  confidence: [[/\bconfident\b/, 0.8], [/\bconviction\b/, 0.8], [/\bclear read\b/, 0.7], [/\btextbook\b/, 0.7], [/\bsized up\b/, 0.6]],
  hope: [[/\bhop(e|ed|ing)\b/, 0.7], [/\bmoved (my|the) stop\b/, 0.75], [/\bpray(ed|ing)?\b/, 0.8], [/\bwould come back\b/, 0.7], [/\bgive it (more )?room\b/, 0.6]],
  fomo: [[/\bfomo\b/, 0.9], [/\bchas(e|ed|ing)\b/, 0.85], [/\bdid ?n[o']t want to miss\b/, 0.85], [/\bbefore it was confirmed\b/, 0.7], [/\bjumped in\b/, 0.7], [/\bafraid to miss\b/, 0.85]],
  fear: [[/\bscared\b/, 0.8], [/\bnervous\b/, 0.7], [/\bafraid\b/, 0.75], [/\bfear(ful)?\b/, 0.8], [/\bpanick?(ed|ing)?\b/, 0.9], [/\bflinch(ed)?\b/, 0.7], [/\btook (everything|it all) off\b/, 0.6]],
  frustration: [[/\bfrustrat(ed|ing|ion)\b/, 0.8], [/\brevenge\b/, 0.9], [/\bangry\b/, 0.8], [/\btilt(ed)?\b/, 0.85], [/\bmake it back\b/, 0.85], [/\bpissed\b/, 0.85], [/\bannoyed\b/, 0.7]],
};

/** Emotions the matcher can name that are not starting spokes. They become candidates (and score once added). */
const CANDIDATE_CUES: Record<string, { label: string; cues: Cue[] }> = {
  boredom: { label: "Boredom", cues: [[/\bbored(om)?\b/, 0.8], [/\bnothing (else )?to do\b/, 0.7]] },
  overconfidence: { label: "Overconfidence", cues: [[/\bover-?confiden(t|ce)\b/, 0.8], [/\bcocky\b/, 0.85], [/\bcould ?n[o']t lose\b/, 0.85]] },
  greed: { label: "Greed", cues: [[/\bgreed(y)?\b/, 0.8], [/\bwanted more\b/, 0.7]] },
  impatience: { label: "Impatience", cues: [[/\bimpatien(t|ce)\b/, 0.8], [/\bcould ?n[o']t wait\b/, 0.75]] },
  regret: { label: "Regret", cues: [[/\bregret(ted)?\b/, 0.8], [/\bshould have\b/, 0.6]] },
  relief: { label: "Relief", cues: [[/\brelie(f|ved)\b/, 0.8]] },
  fatigue: { label: "Fatigue", cues: [[/\btired\b/, 0.75], [/\bexhausted\b/, 0.85], [/\bdrained\b/, 0.75]] },
  doubt: { label: "Doubt", cues: [[/\bdoubt(ed|ing)?\b/, 0.75], [/\bhesitat(ed|ing|ion)\b/, 0.7], [/\bsecond-?guess/, 0.75]] },
};

const NEGATION = /\b(not|never|no|wasn'?t|didn'?t|don'?t|wasnt|isn'?t|without)\s+(\w+\s+)?$/;

function sentences(text: string) {
  return text.split(/(?<=[.!?\n])\s+/).map((part) => part.trim()).filter(Boolean);
}

/** A quote of at most `max` characters around the match, cut at word edges. */
function quote(sentence: string, index: number, length: number, max = 90) {
  if (sentence.length <= max) return sentence;
  let start = Math.max(0, Math.min(index - Math.floor((max - length) / 2), sentence.length - max));
  let end = start + max;
  if (start > 0) {
    const space = sentence.indexOf(" ", start);
    if (space >= 0 && space < index) start = space + 1;
  }
  if (end < sentence.length) {
    const space = sentence.lastIndexOf(" ", end);
    if (space > index + length) end = space;
  }
  return `${start > 0 ? "…" : ""}${sentence.slice(start, end)}${end < sentence.length ? "…" : ""}`;
}

function matchCues(text: string, cues: Cue[]): { value: number; evidence: string } | null {
  let best: { value: number; evidence: string } | null = null;
  for (const sentence of sentences(text)) {
    const lower = sentence.toLowerCase();
    for (const [pattern, value] of cues) {
      const match = pattern.exec(lower);
      if (!match) continue;
      if (NEGATION.test(lower.slice(0, match.index))) continue;
      if (!best || value > best.value) best = { value, evidence: quote(sentence, match.index, match[0].length) };
    }
  }
  return best;
}

/**
 * Suggest scores from note or transcript text with the on-device phrase matcher. Scores only spokes the
 * text speaks to, each with its evidence quote. Emotions outside the registry come back as candidates.
 */
export function suggestMoodFromText(text: string, registry: MoodSpokeRegistry, meta: { trade_id: string; now: string; captured_at?: string | null }): MoodSuggestion {
  const scores: Record<string, number> = {};
  const evidence: Record<string, string> = {};
  const candidates: MoodSuggestion["candidates"] = [];
  const known = new Set(registry.spokes.map((spoke) => spoke.id));
  for (const spoke of registry.spokes) {
    const cues = SPOKE_CUES[spoke.id] ?? CANDIDATE_CUES[spoke.id]?.cues ?? [];
    const hit = matchCues(text, cues);
    if (hit) { scores[spoke.id] = hit.value; evidence[spoke.id] = hit.evidence; }
  }
  for (const [id, candidate] of Object.entries(CANDIDATE_CUES)) {
    if (known.has(id)) continue;
    const hit = matchCues(text, candidate.cues);
    if (hit) candidates.push({ label: candidate.label, evidence: hit.evidence });
  }
  return { trade_id: meta.trade_id, spoke_set_version: registry.version, scores, evidence, candidates, model: LOCAL_MOOD_MODEL, captured_at: meta.captured_at ?? null, created_at: meta.now };
}

const squash = (text: string) => text.toLowerCase().replace(/[“”"]/g, "").replace(/…/g, "").replace(/\s+/g, " ").trim();

/** Whether a quote really appears in the source (ellipses stand for cut text). */
function quoteInText(evidence: string, source: string) {
  const haystack = squash(source);
  return evidence.split("…").map(squash).filter(Boolean).every((piece) => haystack.includes(piece));
}

export type ParseMoodResult = { ok: true; suggestion: MoodSuggestion } | { ok: false; error: string };

/**
 * The contract for the AI auto-parser's mood output (docs/18 §4). Accepts
 * `{ scores: {spoke: number}, evidence: {spoke: string}, candidates?: [{label, evidence}] }`.
 * Rejects scores outside 0–1, a score without evidence, and evidence that is not a quote of the text.
 * A score for a spoke that is not in the registry becomes a candidate instead.
 */
export function parseMoodSuggestion(raw: unknown, registry: MoodSpokeRegistry, sourceText: string, meta: { trade_id: string; model: string; now: string; captured_at?: string | null }): ParseMoodResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Not an object" };
  const input = raw as { scores?: unknown; evidence?: unknown; candidates?: unknown };
  if (!input.scores || typeof input.scores !== "object" || Array.isArray(input.scores)) return { ok: false, error: "Missing scores" };
  const evidenceIn = input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence) ? (input.evidence as Record<string, unknown>) : {};
  const known = new Set(registry.spokes.map((spoke) => spoke.id));
  const scores: Record<string, number> = {};
  const evidence: Record<string, string> = {};
  const candidates: MoodSuggestion["candidates"] = [];
  for (const [key, value] of Object.entries(input.scores as Record<string, unknown>)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return { ok: false, error: `Score for ${key} is not between 0 and 1` };
    const quoteText = evidenceIn[key];
    if (typeof quoteText !== "string" || !quoteText.trim()) return { ok: false, error: `Score for ${key} has no evidence` };
    if (!quoteInText(quoteText, sourceText)) return { ok: false, error: `Evidence for ${key} is not in the text` };
    const id = spokeIdFor(key);
    if (known.has(id)) { scores[id] = round2(value); evidence[id] = quoteText.trim(); }
    else candidates.push({ label: key.trim(), evidence: quoteText.trim() });
  }
  if (Array.isArray(input.candidates)) {
    for (const item of input.candidates) {
      if (!item || typeof item !== "object") continue;
      const { label, evidence: said } = item as { label?: unknown; evidence?: unknown };
      if (typeof label !== "string" || !label.trim() || label.trim().length > 40) continue;
      if (typeof said !== "string" || !quoteInText(said, sourceText)) continue;
      if (known.has(spokeIdFor(label)) || candidates.some((existing) => spokeIdFor(existing.label) === spokeIdFor(label))) continue;
      candidates.push({ label: label.trim(), evidence: said.trim() });
    }
  }
  return { ok: true, suggestion: { trade_id: meta.trade_id, spoke_set_version: registry.version, scores, evidence, candidates, model: meta.model, captured_at: meta.captured_at ?? null, created_at: meta.now } };
}

/** Spokes the trader has set by hand on this trade. AI never writes these (UX-33). */
export function userSetSpokes(tradeId: string, records: MoodRecord[]) {
  const set = new Set<string>();
  for (const record of records) {
    if (record.trade_id !== tradeId || record.source !== "user") continue;
    for (const key of Object.keys(record.scores)) set.add(key);
  }
  return set;
}

/**
 * Turn an accepted suggestion into a `voice_ai` record. Spokes the trader already set are dropped, so
 * an AI score can never replace a user score. Pass `spokes` to accept only some. Null when nothing is left.
 */
export function acceptSuggestion(suggestion: MoodSuggestion, records: MoodRecord[], meta: { id: string; now: string; spokes?: string[] }): MoodRecord | null {
  const mine = userSetSpokes(suggestion.trade_id, records);
  const wanted = meta.spokes ? new Set(meta.spokes) : null;
  const scores: Record<string, number> = {};
  const evidence: Record<string, string> = {};
  for (const [spoke, value] of Object.entries(suggestion.scores)) {
    if (mine.has(spoke) || (wanted && !wanted.has(spoke))) continue;
    scores[spoke] = clampScore(value);
    if (suggestion.evidence[spoke]) evidence[spoke] = suggestion.evidence[spoke];
  }
  if (!Object.keys(scores).length) return null;
  return { id: meta.id, trade_id: suggestion.trade_id, spoke_set_version: suggestion.spoke_set_version, scores, evidence, source: "voice_ai", model: suggestion.model, captured_at: suggestion.captured_at, created_at: meta.now };
}

/** The trader sets one or more spokes (e.g. one-tap mood at entry). */
export function userMoodRecord(
  meta: { id: string; trade_id: string; now: string; captured_at?: string | null },
  registry: MoodSpokeRegistry,
  scores: Record<string, number | null>,
): MoodRecord {
  const sanitized: Record<string, number | null> = {};
  for (const [spoke, value] of Object.entries(scores)) {
    sanitized[spoke] = value == null ? null : round2(clampScore(value));
  }
  return {
    id: meta.id,
    trade_id: meta.trade_id,
    spoke_set_version: registry.version,
    scores: sanitized,
    evidence: {},
    source: "user",
    model: null,
    captured_at: meta.captured_at ?? meta.now,
    created_at: meta.now,
  };
}

/** The trader sets one spoke (a drag, or back to unknown with `null`). */
export function userScoreRecord(meta: { id: string; trade_id: string; now: string; captured_at?: string | null }, registry: MoodSpokeRegistry, spoke: string, value: number | null): MoodRecord {
  return userMoodRecord(meta, registry, { [spoke]: value });
}

// ---------------------------------------------------------------------------------------------
// Dynamic spokes
// ---------------------------------------------------------------------------------------------

export interface MoodSpokeCandidate {
  id: string;
  label: string;
  /** Distinct trades whose text named it. */
  count: number;
  trade_ids: string[];
  first_seen: string;
  last_seen: string;
  /** The trader said no to "Add spoke?". It is not offered again. */
  dismissed: boolean;
}

/** Count candidate emotions, once per trade. */
export function recordCandidates(list: MoodSpokeCandidate[], labels: string[], tradeId: string, now: string): MoodSpokeCandidate[] {
  const next = list.map((item) => ({ ...item, trade_ids: [...item.trade_ids] }));
  for (const label of labels) {
    const id = spokeIdFor(label);
    if (!id) continue;
    const existing = next.find((item) => item.id === id);
    if (!existing) {
      next.push({ id, label: label.trim(), count: 1, trade_ids: [tradeId], first_seen: now, last_seen: now, dismissed: false });
    } else if (!existing.trade_ids.includes(tradeId)) {
      existing.trade_ids.push(tradeId);
      existing.count = existing.trade_ids.length;
      existing.last_seen = now;
    }
  }
  return next;
}

/** Candidates to offer as "Add spoke?": seen on enough trades, not dismissed, not already a spoke. */
export function readyCandidates(list: MoodSpokeCandidate[], registry: MoodSpokeRegistry, threshold = DEFAULT_CANDIDATE_THRESHOLD) {
  return list.filter((item) => !item.dismissed && item.count >= threshold && !spokeById(registry, item.id));
}

/** A new registry version with one more spoke. Spokes are never removed or renamed in place. */
export function addSpoke(registry: MoodSpokeRegistry, label: string): MoodSpokeRegistry {
  const id = spokeIdFor(label);
  if (!id) throw new Error("A spoke needs a name");
  if (spokeById(registry, id)) return registry;
  const version = registry.version + 1;
  const short = label.trim().replace(/\s+/g, " ").split(" ")[0].slice(0, 5);
  return { version, spokes: [...registry.spokes, { id, label: label.trim(), short, added_in_version: version }] };
}

/** All the trader's own words on a trade, in the order they were written. */
export function moodSourceText(trade: Pick<TradeRecord, "pre_trade_thesis" | "management_notes" | "note" | "post_exit_notes">) {
  return [trade.pre_trade_thesis, trade.management_notes, trade.note, trade.post_exit_notes].map((part) => part.trim()).filter(Boolean).join("\n");
}

/**
 * Score a newly added spoke on past trades from their own text, so old and new shapes stay comparable.
 * Only the new spoke is scored; trades where the trader set it by hand, or whose text does not speak to
 * it, are left alone (unknown). The capture time of old text is not known, so `captured_at` is null.
 */
export function rescoreForNewSpoke(
  trades: TradeRecord[],
  records: MoodRecord[],
  registry: MoodSpokeRegistry,
  spokeId: string,
  meta: { now: string; makeId: (trade: TradeRecord) => string; textFor?: (trade: TradeRecord) => string },
): MoodRecord[] {
  if (!spokeById(registry, spokeId)) return [];
  const textFor = meta.textFor ?? moodSourceText;
  return trades.flatMap((trade) => {
    if (userSetSpokes(trade.id, records).has(spokeId)) return [];
    const text = textFor(trade);
    if (!text) return [];
    const suggestion = suggestMoodFromText(text, registry, { trade_id: trade.id, now: meta.now, captured_at: null });
    const value = suggestion.scores[spokeId];
    if (value == null) return [];
    return [{
      id: meta.makeId(trade),
      trade_id: trade.id,
      spoke_set_version: registry.version,
      scores: { [spokeId]: value },
      evidence: { [spokeId]: suggestion.evidence[spokeId] },
      source: "voice_ai" as const,
      model: suggestion.model,
      captured_at: null,
      created_at: meta.now,
    }];
  });
}

/** Validate stored records from device storage or a backup. Bad rows are dropped, never repaired by guessing. */
export function sanitizeMoodRecords(raw: unknown): MoodRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): MoodRecord[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Partial<MoodRecord>;
    if (typeof record.id !== "string" || typeof record.trade_id !== "string" || typeof record.created_at !== "string") return [];
    if (record.source !== "user" && record.source !== "voice_ai") return [];
    if (typeof record.spoke_set_version !== "number" || !record.scores || typeof record.scores !== "object") return [];
    const scores: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(record.scores)) {
      if (value === null && record.source === "user") scores[key] = null;
      else if (typeof value === "number" && Number.isFinite(value)) scores[key] = clampScore(value);
    }
    const evidence: Record<string, string> = {};
    if (record.evidence && typeof record.evidence === "object") {
      for (const [key, value] of Object.entries(record.evidence)) if (typeof value === "string") evidence[key] = value;
    }
    return [{
      id: record.id,
      trade_id: record.trade_id,
      spoke_set_version: record.spoke_set_version,
      scores,
      evidence,
      source: record.source,
      model: typeof record.model === "string" ? record.model : null,
      captured_at: typeof record.captured_at === "string" ? record.captured_at : null,
      created_at: record.created_at,
    }];
  });
}

export function sanitizeRegistry(raw: unknown): MoodSpokeRegistry {
  if (!raw || typeof raw !== "object") return DEFAULT_MOOD_REGISTRY;
  const input = raw as Partial<MoodSpokeRegistry>;
  if (typeof input.version !== "number" || !Array.isArray(input.spokes)) return DEFAULT_MOOD_REGISTRY;
  const spokes = input.spokes.filter((spoke): spoke is MoodSpoke => !!spoke && typeof spoke.id === "string" && typeof spoke.label === "string" && typeof spoke.short === "string" && typeof spoke.added_in_version === "number");
  // The starting spokes are always present, so a damaged file can never drop one.
  const missing = DEFAULT_MOOD_REGISTRY.spokes.filter((spoke) => !spokes.some((item) => item.id === spoke.id));
  return { version: Math.max(input.version, DEFAULT_MOOD_REGISTRY.version), spokes: [...missing, ...spokes] };
}
