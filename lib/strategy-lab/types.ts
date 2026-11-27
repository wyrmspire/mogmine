/** Frozen domain contracts for the Strategy Lab. Pure: no I/O and no DOM. */

export type OutputType = "number" | "category" | "boolean";
export type Unit = "points" | "ticks" | "usd" | "r" | "ratio" | "pct" | "contracts" | "minutes" | "bars";
export type SkillStatus = "active" | "degraded" | "experimental";
export type SkillKind = "feature" | "label" | "measure";
export type SkipReason =
  | "needs-1m"
  | "coverage"
  | "volume-missing"
  | "warmup"
  | "no-level"
  | "not-known-yet"
  | "out-of-session"
  | "bad-params";

export type Value = number | string | boolean | null;
export type BaseTimeframe = "1m" | "5m" | "1h";

export interface OutputSpec {
  key: string;
  type: OutputType;
  label: string;
  unit?: Unit;
  categories?: readonly string[];
  buckets?: readonly number[];
}

export interface ParamSpec {
  key: string;
  type: "number" | "integer" | "enum" | "boolean";
  default: number | string | boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
  label: string;
}

export interface SkillMeta {
  id: string;
  version: string;
  kind: SkillKind;
  title: string;
  description: string;
  status: SkillStatus;
  proxy?: boolean;
  params: readonly ParamSpec[];
  outputs: readonly OutputSpec[];
  needs: {
    baseTimeframe: "1m";
    lookbackMinutes: number;
    priorSessions?: number;
    volume: boolean;
  };
  knownAt: "bar-close" | "after-entry";
  warnings?: readonly string[];
}

export interface SourceBar {
  /** Bar-open time in UTC milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Zero, null and non-finite volume all mean missing. */
  volume?: number | null;
}

export interface SessionInfo {
  date: string;
  open: number;
  close: number;
  expectedBars: number;
  presentBars: number;
  volumeMissing: number;
  baseTimeframe: BaseTimeframe;
  droppedInvalid: number;
  droppedDuplicates: number;
  excluded?: { reason: string };
}

export interface BarSeries {
  symbol: string;
  barMs: 60_000;
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  /** NaN means missing; Yahoo volume zero is never treated as activity. */
  volume: Float64Array;
  sessionDate: string[];
  /** Bar-open minute since midnight in America/New_York. */
  etMinute: Uint16Array;
  sessionStart: Int32Array;
  byTime: Map<number, number>;
  sessions: SessionInfo[];
  dropped: { invalid: number; duplicates: number };
}

export interface AggregatedBar {
  minutes: number;
  startTime: number;
  endTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** NaN when any present source bar has missing volume. */
  volume: number;
  expected: number;
  present: number;
  volumeMissing: number;
  forming: boolean;
}

export type LevelKey =
  | "pdh" | "pdl" | "pdc" | "onh" | "onl" | "rth_open"
  | "week_high" | "week_low" | "vwap_globex" | "vwap_rth"
  | "or_high" | "or_low" | "or_mid";

export interface LabLevel {
  key: LevelKey;
  value: number;
  availableAt: number;
  label?: string;
  approx?: boolean;
}

export interface LevelBook {
  asOf: number;
  levels: readonly LabLevel[];
  byKey: ReadonlyMap<LevelKey, LabLevel>;
}

export interface SkillContext {
  series: BarSeries;
  i: number;
  params: Record<string, Value>;
  spec: { symbol: string; tickSize: number; pointValueUsd: number };
  /** Fixed account R size, never inferred from stop width. */
  rSizeUsd: number;
  /** Contains only levels whose availableAt is no later than the decision time. */
  levels: LevelBook;
  mark?: { price: number; side: "long" | "short" };
}

export type SkillResult =
  | { ok: true; values: Record<string, Value>; notes?: string[] }
  | { ok: false; reason: SkipReason; detail: string };

export type SkillPreflight = { ok: true } | { ok: false; reason: SkipReason; detail: string };

export interface Skill {
  meta: SkillMeta;
  /** Cheap presence/parameter check. Feature and label skills never inspect bars after i. */
  preflight(ctx: SkillContext): SkillPreflight;
  /** Pure and deterministic. Measures alone may inspect (i, i + hold]. */
  compute(ctx: SkillContext): SkillResult;
}

export type ConditionOp =
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "between" | "in" | "crossesAbove" | "crossesBelow";

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | {
    skill: string;
    params?: Record<string, Value>;
    out: string;
    op: ConditionOp;
    value: Value | Value[];
  };

export interface SkillOutputRef {
  skill: string;
  params?: Record<string, Value>;
  out: string;
}

