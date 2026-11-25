// S1 sessionClock (label, v1). Pure clock facts about the decision time of bar i.
// The decision time is the bar's CLOSE (time[i] + 60 s), America/New_York wall clock, from BarSeries.etMinute.
// Reads bar i only, so it cannot look ahead (SL-1 known-at rule, 09 §4.4).

import type { OutputSpec, Skill, SkillContext, SkillMeta, SkillPreflight, SkillResult } from "../types.ts";

export const CLOCK_PHASES = [
  "evening", "overnight", "premarket", "rthOpen", "rthMid", "rthLate", "post",
] as const;
export type ClockPhase = (typeof CLOCK_PHASES)[number];

const MINUTES_PER_DAY = 1440;
const RTH_OPEN_MINUTE = 9 * 60 + 30;
/** The 17:00–18:00 ET halt: a decision time in (17:00, 18:00) has no bar, so there is nothing to decide on. */
const HALT_FROM = 17 * 60 + 1;
const HALT_TO = 18 * 60;

/** Phase start minutes on the decision (close) clock. Each phase runs until the next start. */
const PHASE_STARTS: readonly (readonly [number, ClockPhase])[] = [
  [0, "overnight"],
  [7 * 60, "premarket"],
  [RTH_OPEN_MINUTE, "rthOpen"],
  [10 * 60 + 30, "rthMid"],
  [14 * 60, "rthLate"],
  [16 * 60, "post"],
  [18 * 60, "evening"],
];

const pad = (value: number) => String(value).padStart(2, "0");

/** Every 30-minute ET bucket label, "00:00" … "23:30". */
export const TOD_BUCKETS: readonly string[] = Array.from(
  { length: 48 },
  (_, k) => `${pad(Math.floor((k * 30) / 60))}:${pad((k * 30) % 60)}`,
);

/** Decision (bar close) minute on the ET clock, 0–1439. A bar that closes at 00:00 belongs to overnight. */
export function decisionMinute(series: SkillContext["series"], i: number): number {
  return (series.etMinute[i] + 1) % MINUTES_PER_DAY;
}

/** Phase for a decision minute, or null inside the halt (no bars exist there). */
export function phaseOf(minute: number): ClockPhase | null {
  if (minute >= HALT_FROM && minute < HALT_TO) return null;
  let phase: ClockPhase = "overnight";
  for (const [start, name] of PHASE_STARTS) if (minute >= start) phase = name;
  return phase;
}

/** Minutes from the nearest 09:30 ET open, in (−720, 720]. Negative means before that open. */
export function minutesFromRthOpen(minute: number): number {
  let delta = minute - RTH_OPEN_MINUTE;
  if (delta > MINUTES_PER_DAY / 2) delta -= MINUTES_PER_DAY;
  if (delta <= -MINUTES_PER_DAY / 2) delta += MINUTES_PER_DAY;
  return delta;
}

export function todBucketOf(minute: number): string {
  const bucket = Math.floor(minute / 30) * 30;
  return `${pad(Math.floor(bucket / 60))}:${pad(bucket % 60)}`;
}

const outputs: readonly OutputSpec[] = [
  { key: "phase", type: "category", label: "Session phase (decision time)", categories: CLOCK_PHASES },
  { key: "todBucket", type: "category", label: "Time-of-day bucket (30 min, ET)", categories: TOD_BUCKETS },
  { key: "minutesFromRthOpen", type: "number", label: "Minutes from 09:30 ET open", unit: "minutes" },
];

export const sessionClockMeta: SkillMeta = {
  id: "sessionClock",
  version: "1.0.0",
  kind: "label",
  title: "Session clock",
  description: "Session phase, 30-minute time-of-day bucket and minutes from the RTH open, at the decision time (bar close, ET).",
  status: "active",
  params: [],
  outputs,
  needs: { baseTimeframe: "1m", lookbackMinutes: 0, volume: false },
  knownAt: "bar-close",
  warnings: ["Phases are on the bar-close clock: the 16:59 bar decides at 17:00 and is labelled post."],
};

function preflight(ctx: SkillContext): SkillPreflight {
  if (!Number.isInteger(ctx.i) || ctx.i < 0 || ctx.i >= ctx.series.time.length) {
    return { ok: false, reason: "warmup", detail: "No bar at the decision index" };
  }
  return { ok: true };
}

function compute(ctx: SkillContext): SkillResult {
  const minute = decisionMinute(ctx.series, ctx.i);
  const phase = phaseOf(minute);
  if (phase === null) {
    return { ok: false, reason: "out-of-session", detail: "17:00–18:00 ET halt has no decision bar" };
  }
  return {
    ok: true,
    values: {
      phase,
      todBucket: todBucketOf(minute),
      minutesFromRthOpen: minutesFromRthOpen(minute),
    },
  };
}

export const sessionClockSkill: Skill = { meta: sessionClockMeta, preflight, compute };
