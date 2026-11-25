// Pure challenge sanitizers and validators (no React, no window). Split out of lib/challenge-store.ts so server routes can import the command layer (#185a).
import { CHALLENGE_CALC_VERSION } from "./challenges.ts";
import type { ChallengeDefinition, ChallengeResult, ChallengeRules } from "./challenges.ts";
import { DEFAULT_OWNER_USER_ID } from "./trades.ts";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isSafeInteger(value) && value > 0;
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function sanitizeChallengeRules(raw: unknown): ChallengeRules | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind === "drawdown") {
    if (!isPositiveInteger(obj.sessions) || obj.sessions > 60 || !isPositiveInteger(obj.max_drawdown_cents)) {
      return null;
    }
    return {
      kind: "drawdown",
      sessions: obj.sessions,
      max_drawdown_cents: obj.max_drawdown_cents,
    };
  }
  if (obj.kind === "clean_run") {
    if (!isPositiveInteger(obj.target_trades) || obj.target_trades < 3 || obj.target_trades > 50 || !Array.isArray(obj.playbook_ids)) {
      return null;
    }
    const playbook_ids = obj.playbook_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
    return {
      kind: "clean_run",
      target_trades: obj.target_trades,
      playbook_ids,
    };
  }
  return null;
}

export function sanitizeChallengeResult(raw: unknown): ChallengeResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.state !== "active" && obj.state !== "passed" && obj.state !== "failed") return undefined;
  if (typeof obj.provisional !== "boolean") return undefined;
  if (!Array.isArray(obj.issues) || !Array.isArray(obj.points)) return undefined;

  if (obj.decided_by !== null && typeof obj.decided_by !== "string") return undefined;
  if (!isFiniteNumber(obj.excluded_before_start)) return undefined;
  if (!obj.issues.every((issue) => issue && typeof issue.trade_id === "string"
    && ["open", "unpriceable", "ungraded", "undated"].includes(issue.reason))) return undefined;
  if (!obj.points.every((point) => point && typeof point.trade_id === "string"
    && isFiniteNumber(point.closed_at) && typeof point.session === "string"
    && (point.read === undefined || ["clean", "broken", "off_plan"].includes(point.read))
    && ["equity_cents", "peak_cents", "drawdown_cents", "run"].every((key) =>
      point[key] === undefined || isFiniteNumber(point[key])))) return undefined;
  if (!["equity_cents", "peak_cents", "drawdown_cents", "max_drawdown_cents",
    "remaining_cents", "sessions_done", "run", "best_run"].every((key) =>
    obj[key] === undefined || isFiniteNumber(obj[key]))) return undefined;
  return structuredClone(obj) as unknown as ChallengeResult;
}

export function sanitizeChallenge(raw: unknown): ChallengeDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || !obj.id.trim()) return null;
  const rules = sanitizeChallengeRules(obj.rules);
  if (!rules) return null;
  if (!isValidTime(obj.started_at)) return null;
  const ended_at = obj.ended_at;
  if (ended_at !== null && (!isValidTime(ended_at) || Date.parse(ended_at) < Date.parse(obj.started_at))) return null;
  const calc_version = isFiniteNumber(obj.calc_version) ? obj.calc_version : CHALLENGE_CALC_VERSION;
  const user_id = typeof obj.user_id === "string" && obj.user_id.trim() ? obj.user_id : DEFAULT_OWNER_USER_ID;

  // Legacy records have no account scope: they keep counting every account (UX-08).
  const account_id = typeof obj.account_id === "string" && obj.account_id.trim() ? obj.account_id : null;

  const def: ChallengeDefinition = {
    id: obj.id,
    user_id,
    account_id,
    rules,
    started_at: obj.started_at,
    ended_at,
    calc_version,
  };

  const final = sanitizeChallengeResult(obj.final);
  if (ended_at && final) {
    def.final = final;
  }

  return def;
}

export function sanitizeChallenges(raw: unknown): ChallengeDefinition[] {
  if (!Array.isArray(raw)) return [];
  const list: ChallengeDefinition[] = [];
  const seenIds = new Set<string>();
  const activeKinds = new Set<ChallengeRules["kind"]>();

  for (const item of raw) {
    const def = sanitizeChallenge(item);
    if (!def) continue;
    if (seenIds.has(def.id)) continue;
    if (def.ended_at === null) {
      if (activeKinds.has(def.rules.kind)) continue;
      activeKinds.add(def.rules.kind);
    }
    seenIds.add(def.id);
    list.push(def);
  }

  return list;
}

/**
 * Validate challenge list from backup file.
 */
export function sanitizeChallengesBackup(raw: unknown): ChallengeDefinition[] | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) return null;
  return sanitizeChallenges(raw);
}
