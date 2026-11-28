// #185a: the agent API pipeline end to end (lib/agent/handle.ts) on fakes: a service-role admin fake (tokens + audit),
// an anon auth fake (owner sessions) and one fake user database per owner (RLS-style). The route builder below mirrors
// the thin files under app/api/v1 (those import the `@/` alias, which node:test cannot resolve).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleAgentRequest } from "../agent/handle.ts";
import { __resetAgentSessionCache, authenticateAgent } from "../agent/server-auth.ts";
import type { AdminLike, AgentQuery, AgentServerDeps, AnonAuthLike, AgentEnv } from "../agent/server-auth.ts";
import { createRateLimiter, decodeRouteParam, isCollectionKey, isSingletonKey, parseIncludeDerived, parseListQuery } from "../agent/http.ts";
import type { RateLimiter } from "../agent/http.ts";
import type { AgentRoute } from "../agent/dispatch.ts";
import { generateAgentToken, hashAgentToken } from "../agent/tokens.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { sampleTrade } from "./persistence-contract-suite.ts";

const OWNER_A = "00000000-0000-4000-8000-00000000000a";
const OWNER_B = "00000000-0000-4000-8000-00000000000b";
const START = Date.parse("2026-11-23T14:00:00.000Z");
const HOUR = 3_600_000;
const GOOD_ENV: AgentEnv = { url: "https://example.supabase.co", anonKey: "anon", serviceKey: "service", adapter: "supabase" };

interface TokenRow { id: string; user_id: string; scopes: string[]; revoked_at: string | null; token_hash: string }

interface World {
  deps: AgentServerDeps;
  limiter: RateLimiter;
  clock: { now: number };
  tokens: Map<string, TokenRow>;
  lookups: string[];
  adminTables: string[];
  audits: Record<string, unknown>[];
  auditThrows: boolean;
  tokenUpdates: { patch: Record<string, unknown>; filters: Record<string, string> }[];
  getUserCalls: string[];
  linkCalls: string[];
  verifyCalls: number;
  refreshCalls: number;
  refreshFails: boolean;
  owners: Map<string, FakeSupabase>;
  userClientTokens: string[];
  tokenSeq: number;
  claims: Record<string, unknown>[];
}

/** A chain that is both a builder (`eq`) and an awaitable result, the way the supabase-js builder behaves. */
function chain(run: (filters: Record<string, string>) => unknown): AgentQuery {
  const filters: Record<string, string> = {};
  const query = {
    eq(column: string, value: string) {
      filters[column] = value;
      return query;
    },
    maybeSingle() {
      return Promise.resolve(run(filters));
    },
    then(onOk: (value: unknown) => unknown, onErr?: (error: unknown) => unknown) {
      return Promise.resolve(run(filters)).then(onOk, onErr);
    },
  };
  return query as unknown as AgentQuery;
}

