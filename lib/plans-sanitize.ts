// Pure planning-session sanitizers (no React, no window). Split out of lib/plans-store.ts so server routes can import the command layer (#185a).
import { PLAN_LIMITS, PLAN_PRESETS } from "./plans.ts";
import type { PlannedLevel, PlannedLevelKind, PlanningSession, PlanPreset, PlanRevision } from "./plans.ts";
import { DEFAULT_OWNER_USER_ID, specFor } from "./trades.ts";

export const trimText = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isValidSessionDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

export function sanitizePlannedLevel(raw: unknown): PlannedLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const label = trimText(obj.label, PLAN_LIMITS.label);
  const priceTicks = typeof obj.price_ticks === "number" && Number.isSafeInteger(obj.price_ticks) ? obj.price_ticks : null;
  const price = typeof obj.price === "number" && Number.isFinite(obj.price) ? obj.price : null;
  if (!id || !label || priceTicks == null || price == null) return null;

  const kind: PlannedLevelKind =
    obj.kind === "zone_low" || obj.kind === "zone_high" ? obj.kind : "level";
  const note = trimText(obj.note, PLAN_LIMITS.note) || undefined;

  return {
    id,
    price_ticks: priceTicks,
    price,
    label,
    kind,
    ...(note ? { note } : {}),
  };
}

export function sanitizePlanRevision(raw: unknown): PlanRevision | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const savedAt = isValidIsoDate(obj.saved_at) ? obj.saved_at : null;
  if (!id || !savedAt) return null;

  const afterTheFact = obj.after_the_fact === true;
  const observations = typeof obj.observations === "string" ? obj.observations.slice(0, PLAN_LIMITS.observations) : "";
  const bias = obj.bias === "bullish" || obj.bias === "bearish" || obj.bias === "neutral" ? obj.bias : null;
  const watchPlaybookIds = Array.isArray(obj.watch_playbook_ids)
    ? obj.watch_playbook_ids.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  const rawLevels = Array.isArray(obj.levels) ? obj.levels : [];
  const levels: PlannedLevel[] = [];
  for (const item of rawLevels) {
    const level = sanitizePlannedLevel(item);
    if (level) levels.push(level);
    if (levels.length >= PLAN_LIMITS.maxLevels) break;
  }

  return {
    id,
    saved_at: savedAt,
    after_the_fact: afterTheFact,
    observations,
    bias,
    watch_playbook_ids: watchPlaybookIds,
    levels,
  };
}

export function sanitizePlanningSession(raw: unknown): PlanningSession | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === "string" ? obj.id.trim() : "";
  const sessionDateStr = isValidSessionDate(obj.session_date) ? obj.session_date : null;
  const name = trimText(obj.name, PLAN_LIMITS.name);
  if (!id || !sessionDateStr || !name) return null;

  const userId = typeof obj.user_id === "string" && obj.user_id.trim() ? obj.user_id.trim() : DEFAULT_OWNER_USER_ID;
  const preset: PlanPreset | null = PLAN_PRESETS.some((p) => p.preset === obj.preset)
    ? (obj.preset as PlanPreset)
    : null;
  const anchorTimeUtc = isValidIsoDate(obj.anchor_time_utc) ? obj.anchor_time_utc : null;
  const createdAt = isValidIsoDate(obj.created_at) ? obj.created_at : new Date().toISOString();
  const updatedAt = isValidIsoDate(obj.updated_at) ? obj.updated_at : createdAt;

  const observations = typeof obj.observations === "string" ? obj.observations.slice(0, PLAN_LIMITS.observations) : "";
  const bias = obj.bias === "bullish" || obj.bias === "bearish" || obj.bias === "neutral" ? obj.bias : null;
  const watchPlaybookIds = Array.isArray(obj.watch_playbook_ids)
    ? obj.watch_playbook_ids.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : [];

  const rawLevels = Array.isArray(obj.levels) ? obj.levels : [];
  const levels: PlannedLevel[] = [];
  for (const item of rawLevels) {
    const level = sanitizePlannedLevel(item);
    if (level) levels.push(level);
    if (levels.length >= PLAN_LIMITS.maxLevels) break;
  }

  const rawRevisions = Array.isArray(obj.revisions) ? obj.revisions : [];
  const revisions: PlanRevision[] = [];
  for (const item of rawRevisions) {
    const rev = sanitizePlanRevision(item);
    if (rev) revisions.push(rev);
  }

  const symbol = typeof obj.symbol === "string" && specFor(obj.symbol.trim()) ? obj.symbol.trim().toUpperCase() : undefined;

  return {
    id,
    user_id: userId,
    session_date: sessionDateStr,
    ...(symbol ? { symbol } : {}),
    name,
    preset,
    anchor_time_utc: anchorTimeUtc,
    created_at: createdAt,
    updated_at: updatedAt,
    observations,
    bias,
    watch_playbook_ids: watchPlaybookIds,
    levels,
    revisions,
    archived: obj.archived === true,
    ...(typeof obj.lesson === "string" && obj.lesson.trim() ? { lesson: obj.lesson.slice(0, PLAN_LIMITS.lesson) } : {}),
  };
}

export function sanitizePlans(raw: unknown): PlanningSession[] {
  if (!Array.isArray(raw)) return [];
  const list: PlanningSession[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const plan = sanitizePlanningSession(item);
    if (!plan || seen.has(plan.id)) continue;
    seen.add(plan.id);
    list.push(plan);
  }
  return list;
}

export function sanitizePlansBackup(raw: unknown): PlanningSession[] | null {
  if (!raw) return null;
  const sanitized = sanitizePlans(raw);
  return sanitized.length > 0 ? sanitized : null;
}
