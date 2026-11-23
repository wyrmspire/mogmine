// Pure discretionary-call sanitizers (no React, no window). Split out of lib/calls-store.ts so server routes can import the command layer (#185a).
import { CALL_ORIGINS, DEVIATION_KINDS, REASON_FAMILIES, REASON_LABEL_MAX, callKindSpec } from "./calls.ts";
import type { CallKind, CallOrigin, CallRule, CallTrigger, DeviationKind, DiscretionCall, FrozenReason, PromptDismissal, ReasonFamily } from "./calls.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";
import type { TradeDirection } from "./trades.ts";

export interface CallsBackup {
  calls: DiscretionCall[];
  dismissals: PromptDismissal[];
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const idOrNull = (value: unknown) => text(value) || null;
const iso = (value: unknown) => {
  const time = Date.parse(text(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function sanitizeReason(raw: unknown): FrozenReason | null {
  const obj = record(raw);
  const id = text(obj?.id);
  const label = text(obj?.label);
  if (!obj || !id || !label || label.length > REASON_LABEL_MAX) return null;
  return { id, label, family: REASON_FAMILIES.includes(obj.family as ReasonFamily) ? (obj.family as ReasonFamily) : "other" };
}

function sanitizeTrigger(raw: unknown): CallTrigger | null {
  const obj = record(raw);
  if (!obj || !DEVIATION_KINDS.includes(obj.deviation as DeviationKind)) return null;
  const basis = obj.basis === "broker" || obj.basis === "recorded" || obj.basis === "inferred" ? obj.basis : "recorded";
  return { deviation: obj.deviation as DeviationKind, basis };
}

function sanitizeRule(raw: unknown): CallRule | null {
  const obj = record(raw);
  const id = text(obj?.id);
  const label = text(obj?.label);
  if (!obj || !id || !label || (obj.verdict !== "applied" && obj.verdict !== "not_applied")) return null;
  return { id, label, verdict: obj.verdict };
}

/**
 * A stored call, cleaned. Structural checks only: a reason chip the library no longer offers stays,
 * because calls freeze their reasons (DC-1b). Null when the record cannot be read at all.
 */
export function sanitizeCall(raw: unknown): DiscretionCall | null {
  const obj = record(raw);
  if (!obj) return null;
  const id = text(obj.id);
  const spec = callKindSpec(text(obj.kind));
  const made = iso(obj.made_at);
  const recorded = iso(obj.recorded_at);
  if (!id || !spec || !made || !recorded) return null;
  const tradeId = idOrNull(obj.trade_id);
  // The kind's trade rule is structural: a Skip with a trade or a Cut without one is not a call of that kind.
  if ((spec.trade === "required" && !tradeId) || (spec.trade === "forbidden" && tradeId)) return null;
  const price = typeof obj.price === "number" && Number.isFinite(obj.price) ? obj.price : null;
  const ticks = typeof obj.price_ticks === "number" && Number.isInteger(obj.price_ticks) ? obj.price_ticks : null;
  const direction = obj.signal_direction === "LONG" || obj.signal_direction === "SHORT" ? (obj.signal_direction as TradeDirection) : null;
  if (spec.kind === "flip" && !direction) return null;
  const seen = new Set<string>();
  const reasons = (Array.isArray(obj.reasons) ? obj.reasons : []).flatMap((item) => {
    const reason = sanitizeReason(item);
    if (!reason || seen.has(reason.id)) return [];
    seen.add(reason.id);
    return [reason];
  });
  return {
    id,
    user_id: text(obj.user_id) || DEFAULT_OWNER_USER_ID,
    kind: spec.kind as CallKind,
    made_at: made,
    recorded_at: recorded,
    trade_id: tradeId,
    plan_session_id: idOrNull(obj.plan_session_id),
    playbook_id: idOrNull(obj.playbook_id),
    // Price and ticks go together, or neither is kept.
    price: price != null && ticks != null ? price : null,
    price_ticks: price != null && ticks != null ? ticks : null,
    signal_direction: direction,
    reasons,
    note: typeof obj.note === "string" ? obj.note : "",
    conviction: obj.conviction === 1 || obj.conviction === 2 || obj.conviction === 3 ? obj.conviction : null,
    prompt_id: idOrNull(obj.prompt_id),
    prompt_question: typeof obj.prompt_question === "string" ? obj.prompt_question : spec.prompt,
    origin: CALL_ORIGINS.includes(obj.origin as CallOrigin) ? (obj.origin as CallOrigin) : "manual",
    trigger: sanitizeTrigger(obj.trigger),
    rule: sanitizeRule(obj.rule),
    made_at_basis: obj.made_at_basis === "bound" ? "bound" : "exact",
  };
}

export function sanitizeDismissal(raw: unknown): PromptDismissal | null {
  const obj = record(raw);
  if (!obj) return null;
  const id = text(obj.id);
  const tradeId = text(obj.trade_id);
  const promptId = text(obj.prompt_id);
  const recorded = iso(obj.recorded_at);
  if (!id || !tradeId || !promptId || !recorded || (obj.reason !== "not_a_call" && obj.reason !== "later")) return null;
  return {
    id,
    user_id: text(obj.user_id) || DEFAULT_OWNER_USER_ID,
    trade_id: tradeId,
    prompt_id: promptId,
    deviation: DEVIATION_KINDS.includes(obj.deviation as DeviationKind) ? (obj.deviation as DeviationKind) : null,
    reason: obj.reason,
    recorded_at: recorded,
  };
}

/** Clean, one per id (the first wins), oldest decision first. */
export function cleanList<T extends { id: string }>(raw: unknown, sanitize: (item: unknown) => T | null, time: (item: T) => string): T[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: T[] = [];
  for (const item of raw) {
    const clean = sanitize(item);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    list.push(clean);
  }
  return list.sort((a, b) => Date.parse(time(a)) - Date.parse(time(b)));
}

export function sanitizeCalls(raw: unknown): CallsBackup {
  const obj = record(raw);
  return {
    calls: cleanList(obj?.calls, sanitizeCall, (call) => call.made_at),
    dismissals: cleanList(obj?.dismissals, sanitizeDismissal, (item) => item.recorded_at),
  };
}

/** A backup's calls, or null when it has none: an older backup leaves this device's calls alone. */
export function sanitizeCallsBackup(raw: unknown): CallsBackup | null {
  const clean = sanitizeCalls(raw);
  return clean.calls.length || clean.dismissals.length ? clean : null;
}