function makeWorld(options: { env?: AgentEnv; start?: number } = {}): World {
  const clock = { now: options.start ?? START };
  const tokens = new Map<string, TokenRow>();
  const accessOwner = new Map<string, string>();
  const refreshOwner = new Map<string, string>();
  const owners = new Map<string, FakeSupabase>();
  const world = {
    clock,
    tokens,
    lookups: [] as string[],
    adminTables: [] as string[],
    audits: [] as Record<string, unknown>[],
    auditThrows: false,
    tokenUpdates: [] as { patch: Record<string, unknown>; filters: Record<string, string> }[],
    getUserCalls: [] as string[],
    linkCalls: [] as string[],
    verifyCalls: 0,
    refreshCalls: 0,
    refreshFails: false,
    owners,
    userClientTokens: [] as string[],
    tokenSeq: 0,
    claims: [] as Record<string, unknown>[],
  } as unknown as World;

  const session = (uid: string) => {
    const n = ++world.tokenSeq;
    const access = `access-${uid}-${n}`;
    const refresh = `refresh-${uid}-${n}`;
    accessOwner.set(access, uid);
    refreshOwner.set(refresh, uid);
    return { access_token: access, refresh_token: refresh, expires_at: Math.floor((clock.now + HOUR) / 1000) };
  };

  const admin = {
    from(table: string) {
      world.adminTables.push(table);
      if (table === "mogmine_agent_tokens") {
        return {
          select: () => chain((filters) => {
            world.lookups.push(filters.token_hash);
            const row = world.tokens.get(filters.token_hash);
            return { data: row ? { id: row.id, user_id: row.user_id, scopes: row.scopes, revoked_at: row.revoked_at } : null, error: null };
          }),
          update: (patch: Record<string, unknown>) => chain((filters) => {
            world.tokenUpdates.push({ patch, filters: { ...filters } });
            return { data: null, error: null };
          }),
          insert: () => {
            throw new Error("agent tokens are not inserted by the server");
          },
        };
      }
      if (table === "mogmine_agent_idempotency") return idempotencyFake();
      return {
        select: () => {
          throw new Error(`service role must not read ${table}`);
        },
        update: () => {
          throw new Error(`service role must not update ${table}`);
        },
        insert: (row: Record<string, unknown>) => {
          if (world.auditThrows) throw new Error("audit table down");
          world.audits.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
    auth: {
      admin: {
        getUserById(id: string) {
          world.getUserCalls.push(id);
          return Promise.resolve({ data: { user: { email: `${id}@owner.test` } }, error: null });
        },
        generateLink({ email }: { type: "magiclink"; email: string }) {
          world.linkCalls.push(email);
          return Promise.resolve({ data: { properties: { hashed_token: `hashed:${email}` } }, error: null });
        },
      },
    },
  } as unknown as AdminLike;

  /** The replay table: unique on (user_id, endpoint, idempotency_key), `created_at` stamped from the test clock. */
  function idempotencyFake() {
    const matches = (filters: Record<string, string>) => (row: Record<string, unknown>) =>
      Object.entries(filters).every(([column, value]) => row[column] === value);
    return {
      select: () => chain((filters) => ({ data: world.claims.find(matches(filters)) ?? null, error: null })),
      insert: (row: Record<string, unknown>) => {
        const taken = world.claims.some(matches({ user_id: String(row.user_id), endpoint: String(row.endpoint), idempotency_key: String(row.idempotency_key) }));
        if (taken) return Promise.resolve({ error: { message: "duplicate key" } });
        world.claims.push({ ...row, created_at: new Date(clock.now).toISOString() });
        return Promise.resolve({ error: null });
      },
      update: (patch: Record<string, unknown>) => chain((filters) => {
        world.claims.filter(matches(filters)).forEach((row) => Object.assign(row, patch));
        return { error: null };
      }),
      delete: () => chain((filters) => {
        world.claims = world.claims.filter((row) => !matches(filters)(row));
        return { error: null };
      }),
    };
  }

  const anon = {
    auth: {
      verifyOtp({ token_hash }: { token_hash: string; type: "magiclink" }) {
        world.verifyCalls += 1;
        const uid = token_hash.slice("hashed:".length).split("@")[0];
        return Promise.resolve({ data: { session: session(uid) }, error: null });
      },
      refreshSession({ refresh_token }: { refresh_token: string }) {
        world.refreshCalls += 1;
        const uid = refreshOwner.get(refresh_token);
        if (world.refreshFails || !uid) return Promise.resolve({ data: null, error: { message: "refresh failed" } });
        return Promise.resolve({ data: { session: session(uid) }, error: null });
      },
    },
  } as unknown as AnonAuthLike;

  const userDb = (uid: string) => {
    let db = owners.get(uid);
    if (!db) {
      db = createFakeSupabase(uid);
      owners.set(uid, db);
    }
    return db;
  };

  const deps: AgentServerDeps = {
    env: options.env ?? GOOD_ENV,
    admin,
    anon,
    userClient(accessToken: string) {
      world.userClientTokens.push(accessToken);
      const uid = accessOwner.get(accessToken);
      if (!uid) throw new Error("unknown access token in test");
      const db = userDb(uid);
      return { from: (table) => db.from(table), rpc: (fn, args) => db.rpc(fn, args) };
    },
    now: () => clock.now,
  };
  // The same object the closures above write to, so tests see every counter and flag they change.
  world.deps = deps;
  world.limiter = createRateLimiter({ limit: 120, windowMs: 60_000, now: () => clock.now });
  return world;
}

/** A key for `owner`, stored by hash (the plaintext exists only in the test). */
async function mintKey(world: World, owner: string, scopes: string[] = ["read", "write"], revoked = false): Promise<string> {
  const { token } = generateAgentToken();
  const hash = await hashAgentToken(token);
  const id = `tok-${world.tokens.size + 1}`;
  world.tokens.set(hash, { id, user_id: owner, scopes, revoked_at: revoked ? "2026-11-20T00:00:00.000Z" : null, token_hash: hash });
  return token;
}

/** Mirrors the route files: which AgentRoute a method and path mean. Null is a 404. */
function build(url: URL, method: string, body: unknown): AgentRoute | null {
  const [head, first, second, third] = url.pathname.split("/").slice(3);
  if (head === "me") return method === "GET" && first === undefined ? { kind: "me" } : null;
  if (head === "vocabulary") return method === "GET" && first === undefined ? { kind: "vocabulary" } : null;
  if (head === "singletons") {
    if (!first || !isSingletonKey(first)) return null;
    if (method === "GET") return { kind: "readSingleton", key: first };
    if (method === "PUT") return { kind: "writeSingleton", key: first, body };
    return null;
  }
  if (head !== "records" || !first || !isCollectionKey(first)) return null;
  const type = first;
  if (second === undefined) {
    if (method === "GET") return { kind: "list", type, query: parseListQuery(url.searchParams) };
    if (method === "POST") return { kind: "create", type, body };
    return null;
  }
  const id = decodeRouteParam(second);
  if (id === null) return null;
  if (third === undefined) {
    if (method === "GET") return { kind: "read", type, id, includeDerived: parseIncludeDerived(url.searchParams) };
    if (method === "PATCH") return { kind: "update", type, id, body };
    if (method === "DELETE") return { kind: "remove", type, id };
    return null;
  }
  return third === "archive" && method === "POST" ? { kind: "archive", type, id } : null;
}

interface Reply {
  status: number;
  headers: Headers;
  text: string;
  json: { ok?: boolean; data?: unknown; error?: { code: string; message: string } };
}

async function call(world: World, method: string, path: string, options: { token?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
  const payload = options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  if (payload !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`https://mogmine.test${path}`, { method, headers, body: payload });
  const res = await handleAgentRequest(req, (url, body) => build(url, method, body), { deps: world.deps, limiter: world.limiter });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : {} };
}

const recordOf = (data: unknown) => (data as { record: Record<string, unknown> }).record;

beforeEach(() => {
  __resetAgentSessionCache();
});

// ---- off switch and authentication ---------------------------------------------------------------------------------

test("off switch: adapter local answers 503 and the service role is never called", async () => {
  const world = makeWorld({ env: { ...GOOD_ENV, adapter: "local" } });
  const token = await mintKey(world, OWNER_A);
  const reply = await call(world, "GET", "/api/v1/me", { token });
  assert.equal(reply.status, 503);
  assert.deepEqual(reply.json.error, { code: "unavailable", message: "The agent API is off on this deployment." });
  assert.equal(world.lookups.length, 0);
  assert.equal(world.adminTables.length, 0);
  assert.equal(reply.headers.get("cache-control"), "no-store");
});

test("off switch: a missing service-role key is off too", async () => {
  const world = makeWorld({ env: { ...GOOD_ENV, serviceKey: "" } });
  const reply = await call(world, "GET", "/api/v1/me", { token: (await mintKey(world, OWNER_A)) });
  assert.equal(reply.status, 503);
  assert.equal(world.adminTables.length, 0);
});

test("missing or malformed bearer: 401 with WWW-Authenticate and no service-role call", async () => {
  const world = makeWorld();
  const none = await call(world, "GET", "/api/v1/me");
  assert.equal(none.status, 401);
  assert.equal(none.json.error?.code, "unauthenticated");
  assert.equal(none.headers.get("www-authenticate"), 'Bearer realm="mogmine"');
  const malformed = await call(world, "GET", "/api/v1/me", { headers: { authorization: "Basic abc" } });
  assert.equal(malformed.status, 401);
  assert.equal(malformed.headers.get("www-authenticate"), 'Bearer realm="mogmine"');
  assert.equal(world.adminTables.length, 0);
  assert.equal(world.audits.length, 0);
});

test("unknown and revoked keys get the same 401 message", async () => {
  const world = makeWorld();
  const unknown = await call(world, "GET", "/api/v1/me", { token: generateAgentToken().token });
  const revoked = await call(world, "GET", "/api/v1/me", { token: await mintKey(world, OWNER_A, ["read"], true) });
  for (const reply of [unknown, revoked]) {
    assert.equal(reply.status, 401);
    assert.deepEqual(reply.json.error, { code: "unauthenticated", message: "This agent key is not valid." });
  }
  assert.equal(world.audits.length, 0, "no owner is known, so nothing is audited");
});

test("read-only key: POST is 403, GET list is 200, and the refused write is audited", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A, ["read"]);
  const write = await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-ro") });
  assert.equal(write.status, 403);
  assert.deepEqual(write.json.error, { code: "forbidden", message: "This key is read-only." });
  assert.equal(world.audits.length, 1);
  assert.equal(world.audits[0].status, 403);
  assert.equal(world.audits[0].outcome, "forbidden");
  const list = await call(world, "GET", "/api/v1/records/trades", { token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.data, []);
});

test("write-only key does not read (write does not imply read)", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A, ["write"]);
  const reply = await call(world, "GET", "/api/v1/records/trades", { token });
  assert.equal(reply.status, 403);
});

