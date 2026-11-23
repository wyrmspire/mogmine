// #185a: HTTP helpers for the agent API (lib/agent/http.ts): status map, rate limiter, list query, route keys.
import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_KEYS, SINGLETON_KEYS, agentError, createRateLimiter, decodeRouteParam, isCollectionKey, isSingletonKey,
  parseListQuery, statusFor,
} from "../agent/http.ts";
import type { AgentErrorCode } from "../agent/http.ts";

test("statusFor: every code maps to its HTTP status", () => {
  const expected: Record<AgentErrorCode, number> = {
    not_found: 404, conflict: 409, invalid: 422, unauthenticated: 401, forbidden: 403,
    unavailable: 503, unknown: 500, rate_limited: 429,
  };
  for (const [code, status] of Object.entries(expected)) assert.equal(statusFor(code as AgentErrorCode), status, code);
});

test("agentError: body is { ok:false, error:{code,message} } with no extra fields", () => {
  const { status, body, headers } = agentError("forbidden", "This key is read-only.", { "X-Test": "1" });
  assert.equal(status, 403);
  assert.deepEqual(body, { ok: false, error: { code: "forbidden", message: "This key is read-only." } });
  assert.deepEqual(headers, { "X-Test": "1" });
});

test("createRateLimiter: 120 allowed per minute, the 121st blocked with a retry time, then it recovers", () => {
  let clock = 1_000_000;
  const limiter = createRateLimiter({ limit: 120, windowMs: 60_000, now: () => clock });
  for (let i = 0; i < 120; i += 1) assert.deepEqual(limiter.take("k"), { ok: true }, `request ${i + 1}`);
  const blocked = limiter.take("k");
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60);
  clock += 30_000;
  assert.equal(limiter.take("k").ok, false, "still blocked halfway through the window");
  clock += 30_001;
  assert.deepEqual(limiter.take("k"), { ok: true }, "recovered after the window");
});

test("createRateLimiter: keys are independent", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
  assert.equal(limiter.take("a").ok, true);
  assert.equal(limiter.take("a").ok, false);
  assert.equal(limiter.take("b").ok, true);
});

test("parseListQuery: limit clamps to 1..500 and junk falls back to 100", () => {
  const limit = (raw: string | null) => parseListQuery(new URLSearchParams(raw === null ? "" : `limit=${raw}`)).limit;
  assert.equal(limit(null), 100);
  assert.equal(limit("0"), 1);
  assert.equal(limit("-5"), 1);
  assert.equal(limit("9999"), 500);
  assert.equal(limit("25"), 25);
  assert.equal(limit("junk"), 100);
  assert.equal(limit(""), 100);
});

test("parseListQuery: booleans parse only for true and false; parentId passes through", () => {
  const query = parseListQuery(new URLSearchParams("includeSamples=false&includeArchived=yes&parentId=seed:cut"));
  assert.equal(query.includeSamples, false);
  assert.equal(query.includeArchived, undefined);
  assert.equal(query.parentId, "seed:cut");
  const truthy = parseListQuery(new URLSearchParams("includeSamples=true&includeArchived=true"));
  assert.equal(truthy.includeSamples, true);
  assert.equal(truthy.includeArchived, true);
  assert.equal(parseListQuery(new URLSearchParams("")).parentId, undefined);
});

test("route keys: collections come from the v1 registry; candles and prompt_library are not exposed", () => {
  assert.ok(COLLECTION_KEYS.includes("trades"));
  assert.ok(COLLECTION_KEYS.includes("prompt_dismissals"));
  assert.equal(isCollectionKey("candles"), false);
  assert.equal(isCollectionKey("prompt_library"), false);
  assert.equal(isCollectionKey("prefs"), false);
  assert.equal(isCollectionKey("showmob_users"), false);
  assert.deepEqual([...SINGLETON_KEYS].sort(), ["mood_registry", "prefs"]);
  assert.equal(isSingletonKey("prefs"), true);
  assert.equal(isSingletonKey("prompt_library"), false);
  assert.equal(isSingletonKey("trades"), false);
});

test("decodeRouteParam: decodes once and returns null for a malformed escape", () => {
  assert.equal(decodeRouteParam("seed%3Acut"), "seed:cut");
  assert.equal(decodeRouteParam("plain"), "plain");
  assert.equal(decodeRouteParam("%E0%A4%A"), null);
});
