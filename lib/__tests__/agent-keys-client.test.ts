// #185b: the browser key functions (lib/agent/keys-client.ts) on a hand-written fake of the query builder that records
// every call. Checks the payload, the column list, the filters, and that no plaintext key reaches the database.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_KEY_COLUMNS,
  cleanLabel,
  createAgentKey,
  listAgentKeys,
  listRecentAudit,
  revokeAgentKey,
  scopesFor,
} from "../agent/keys-client.ts";
import type { KeysClientLike } from "../agent/keys-client.ts";
import { AGENT_TOKEN_PATTERN, hashAgentToken } from "../agent/tokens.ts";

interface Entry {
  table: string;
  op: "insert" | "select" | "update";
  payload?: Record<string, unknown>;
  columns?: string;
  filters: Array<[string, string]>;
  order?: [string, boolean];
  limit?: number;
}

function fakeDb(opts: { rows?: unknown[]; error?: { message: string } } = {}) {
  const log: Entry[] = [];
  const fail = { data: null, error: opts.error ?? null };
  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          const entry: Entry = { table, op: "insert", payload: row, filters: [] };
          log.push(entry);
          return {
            select(columns: string) {
              entry.columns = columns;
              return {
                single: async () => (opts.error ? fail : { data: { ...row, id: "key-1", created_at: "2026-11-23T10:00:00Z", last_used_at: null, revoked_at: null }, error: null }),
              };
            },
          };
        },
        select(columns: string) {
          const entry: Entry = { table, op: "select", columns, filters: [] };
          log.push(entry);
          return {
            eq(column: string, value: string) {
              entry.filters.push([column, value]);
              return {
                order(orderColumn: string, options: { ascending: boolean }) {
                  entry.order = [orderColumn, options.ascending];
                  return {
                    limit: async (count: number) => {
                      entry.limit = count;
                      return opts.error ? fail : { data: opts.rows ?? [], error: null };
                    },
                  };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          const entry: Entry = { table, op: "update", payload: patch, filters: [] };
          log.push(entry);
          return {
            eq(column: string, value: string) {
              entry.filters.push([column, value]);
              return {
                eq(column2: string, value2: string) {
                  entry.filters.push([column2, value2]);
                  return Promise.resolve({ error: opts.error ?? null });
                },
              };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as KeysClientLike, log };
}

test("createAgentKey: inserts the owner, label, hash, prefix and scopes; never the plaintext", async () => {
  const { db, log } = fakeDb();
  const result = await createAgentKey(db, "user-1", "Grok Bot", "read-write");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(log.length, 1);
  const entry = log[0];
  assert.equal(entry.table, "mogmine_agent_tokens");
  assert.equal(entry.op, "insert");
  const payload = entry.payload ?? {};
  assert.deepEqual(Object.keys(payload).sort(), ["label", "scopes", "token_hash", "token_prefix", "user_id"]);
  assert.equal(payload.user_id, "user-1");
  assert.equal(payload.label, "Grok Bot");
  assert.deepEqual(payload.scopes, ["read", "write"]);
  assert.match(String(payload.token_hash), /^[0-9a-f]{64}$/);
  assert.equal(payload.token_prefix, result.token.slice(0, 12));
  assert.equal(JSON.stringify(payload).includes(result.token), false, "the plaintext is not in the row");
  assert.equal(payload.token_hash, await hashAgentToken(result.token));
  assert.match(result.token, AGENT_TOKEN_PATTERN);
  assert.equal(entry.columns, AGENT_KEY_COLUMNS);
  assert.equal(result.row.id, "key-1");
});

test("createAgentKey: read only carries the read scope; labels are cleaned before storage", async () => {
  const { db, log } = fakeDb();
  const result = await createAgentKey(db, "user-1", "  Grok   Bot ", "read");
  assert.equal(result.ok, true);
  assert.deepEqual(log[0].payload?.scopes, ["read"]);
  assert.equal(log[0].payload?.label, "Grok Bot");
});

test("createAgentKey: a bad label answers before any database call", async () => {
  for (const label of ["   ", "", "x".repeat(61)]) {
    const { db, log } = fakeDb();
    const result = await createAgentKey(db, "user-1", label, "read");
    assert.equal(result.ok, false, JSON.stringify(label));
    assert.equal(log.length, 0);
  }
  const { db } = fakeDb();
  assert.equal((await createAgentKey(db, "user-1", "x".repeat(60), "read")).ok, true);
});

test("createAgentKey: a database error becomes a friendly message with no raw text", async () => {
  const { db } = fakeDb({ error: { message: 'relation "mogmine_agent_tokens" secret detail' } });
  const result = await createAgentKey(db, "user-1", "Bot", "read");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.doesNotMatch(result.message, /relation|secret|mogmine_agent/);
});

test("cleanLabel and scopesFor", () => {
  assert.equal(cleanLabel("  a\t b  "), "a b");
  assert.equal(cleanLabel("   "), null);
  assert.equal(cleanLabel("x".repeat(61)), null);
  assert.deepEqual(scopesFor("read"), ["read"]);
  assert.deepEqual(scopesFor("read-write"), ["read", "write"]);
});

test("listAgentKeys: newest first, filtered to the owner, with the column list", async () => {
  const rows = [{ id: "k2" }, { id: "k1" }];
  const { db, log } = fakeDb({ rows });
  const result = await listAgentKeys(db, "user-1");
  assert.deepEqual(result, { ok: true, rows });
  assert.equal(log[0].table, "mogmine_agent_tokens");
  assert.equal(log[0].columns, AGENT_KEY_COLUMNS);
  assert.deepEqual(log[0].filters, [["user_id", "user-1"]]);
  assert.deepEqual(log[0].order, ["created_at", false]);
});

test("listAgentKeys: a database error is a friendly message", async () => {
  const { db } = fakeDb({ error: { message: "permission denied for table mogmine_agent_tokens" } });
  const result = await listAgentKeys(db, "user-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.doesNotMatch(result.message, /permission|mogmine_agent/);
});

test("revokeAgentKey: sets revoked_at only, filtered by id AND owner", async () => {
  const { db, log } = fakeDb();
  const now = "2026-11-23T12:00:00.000Z";
  assert.deepEqual(await revokeAgentKey(db, "user-1", "key-9", now), { ok: true });
  assert.equal(log[0].op, "update");
  assert.deepEqual(log[0].payload, { revoked_at: now });
  assert.deepEqual(log[0].filters, [["id", "key-9"], ["user_id", "user-1"]]);
});

test("revokeAgentKey: a database error is a friendly message", async () => {
  const { db } = fakeDb({ error: { message: "row-level security violated on mogmine_agent_tokens" } });
  const result = await revokeAgentKey(db, "user-1", "key-9", "2026-11-23T12:00:00.000Z");
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message ?? "", /row-level|mogmine_agent/);
});

test("listRecentAudit: the audit columns, newest first, the owner, and a limit of 20 by default", async () => {
  const { db, log } = fakeDb({ rows: [] });
  assert.deepEqual(await listRecentAudit(db, "user-1"), { ok: true, rows: [] });
  assert.equal(log[0].table, "mogmine_agent_audit");
  assert.equal(log[0].columns, "id,at,method,path,record_type,record_id,status,outcome");
  assert.deepEqual(log[0].order, ["at", false]);
  assert.deepEqual(log[0].filters, [["user_id", "user-1"]]);
  assert.equal(log[0].limit, 20);
});

test("every select names explicit columns: never *, never token_hash", async () => {
  const { db, log } = fakeDb({ rows: [] });
  await listAgentKeys(db, "user-1");
  await listRecentAudit(db, "user-1");
  await createAgentKey(db, "user-1", "Bot", "read");
  for (const entry of log.filter((item) => item.columns !== undefined)) {
    assert.doesNotMatch(entry.columns ?? "", /\*|token_hash/);
  }
});