// ---- records ---------------------------------------------------------------------------------------------------------

test("create then read: 201, GET by id 200 with the same id, list contains it, stamped with the token owner", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const created = await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-1") });
  assert.equal(created.status, 201);
  assert.equal(recordOf(created.json.data).id, "t-1");
  assert.equal(recordOf(created.json.data).user_id, OWNER_A);

  const read = await call(world, "GET", "/api/v1/records/trades/t-1", { token });
  assert.equal(read.status, 200);
  assert.equal(recordOf(read.json.data).id, "t-1");

  const list = await call(world, "GET", "/api/v1/records/trades", { token });
  assert.ok((list.json.data as { id: string }[]).some((row) => row.id === "t-1"));

  const db = world.owners.get(OWNER_A);
  assert.ok(db);
  const rows = db.tables.get("mogmine_trades") ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, OWNER_A, "the row belongs to the key's owner, not the demo owner");
  assert.equal(world.owners.get(OWNER_B), undefined, "no other owner's database is touched");
});

test("PATCH: a non-object body is 422, invalid JSON is 400, and an unknown type is 404", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-2") });

  const array = await call(world, "PATCH", "/api/v1/records/trades/t-2", { token, body: [1, 2] });
  assert.equal(array.status, 422);
  assert.equal(array.json.error?.code, "invalid");

  const broken = await call(world, "POST", "/api/v1/records/trades", { token, raw: "{not json" });
  assert.equal(broken.status, 400);
  assert.deepEqual(broken.json.error, { code: "invalid", message: "Body must be a JSON object." });

  for (const type of ["candles", "showmob_users"]) {
    const reply = await call(world, "GET", `/api/v1/records/${type}`, { token });
    assert.equal(reply.status, 404, type);
    assert.equal(reply.json.error?.code, "not_found", type);
  }
});