export interface Recipe {
  schema: "mogmine.strategy-recipe.v1";
  id: string;
  version: number;
  name: string;
  notes?: string;
  playbookId: string | null;
  symbol: "MES";
  side: "long" | "short";
  window: {
    startEt: string;
    endEt: string;
    days?: ("Mon" | "Tue" | "Wed" | "Thu" | "Fri")[];
  };
  trigger: Condition;
  entry: { at: "trigger-close" };
  stop:
    | { type: "points"; points: number }
    | { type: "beyond-swing"; ticks: number; lookbackBars: number; maxPoints: number };
  target:
    | { type: "points"; points: number }
    | { type: "rr"; multiple: number }
    | { type: "level"; level: LevelKey; fallbackPoints: number };
  maxHoldMinutes: number;
  flatAtEt?: string;
  sizing: { mode: "risk-r"; riskR: number } | { mode: "contracts"; qty: number };
  account: { accountId: string | null };
  slippageTicks: { stop: number; market: number };
  dedupe: { maxPerSession: number; cooldownMinutes: number; oneAtATime: boolean };
  sliceBy: SkillOutputRef[];
  measure: { levelReach?: LevelKey[]; forwardMinutes?: number[] };
}

export type OutcomeExitReason = "target" | "stop" | "time" | "session-end" | "ambiguous-stop";

export interface Outcome {
  exitReason: OutcomeExitReason;
  exitTime: number;
  pnlPoints: number;
  pnlUsd: number;
  resultR: number;
  riskMultiple: number;
  mfePoints: number;
  maePoints: number;
  mfeR: number;
  maeR: number;
  minutesToExit: number;
  minutesToTarget: number | null;
}

export interface Match {
  i: number;
  time: number;
  sessionDate: string;
  entry: number;
  stop: number;
  target: number;
  qty: number;
  oversized: boolean;
  features: Record<string, Value>;
  outcome: Outcome;
}

export interface OverlayRow {
  tradeId: string;
  time: number;
  fits: boolean;
  realResultR: number | null;
  simulated: Outcome | null;
  conditions: readonly { path: string; passed: boolean; actual: Value }[];
  features: Record<string, Value>;
}

export interface Distribution {
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

export interface Stats {
  n: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;
  winRate95: readonly [number, number] | null;
  avgR: number | null;
  medianR: number | null;
  totalR: number;
  avgPoints: number | null;
  medianPoints: number | null;
  profitFactor: number | null;
  exits: Partial<Record<OutcomeExitReason, number>>;
  mfePoints: Distribution;
  maePoints: Distribution;
  mfeR: Distribution;
  maeR: Distribution;
  medianMinutesToTarget: number | null;
}

export interface SplitBucket {
  key: string;
  label: string;
  n: number;
  wins: number;
  winRate: number | null;
  winRate95: readonly [number, number] | null;
  avgR: number | null;
  shrunkAvgR: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
  thin: boolean;
}

export interface Split {
  ref: SkillOutputRef;
  buckets: SplitBucket[];
}

export interface Separator {
  ref: SkillOutputRef;
  best: string;
  worst: string;
  gapR: number;
  winRateGap: number | null;
  clarity: "clear" | "suggestive";
  stability: "stable" | "unstable";
  thin: boolean;
}

export interface TodCell {
  bucket: string;
  n: number;
  wins: number;
  winRate: number | null;
  avgR: number | null;
}

export interface RunResult {
  recipe: { id: string; version: number };
  data: {
    sessionsRequested: number;
    sessionsUsed: string[];
    excluded: { date: string; reason: string }[];
    barsMissing: number;
    volumeMissing: number;
    rSize: { usd: number; source: string };
    /** Added after the first persisted-run schema; absent only on legacy/in-memory fixtures. */
    research?: ResearchGovernance;
  };
  candidates: number;
  skips: Record<string, Partial<Record<SkipReason, number>>>;
  matches: Match[];
  overlays: OverlayRow[];
  stats: Stats;
  splits: Split[];
  separators: Separator[];
  timeOfDay: TodCell[];
  ms: number;
}

export interface ResearchGovernance {
  mode: "discovery" | "validation";
  /** Derived from the executed recipe rather than supplied by the caller. */
  conditionsSearched: string[];
  variantsSearched: string[];
  independentSessionCount: number;
  recipeHash: string;
  source: string | null;
  roll: string | null;
  /** Exploratory runs must never be presented as held-out validation. */
  heldOut: boolean;
  /** Cumulative executions of this recipe family, including the current run. */
  trialCount?: number;
  /** Explicit split boundaries. Empty only for legacy discovery runs. */
  discoverySessions?: string[];
  validationSessions?: string[];
}
