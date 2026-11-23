// Pure drill sanitizers (no React, no window). Split out of lib/drills-store.ts so server routes can import the command layer (#185a).
import type { DrillAnswer, DrillKind, DrillRecord } from "./drills.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";

const KINDS: readonly DrillKind[] = ["take_it"];
const ANSWERS: readonly DrillAnswer[] = ["take", "smaller", "pass"];

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function sanitizeDrillRecord(raw: unknown): DrillRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const id = text(obj.id);
  const tradeId = text(obj.trade_id);
  const answeredAt = text(obj.answered_at);
  if (!id || !tradeId || !Number.isFinite(Date.parse(answeredAt))) return null;
  if (!KINDS.includes(obj.kind as DrillKind) || !ANSWERS.includes(obj.answer as DrillAnswer)) return null;
  return {
    id,
    user_id: text(obj.user_id) || DEFAULT_OWNER_USER_ID,
    trade_id: tradeId,
    kind: obj.kind as DrillKind,
    answer: obj.answer as DrillAnswer,
    answered_at: new Date(Date.parse(answeredAt)).toISOString(),
    hidden: Array.isArray(obj.hidden) ? obj.hidden.filter((item): item is string => typeof item === "string" && item.length > 0) : [],
  };
}

/** Clean records, one per id (the first wins), oldest first. */
export function sanitizeDrills(raw: unknown): DrillRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: DrillRecord[] = [];
  for (const item of raw) {
    const record = sanitizeDrillRecord(item);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    list.push(record);
  }
  return list.sort((a, b) => Date.parse(a.answered_at) - Date.parse(b.answered_at));
}

/** A backup's drills, or null when it has none: an older backup leaves this device's answers alone. */
export function sanitizeDrillsBackup(raw: unknown): DrillRecord[] | null {
  const list = sanitizeDrills(raw);
  return list.length ? list : null;
}