test("oversized body is 413 before it is parsed", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const big = `{"id":"x","note":"${"a".repeat(260 * 1024)}"}`;
  const reply = await call(world, "POST", "/api/v1/records/trades", { token, raw: big });
  assert.equal(reply.status, 413);
});

test("delete then read: 404; archive on trades is 403; archive on accounts works", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-3") });
  const removed = await call(world, "DELETE", "/api/v1/records/trades/t-3", { token });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.data, null);
  const gone = await call(world, "GET", "/api/v1/records/trades/t-3", { token });
  assert.equal(gone.status, 404);

  await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-4") });
  const archiveTrade = await call(world, "POST", "/api/v1/records/trades/t-4/archive", { token });
  assert.equal(archiveTrade.status, 403);

  const account = { id: "acc-1", name: "Eval 50K", starting_balance_cents: 5_000_000, rules: {}, created_at: "2026-11-20T00:00:00Z", archived: false };
  const made = await call(world, "POST", "/api/v1/records/accounts", { token, body: account });
  assert.equal(made.status, 201);
  const archived = await call(world, "POST", "/api/v1/records/accounts/acc-1/archive", { token });
  assert.equal(archived.status, 200);
  assert.equal(recordOf(archived.json.data).archived, true);
});

test("ids with a colon round-trip through the route (seed:cut)", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const reply = await call(world, "GET", "/api/v1/records/playbooks/seed%3Acut", { token });
  assert.equal(reply.status, 404, "not stored, so not found, but the id decoded");
  assert.equal(world.audits.at(-1)?.record_id, "seed:cut");
});

// ---- singletons and me -------------------------------------------------------------------------------------------------

