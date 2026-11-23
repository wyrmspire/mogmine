// #185a: HTTP shapes for the agent API (docs/26 §6). Pure: no Next, no SDK. Every response is JSON:
// `{ ok: true, data }` or `{ ok: false, error: { code, message } }`. Never a cause, stack or SQL (the contract's
// `cause` is for logs only).
import { RECORD_CONTRACTS } from "../persistence/registry.ts";
import type { CollectionKey, ListQuery, PersistErrorCode, SingletonKey } from "../persistence/contract.ts";

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

/** Query string to `ListQuery`. Booleans parse only for `true` / `false`; `limit` clamps to 1–500 (junk = 100). */
export function parseListQuery(searchParams: URLSearchParams): ListQuery {
  const flag = (name: string): boolean | undefined => {
    const value = searchParams.get(name);
    return value === "true" ? true : value === "false" ? false : undefined;
  };
  const raw = searchParams.get("limit");
  const parsed = raw === null || raw.trim() === "" ? NaN : Number(raw);
  const limit = Number.isFinite(parsed) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed))) : DEFAULT_LIMIT;
  const parentId = searchParams.get("parentId");
  return {
    includeSamples: flag("includeSamples"),
    includeArchived: flag("includeArchived"),
    parentId: parentId ? parentId : undefined,
    limit,
  };
}

/** Collections the API exposes: every v1 record type with many rows per owner (read from the registry). */
export const COLLECTION_KEYS: readonly CollectionKey[] = RECORD_CONTRACTS
  .filter((entry) => entry.readiness === "v1" && entry.key !== "prefs" && entry.key !== "mood_registry")
  .map((entry) => entry.key as CollectionKey);

/** Singletons the API exposes. `prompt_library` is deferred and memory-only (docs/26 §4), so it is not exposed. */
export const SINGLETON_KEYS: readonly SingletonKey[] = RECORD_CONTRACTS
  .filter((entry) => entry.readiness === "v1" && (entry.key === "prefs" || entry.key === "mood_registry"))
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
