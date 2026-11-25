// #185a: HTTP shapes for the agent API (docs/26 §6). Pure: no Next, no SDK. Every response is JSON:
// `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Never a cause, stack or SQL (the contract's
// `cause` is for logs only).
import { RECORD_CONTRACTS } from "../persistence/registry.ts";
import type { CollectionKey, ListQuery, PersistErrorCode, SingletonKey } from "../persistence/contract.ts";
import type { AgentListFilters } from "../commands/journal-commands.ts";

/**
 * A list query: the `ListQuery` plus the optional filters and `include=derived` (see `parseListQuery`). `filterError` is set
 * when a filter is malformed; the route then answers 422.
 */
export type AgentListQuery = ListQuery & {
  filters?: AgentListFilters;
  includeDerived?: true;
  filterError?: string;
};

export type AgentErrorCode = PersistErrorCode | "rate_limited";

const STATUS: Record<AgentErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  invalid: 422,
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
  unknown: 500,
  rate_limited: 429,
};

export function statusFor(code: AgentErrorCode): number {
  return STATUS[code];
}

export interface AgentResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** An error with an explicit status (for the few cases the code map does not cover: 400, 413). */
export function agentFail(status: number, code: AgentErrorCode, message: string, headers: Record<string, string> = {}): AgentResponse {
  return { status, body: { ok: false, error: { code, message } }, headers };
}

export function agentError(code: AgentErrorCode, message: string, headers: Record<string, string> = {}): AgentResponse {
  return agentFail(statusFor(code), code, message, headers);
}

export function agentOk(data: unknown, status = 200): AgentResponse {
  return { status, body: { ok: true, data }, headers: {} };
}

export interface RateLimiter {
  take(key: string): { ok: true } | { ok: false; retryAfterSec: number };
}

/**
 * Sliding window per key, in memory. Best effort: every server instance keeps its own counts, so a burst spread
 * across instances can exceed the limit. Blocked requests are not recorded, so a client that keeps trying does not
 * extend its own block.
 */
export function createRateLimiter(options: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();
  let takes = 0;
  return {
    take(key) {
      const at = now();
      const cutoff = at - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= options.limit) {
        hits.set(key, recent);
        const retryAfterSec = Math.max(1, Math.ceil((recent[0] + options.windowMs - at) / 1000));
        return { ok: false, retryAfterSec };
      }
      recent.push(at);
      hits.set(key, recent);
      takes += 1;
      if (takes % 1000 === 0) {
        for (const [name, times] of hits) {
          if (!times.some((time) => time > cutoff)) hits.delete(name);
        }
      }
      return { ok: true };
    },
  };
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** `YYYY-MM-DD` that is a real calendar date (2026-02-30 is not). */
export function isSessionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** An ISO-8601 date-time that names its zone. Without one the server would guess the zone, so it is refused. */
export function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

/** `include=derived` (comma-separated values are allowed). Anything else is ignored. */
export function parseIncludeDerived(searchParams: URLSearchParams): boolean {
  return (searchParams.get("include") ?? "").split(",").map((part) => part.trim()).includes("derived");
}

/**
 * The collection filters (`session_date`, `from`, `to`, `account_id`, `playbook_id`). A blank value counts as absent.
 * A malformed date or time gives `error` (the route answers 422). Returns no `filters` when none is set.
 */
export function parseAgentListFilters(searchParams: URLSearchParams): { filters?: AgentListFilters; error?: string } {
  const filters: AgentListFilters = {};
  const read = (name: string): string | undefined => {
    const value = searchParams.get(name)?.trim();
    return value ? value : undefined;
  };
  const sessionDate = read("session_date");
  const from = read("from");
  const to = read("to");
  const accountId = read("account_id");
  const playbookId = read("playbook_id");
  if (sessionDate !== undefined) {
    if (!isSessionDate(sessionDate)) return { error: "session_date must be a real date as YYYY-MM-DD, such as 2026-11-23." };
    filters.session_date = sessionDate;
  }
  if (from !== undefined) {
    if (!isIsoTimestamp(from)) return { error: "from must be an ISO-8601 time with a zone, such as 2026-11-23T14:00:00Z." };
    filters.from = from;
  }
  if (to !== undefined) {
    if (!isIsoTimestamp(to)) return { error: "to must be an ISO-8601 time with a zone, such as 2026-11-23T20:00:00Z." };
    filters.to = to;
  }
  if (from !== undefined && to !== undefined && Date.parse(from) > Date.parse(to)) return { error: "from must not be after to." };
  if (accountId !== undefined) filters.account_id = accountId;
  if (playbookId !== undefined) filters.playbook_id = playbookId;
  return Object.keys(filters).length > 0 ? { filters } : {};
}

/**
 * Query string to `AgentListQuery`. Samples and archived rows are hidden unless the caller asks for them: a missing or
 * junk flag is `false`, never `undefined`. (11/23 regression: `undefined` skipped the archived filter, so archived
 * accounts leaked into default API lists.) `limit` clamps to 1–500 (junk = 100). The filters and `include=derived`
 * are added only when asked for, so a plain list keeps the plain shape.
 */
export function parseListQuery(searchParams: URLSearchParams): AgentListQuery {
  const flag = (name: string): boolean => searchParams.get(name) === "true";
  const raw = searchParams.get("limit");
  const parsed = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const limit = Number.isFinite(parsed) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed))) : DEFAULT_LIMIT;
  const parentId = searchParams.get("parentId");
  const query: AgentListQuery = {
    includeSamples: flag("includeSamples"),
    includeArchived: flag("includeArchived"),
    parentId: parentId ? parentId : undefined,
    limit,
  };
  const { filters, error } = parseAgentListFilters(searchParams);
  if (filters) query.filters = filters;
  if (error) query.filterError = error;
  if (parseIncludeDerived(searchParams)) query.includeDerived = true;
  return query;
}

/** Collections the API exposes: every v1 record type with many rows per owner (read from the registry). */
export const COLLECTION_KEYS: readonly CollectionKey[] = RECORD_CONTRACTS
  .filter((entry) => entry.readiness === "v1" && entry.key !== "prefs" && entry.key !== "mood_registry" && entry.key !== "tag_registry")
  .map((entry) => entry.key as CollectionKey);

/** Singletons the API exposes. `prompt_library` is deferred and memory-only (docs/26 §4), so it is not exposed. */
export const SINGLETON_KEYS: readonly SingletonKey[] = RECORD_CONTRACTS
  .filter((entry) => entry.readiness === "v1" && (entry.key === "prefs" || entry.key === "mood_registry" || entry.key === "tag_registry"))
  .map((entry) => entry.key as SingletonKey);

export function isCollectionKey(value: string): value is CollectionKey {
  return (COLLECTION_KEYS as readonly string[]).includes(value);
}

export function isSingletonKey(value: string): value is SingletonKey {
  return (SINGLETON_KEYS as readonly string[]).includes(value);
}

/** A dynamic segment decoded once. Ids may contain `:` (for example `seed:cut`). Null for a malformed escape. */
export function decodeRouteParam(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