test("singletons: PUT prefs then GET returns the same document", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const before = await call(world, "GET", "/api/v1/singletons/prefs", { token });
  assert.equal(before.status, 200);
  assert.equal(before.json.data, null);
  const put = await call(world, "PUT", "/api/v1/singletons/prefs", { token, body: { riskBudgetUsd: 250 } });
  assert.equal(put.status, 200);
  const got = await call(world, "GET", "/api/v1/singletons/prefs", { token });
  assert.equal((recordOf(got.json.data) as { riskBudgetUsd: number }).riskBudgetUsd, 250);
  const notExposed = await call(world, "GET", "/api/v1/singletons/prompt_library", { token });
  assert.equal(notExposed.status, 404);
});

test("me: returns the owner and the key's scopes, never the token", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const reply = await call(world, "GET", "/api/v1/me", { token });
  assert.equal(reply.status, 200);
  const data = reply.json.data as { user_id: string; token: { id: string; scopes: string[] } };
  assert.equal(data.user_id, OWNER_A);
  assert.deepEqual(data.token.scopes, ["read", "write"]);
  assert.equal(reply.text.includes(token), false);
});

// ---- audit and bookkeeping ---------------------------------------------------------------------------------------------

test("audit: one row per authenticated request with method, path (no query), status and outcome", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-5") });
  await call(world, "GET", "/api/v1/records/trades?limit=5&includeArchived=false", { token });
  await call(world, "GET", "/api/v1/records/trades/nope", { token });
  assert.equal(world.audits.length, 3);
  const { request_id, ...createRow } = world.audits[0] as Record<string, unknown>;
  assert.match(String(request_id), /^[0-9a-f-]{36}$/);
  assert.deepEqual(createRow, {
    user_id: OWNER_A,
    token_id: "tok-1",
    method: "POST",
    path: "/api/v1/records/trades",
    record_type: "trades",
    record_id: "t-5",
    status: 201,
    outcome: "ok",
    decision_code: "create",
    decision_version: "agent-write-safety-1",
  });
  assert.equal(world.audits[1].path, "/api/v1/records/trades");
  assert.equal(world.audits[1].status, 200);
  assert.equal(world.audits[2].status, 404);
  assert.equal(world.audits[2].outcome, "not_found");
});

test("last_used_at is written with a filter on BOTH the token id and the owner", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "GET", "/api/v1/me", { token });
  assert.equal(world.tokenUpdates.length, 1);
  assert.deepEqual(world.tokenUpdates[0].filters, { id: "tok-1", user_id: OWNER_A });
  assert.ok(typeof world.tokenUpdates[0].patch.last_used_at === "string");
});

test("audit failure does not change the response", async () => {
  const world = makeWorld();
  world.auditThrows = true;
  const token = await mintKey(world, OWNER_A);
  const reply = await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-6") });
  assert.equal(reply.status, 201);
  assert.equal(recordOf(reply.json.data).id, "t-6");
});

// ---- owner sessions -----------------------------------------------------------------------------------------------------

test("owner session: two requests for one owner mint once; a near-expiry session is refreshed", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "GET", "/api/v1/me", { token });
  await call(world, "GET", "/api/v1/me", { token });
  assert.equal(world.getUserCalls.length, 1);
  assert.equal(world.linkCalls.length, 1);
  assert.equal(world.verifyCalls, 1);
  assert.equal(world.refreshCalls, 0);

  world.clock.now += HOUR - 100_000; // 100 s left: inside the 120 s margin
  await call(world, "GET", "/api/v1/me", { token });
  assert.equal(world.refreshCalls, 1);
  assert.equal(world.linkCalls.length, 1, "refresh reuses the session, no new link");
});

test("owner session: a failed refresh mints again", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "GET", "/api/v1/me", { token });
  world.clock.now += HOUR - 100_000;
  world.refreshFails = true;
  const reply = await call(world, "GET", "/api/v1/me", { token });
  assert.equal(reply.status, 200);
  assert.equal(world.refreshCalls, 1);
  assert.equal(world.linkCalls.length, 2);
});

test("owner session: sessions are per owner, never shared", async () => {
  const world = makeWorld();
  const a = await mintKey(world, OWNER_A);
  const b = await mintKey(world, OWNER_B);
  await call(world, "GET", "/api/v1/me", { token: a });
  await call(world, "GET", "/api/v1/me", { token: b });
  assert.deepEqual(world.linkCalls, [`${OWNER_A}@owner.test`, `${OWNER_B}@owner.test`]);
  const me = await call(world, "GET", "/api/v1/me", { token: b });
  assert.equal((me.json.data as { user_id: string }).user_id, OWNER_B);
});

