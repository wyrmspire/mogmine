// Pure planning-session model (PS-1, docs/24 §2, proposal OD-51).
// Local-first per docs/22: planning sessions are stored in `mogmine-plans-v1`.
// Every record has `user_id` (Invariant 7).
// Edits after `anchor_time_utc` are marked after the fact, so reviews never treat them as
// a plan that existed before the trade (docs/24 §2, LV-15).

import { specFor, toTicks } from "./trades.ts";

export type PlanPreset =
  | "pre_globex"
  | "pre_market"
  | "pre_power_hour"
  | "pre_moc"
  | "pre_gap_fill";

export interface PlanPresetSpec {
  preset: PlanPreset;
  name: string;
  /** Clock target in Central Time (CT), or null for event-based presets. */
  beforeCt: string | null;
  /** Typical anchor hour in America/Chicago (CT). */
  anchorHourCt: number | null;
  anchorMinuteCt: number | null;
  notes: string;
}

export const PLAN_PRESETS: readonly PlanPresetSpec[] = [
  {
    preset: "pre_globex",
    name: "Pre-Globex",
    beforeCt: "17:00",
    anchorHourCt: 17,
    anchorMinuteCt: 0,
    notes: "Opens the next session_date (B-20)",
  },
  {
    preset: "pre_market",
    name: "Pre-market (New York)",
    beforeCt: "08:30",
    anchorHourCt: 8,
    anchorMinuteCt: 30,
    notes: "The main markup of 12 §1",
  },
  {
    preset: "pre_power_hour",
    name: "Pre-power hour",
    beforeCt: "14:00",
    anchorHourCt: 14,
    anchorMinuteCt: 0,
    notes: "Heading into final hour",
  },
  {
    preset: "pre_moc",
    name: "Pre-MOC",
    beforeCt: "14:50",
    anchorHourCt: 14,
    anchorMinuteCt: 50,
    notes: "MOC imbalances publish at 15:50 ET",
  },
  {
    preset: "pre_gap_fill",
    name: "Pre-gap fill",
    beforeCt: null,
    anchorHourCt: null,
    anchorMinuteCt: null,
    notes: "Event, not a clock time. No anchor time",
  },
];

export function planPresetSpec(preset: string): PlanPresetSpec | null {
  return PLAN_PRESETS.find((p) => p.preset === preset) ?? null;
}

export type PlannedLevelKind = "level" | "zone_low" | "zone_high";

export interface PlannedLevel {
  id: string;
  price_ticks: number;
  price: number;
  label: string;
  kind: PlannedLevelKind;
  note?: string;
}

export interface PlanRevision {
  id: string;
  saved_at: string; // ISO UTC
  after_the_fact: boolean;
  observations: string;
  bias?: "bullish" | "bearish" | "neutral" | null;
  watch_playbook_ids: readonly string[];
  levels: readonly PlannedLevel[];
}

export interface PlanningSession {
  id: string;
  user_id: string;
  session_date: string; // YYYY-MM-DD
  name: string;
  preset: PlanPreset | null;
  /** ISO UTC timestamp representing the planned start/cutoff time. */
  anchor_time_utc: string | null;
  created_at: string; // ISO UTC
  updated_at: string; // ISO UTC
  observations: string;
  bias?: "bullish" | "bearish" | "neutral" | null;
  watch_playbook_ids: readonly string[];
  levels: readonly PlannedLevel[];
  /** Revision history tracking every edit. */
  revisions: readonly PlanRevision[];
  archived?: boolean;
}

export const PLAN_LIMITS = {
  name: 60,
  observations: 4000,
  label: 40,
  note: 200,
  maxLevels: 30,
} as const;

export function isAfterTheFact(savedAtUtc: string, anchorTimeUtc: string | null | undefined): boolean {
  if (!anchorTimeUtc) return false;
  const saved = Date.parse(savedAtUtc);
  const anchor = Date.parse(anchorTimeUtc);
  if (!Number.isFinite(saved) || !Number.isFinite(anchor)) return false;
  return saved > anchor;
}

export function createPlannedLevel(input: {
  id?: string;
  price: number;
  symbol: string;
  label: string;
  kind?: PlannedLevelKind;
  note?: string;
}): PlannedLevel | null {
  const spec = specFor(input.symbol);
  if (!spec || !Number.isFinite(input.price)) return null;
  const ticks = toTicks(input.price, input.symbol);
  if (ticks == null) return null;
  const label = typeof input.label === "string" ? input.label.trim().slice(0, PLAN_LIMITS.label) : "";
  if (!label) return null;
  const kind: PlannedLevelKind =
    input.kind === "zone_low" || input.kind === "zone_high" ? input.kind : "level";
  const note = typeof input.note === "string" ? input.note.trim().slice(0, PLAN_LIMITS.note) : undefined;
  return {
    id: input.id && typeof input.id === "string" ? input.id.trim() : `plv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    price_ticks: ticks,
    price: Number((ticks * spec.tickSize).toFixed(4)),
    label,
    kind,
    ...(note ? { note } : {}),
  };
}