test("the service role only touches the two agent tables", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade("t-7") });
  await call(world, "GET", "/api/v1/records/trades/t-7", { token });
  assert.deepEqual([...new Set(world.adminTables)].sort(), ["mogmine_agent_audit", "mogmine_agent_tokens"]);
});

// ---- response hygiene and rate limit ----------------------------------------------------------------------------------

test("responses never contain the token, its hash, or a cause", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const hash = await hashAgentToken(token);
  const replies = [
    await call(world, "GET", "/api/v1/me", { token }),
    await call(world, "GET", "/api/v1/records/trades/missing", { token }),
    await call(world, "POST", "/api/v1/records/trades", { token, raw: "{" }),
    await call(world, "GET", "/api/v1/me", { token: generateAgentToken().token }),
  ];
  for (const reply of replies) {
    assert.equal(reply.text.includes(token), false);
    assert.equal(reply.text.includes(hash), false);
    assert.equal(reply.text.includes("cause"), false);
    assert.equal(reply.text.includes("stack"), false);
  }
});

test("rate limit: the 121st request in a minute is 429 with Retry-After and does no lookup", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  for (let i = 0; i < 120; i += 1) {
    const ok = await call(world, "GET", "/api/v1/me", { token });
    assert.equal(ok.status, 200, `request ${i + 1}`);
  }
  assert.equal(world.lookups.length, 120);
  const blocked = await call(world, "GET", "/api/v1/me", { token });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error?.code, "rate_limited");
  const retry = Number(blocked.headers.get("retry-after"));
  assert.ok(retry >= 1 && retry <= 60, `retry-after ${retry}`);
  assert.equal(world.lookups.length, 120, "no database lookup for the blocked request");
});

test("authenticateAgent: a valid key returns the owner and a data client, and a scope failure carries the identity", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A, ["read"]);
  const req = new Request("https://mogmine.test/api/v1/records/trades", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const denied = await authenticateAgent(req, world.deps, world.limiter);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.deepEqual(denied.identity, { userId: OWNER_A, tokenId: "tok-1", scopes: ["read"] });

  const ok = await authenticateAgent(new Request("https://mogmine.test/api/v1/me", { headers: { authorization: `Bearer ${token}` } }), world.deps, world.limiter);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    const session = await ok.ctx.db.auth.getSession();
    assert.equal(session.data.session?.user.id, OWNER_A);
  }
});

test("a key with no scopes can do nothing", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A, []);
  const reply = await call(world, "GET", "/api/v1/me", { token });
  assert.equal(reply.status, 403);
});

// ---- #API-2a: vocabulary, list filters and derived values over HTTP -----------------------------------------------------

const RAW_ACCOUNT = {
  id: "sim-acct-eval-50k", name: "SIM Eval 50K", starting_balance_cents: 5_000_000, rules: {},
  created_at: "2026-11-20T00:00:00.000Z", archived: false, r_size_cents: 30_000,
};
const RAW_TRADE = {
  id: "t-a", symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
  entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T15:10:00Z",
  entry_price: 7600, exit_price: 7723, stop_loss_price: 7582.5, initial_stop_price: 7582.5,
  initial_stop_set_at: "2026-11-23T14:29:00Z", account_id: "sim-acct-eval-50k", playbook_id: "orb-reclaim",
};

test("vocabulary: GET with a read key is 200 and the tags are never playbooks; a write-only key is 403", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const reply = await call(world, "GET", "/api/v1/vocabulary", { token });
  assert.equal(reply.status, 200);
  const data = reply.json.data as { setup_tags: string[]; playbooks: { name: string }[]; house_rules_version: string };
  assert.ok(data.setup_tags.includes("VWAP Hold"));
  assert.ok(!data.playbooks.some((playbook) => playbook.name === "VWAP Hold"));
  assert.equal(data.house_rules_version, "2026-11-27.1");
  assert.equal(reply.headers.get("cache-control"), "no-store");
  const writeOnly = await mintKey(world, OWNER_A, ["write"]);
  assert.equal((await call(world, "GET", "/api/v1/vocabulary", { token: writeOnly })).status, 403);
});

test("list filters and include=derived over HTTP: filtered rows, derived block, and 422 for a malformed date", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  assert.equal((await call(world, "POST", "/api/v1/records/accounts", { token, body: RAW_ACCOUNT })).status, 201);
  assert.equal((await call(world, "POST", "/api/v1/records/trades", { token, body: RAW_TRADE })).status, 201);
  assert.equal((await call(world, "POST", "/api/v1/records/trades", { token, body: { ...RAW_TRADE, id: "t-b", entry_time: "2026-11-24T14:30:00Z", exit_time: "2026-11-24T14:40:00Z" } })).status, 201);

  const bySession = await call(world, "GET", "/api/v1/records/trades?session_date=2026-11-23", { token });
  assert.equal(bySession.status, 200);
  assert.deepEqual((bySession.json.data as { id: string }[]).map((row) => row.id), ["t-a"]);

  const derived = await call(world, "GET", "/api/v1/records/trades?session_date=2026-11-23&include=derived", { token });
  const row = (derived.json.data as Array<{ id: string; derived: { pnl_cents: number; result_r: number; r_size_cents: number } }>)[0];
  assert.equal(row.id, "t-a");
  assert.equal(row.derived.pnl_cents, 61_500);
  assert.equal(row.derived.result_r, 2.05);
  assert.equal(row.derived.r_size_cents, 30_000);

  const singlePlain = await call(world, "GET", "/api/v1/records/trades/t-a", { token });
  assert.equal((singlePlain.json.data as { derived?: unknown }).derived, undefined);
  const singleDerived = await call(world, "GET", "/api/v1/records/trades/t-a?include=derived", { token });
  assert.equal((singleDerived.json.data as { derived: { result_r: number; pnl_cents: number } }).derived.result_r, 2.05);
  assert.equal((singleDerived.json.data as { derived: { result_r: number; pnl_cents: number } }).derived.pnl_cents, 61_500);

  const malformed = await call(world, "GET", "/api/v1/records/trades?session_date=2026-02-30", { token });
  assert.equal(malformed.status, 422);
  assert.equal(malformed.json.error?.code, "invalid");

  const unsupported = await call(world, "GET", "/api/v1/records/accounts?playbook_id=orb-reclaim", { token });
  assert.equal(unsupported.status, 422);

  const account = await call(world, "GET", "/api/v1/records/accounts?include=derived", { token });
  const accountRow = (account.json.data as Array<{ derived: { from_journal_gross: boolean; realized_cents: number } }>)[0];
  assert.equal(accountRow.derived.from_journal_gross, true);
  // Two closed trades on the account, each $615: t-a and t-b (the next day's copy).
  assert.equal(accountRow.derived.realized_cents, 123_000);
});

// ---- idempotent creates --------------------------------------------------------------------------------------------

const createOnce = (world: World, token: string, id: string) =>
  call(world, "POST", "/api/v1/records/trades", { token, body: sampleTrade(id), headers: { "idempotency-key": `key-${id}` } });

test("idempotency: a retry replays the first response", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  const first = await createOnce(world, token, "t-idem");
  const again = await createOnce(world, token, "t-idem");
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.deepEqual(again.json, first.json);
});

test("idempotency: a stranded claim waits out its lease, then answers with the saved record", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await createOnce(world, token, "t-saved");
  Object.assign(world.claims[0], { state: "in_flight", status: null, response_body: null });
  assert.equal((await createOnce(world, token, "t-saved")).status, 409, "a recent claim may still be running");
  world.clock.now += 16 * 60_000;
  const reconciled = await createOnce(world, token, "t-saved");
  assert.equal(reconciled.status, 201);
  assert.equal(recordOf(reconciled.json.data).id, "t-saved");
  assert.equal(world.claims[0].state, "completed");
});

test("idempotency: a stranded claim with nothing saved is run again", async () => {
  const world = makeWorld();
  const token = await mintKey(world, OWNER_A);
  await createOnce(world, token, "t-lost");
  Object.assign(world.claims[0], { state: "in_flight", status: null, response_body: null });
  world.owners.clear();
  world.clock.now += 16 * 60_000;
  const rerun = await createOnce(world, token, "t-lost");
  assert.equal(rerun.status, 201);
  assert.equal(world.claims.length, 1);
  assert.equal(world.claims[0].state, "completed");
});
