// #176: the Supabase adapter passes the same shared contract suite as the local/mock adapters, on an in-memory
// fake of supabase-js that mimics the migration (RLS, generated columns, server timestamps, replace RPC).
// The live check at the bottom is opt-in (env vars) and read-only; it never writes to the shared project.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { createMemoryCandleStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter, mapDbError } from "../persistence/supabase-adapter.ts";
import { createAdapter } from "../persistence/select.ts";
import { RECORD_CONTRACTS, isMogmineTable } from "../persistence/registry.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import { runPersistenceContractSuite, sampleTrade } from "./persistence-contract-suite.ts";

const CHRIS = "00000000-0000-4000-8000-000000000001";

function setup(uid: string | null = CHRIS) {
  const db = createFakeSupabase(uid);
  const adapter = createSupabaseAdapter({ client: db, candles: createMemoryCandleStore() });
  return { db, adapter, repo: adapter.repositories };
}

// The suite writes as `demo-owner`. A session whose uid is `demo-owner` keeps its meta assertions literal; the
// mapping from `demo-owner` to a real uuid session is pinned separately below.
runPersistenceContractSuite("supabase adapter (fake client)", () => setup(DEFAULT_OWNER_USER_ID).adapter);

test("supabase: demo-owner writes land under the signed-in uuid", async () => {
  const { db, adapter, repo } = setup();
  assert.equal(await adapter.currentOwner(), CHRIS);
  const put = await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
  assert.ok(put.ok, put.ok ? "" : put.error.message);
  assert.equal(put.value.meta.user_id, CHRIS);
  assert.equal(put.value.record.user_id, CHRIS);
  const [row] = db.tables.get("mogmine_trades") ?? [];
  assert.equal(row.user_id, CHRIS);
  const viaUid = await repo.trades.get(CHRIS, "t-1");
  assert.ok(viaUid.ok);
});

test("supabase: a record claiming another user_id is forbidden and nothing is written", async () => {
  const { db, repo } = setup();
  const result = await repo.trades.put(CHRIS, { ...sampleTrade("t-1"), user_id: "someone-else" });
  assert.equal(!result.ok && result.error.code, "forbidden");
  assert.equal((db.tables.get("mogmine_trades") ?? []).length, 0);
});

test("supabase: derived fields are never stored, even when a caller sends them", async () => {
  const { db, repo } = setup();
  const withDerived = { ...sampleTrade("t-1"), net_pnl: 999, r_multiple: 9, hold_seconds: 1, candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1 }] };
  const put = await repo.trades.put(CHRIS, withDerived as never);
  assert.ok(put.ok, put.ok ? "" : put.error.message);
  const stored = (db.tables.get("mogmine_trades") ?? [])[0].record as Record<string, unknown>;
  for (const field of ["net_pnl", "r_multiple", "hold_seconds", "mae_price", "mfe_price", "candles"]) assert.equal(field in stored, false, field);
  assert.notEqual((put.value.record as unknown as Record<string, unknown>).net_pnl, 999);
});

test("supabase: without a session every call is unauthenticated", async () => {
  const { adapter, repo } = setup(null);
  assert.equal(await adapter.currentOwner(), null);
  const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
  assert.equal(!listed.ok && listed.error.code, "unauthenticated");
  const prefs = await repo.prefs.get(DEFAULT_OWNER_USER_ID);
  assert.equal(!prefs.ok && prefs.error.code, "unauthenticated");
});

test("supabase: a client that fails to load is unavailable, and the next call retries it", async () => {
  let attempts = 0;
  const fake = createFakeSupabase(CHRIS);
  const adapter = createSupabaseAdapter({
    client: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("env missing");
      return fake;
    },
    candles: createMemoryCandleStore(),
  });
  const first = await adapter.repositories.trades.list(CHRIS);
  assert.equal(!first.ok && first.error.code, "unavailable");
  const second = await adapter.repositories.trades.list(CHRIS);
  assert.ok(second.ok);
});

test("supabase: database errors map to contract codes", async () => {
  const { db, repo } = setup();
  db.failNext({ code: "42501", message: "new row violates row-level security policy" });
  const rls = await repo.trades.put(CHRIS, sampleTrade("t-1"));
  assert.equal(!rls.ok && rls.error.code, "forbidden");
  db.failNext({ message: "TypeError: fetch failed" });
  const offline = await repo.trades.list(CHRIS);
  assert.equal(!offline.ok && offline.error.code, "unavailable");
  assert.equal(mapDbError({ code: "23505", message: "dup" }).error.code, "conflict");
  assert.equal(mapDbError({ code: "PGRST301", message: "JWT expired" }).error.code, "unauthenticated");
  assert.equal(mapDbError({ code: "XX000", message: "boom" }).error.code, "unknown");
});

test("supabase: list filters by parent, archive flag and limit on the server columns", async () => {
  const { repo } = setup();
  const account = (id: string, archived: boolean) => ({ id, user_id: CHRIS, name: id, starting_balance_cents: 5_000_000, rules: {}, created_at: "2026-11-20T00:00:00Z", archived }) as never;
  assert.ok((await repo.accounts.put(CHRIS, account("a-1", false))).ok);
  assert.ok((await repo.accounts.put(CHRIS, account("a-2", true))).ok);
  const live = await repo.accounts.list(CHRIS, { includeArchived: false });
  assert.deepEqual(live.ok && live.value.map((row) => row.id), ["a-1"]);
  const limited = await repo.accounts.list(CHRIS, { limit: 1 });
  assert.equal(limited.ok && limited.value.length, 1);
  const noParent = await repo.challenges.list(CHRIS, { parentId: "x" });
  assert.deepEqual(noParent.ok && noParent.value, []);
});

test("supabase: replaceAll goes through the one-transaction RPC and validates first", async () => {
  const { db, repo } = setup();
  await repo.trades.put(CHRIS, sampleTrade("old"));
  const bad = await repo.trades.replaceAll(CHRIS, [sampleTrade("a"), { ...sampleTrade("b"), id: "" }]);
  assert.equal(!bad.ok && bad.error.code, "invalid");
  assert.equal(db.calls.includes("rpc mogmine_replace_rows"), false);
  const good = await repo.trades.replaceAll(CHRIS, [sampleTrade("a"), sampleTrade("b")]);
  assert.ok(good.ok);
  const listed = await repo.trades.list(CHRIS);
  assert.deepEqual(listed.ok && listed.value.map((row) => row.id).sort(), ["a", "b"]);
});

test("supabase: singletons round-trip and honour expectedUpdatedAt", async () => {
  const { repo } = setup();
  const before = await repo.prefs.get(CHRIS);
  assert.ok(before.ok && before.value === null);
  const prefs = await repo.prefs.get(CHRIS);
  assert.ok(prefs.ok);
  const first = await repo.mood_registry.put(CHRIS, (await import("../mood.ts")).DEFAULT_MOOD_REGISTRY);
  assert.ok(first.ok, first.ok ? "" : first.error.message);
  const stale = await repo.mood_registry.put(CHRIS, first.value.record, { expectedUpdatedAt: "1999-01-01T00:00:00.000Z" });
  assert.equal(!stale.ok && stale.error.code, "conflict");
  const fresh = await repo.mood_registry.put(CHRIS, first.value.record, { expectedUpdatedAt: first.value.meta.updated_at });
  assert.ok(fresh.ok);
});

test("supabase: the command layer runs over the adapter (owner uid, update, cascade)", async () => {
  const { adapter } = setup();
  const commands = createJournalCommands(adapter.repositories, (await adapter.currentOwner())!);
  const trade = (id: string) => ({ id, symbol: "MES", direction: "LONG", quantity: 1, entry_time: "2026-11-20T15:00:00Z", exit_time: "2026-11-20T15:30:00Z", entry_price: 7600.25, exit_price: 7602.25, stop_loss_price: 7598.25 });
  const created = await commands.create("trades", trade("t-1"));
  assert.ok(created.ok, created.ok ? "" : created.error.message);
  assert.equal(created.value.record.user_id, CHRIS);
  const updated = await commands.update("trades", "t-1", { note: "held the shelf" });
  assert.ok(updated.ok, updated.ok ? "" : updated.error.message);
  await commands.create("trades", trade("t-2"));
  const drill = (id: string, tradeId: string) => ({ id, trade_id: tradeId, kind: "take_it", answer: "take", answered_at: "2026-11-20T16:00:00Z", hidden: [] });
  assert.ok((await commands.create("drills", drill("d-1", "t-1"))).ok);
  assert.ok((await commands.create("drills", drill("d-2", "t-2"))).ok);
  assert.ok((await commands.remove("trades", "t-1")).ok);
  assert.equal((await commands.read("drills", "d-1")).ok, false);
  assert.equal((await commands.read("drills", "d-2")).ok, true);
});

test("supabase: the env flag selects this adapter with an injected client", async () => {
  const adapter = createAdapter("supabase", { supabase: createFakeSupabase(CHRIS), candles: createMemoryCandleStore() });
  assert.equal(adapter.kind, "supabase");
  assert.equal(await adapter.currentOwner(), CHRIS);
});

test("migrations: every created object is mogmine_, every table has RLS, nothing touches showmob_", () => {
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  assert.ok(files.length >= 1);
  const sql = files.map((name) => readFileSync(new URL(name, dir), "utf8")).join("\n");
  const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.equal(/showmob_/i.test(code), false, "no showmob_ reference outside comments");
  assert.equal(/\b(alter|drop)\s+(table|function|policy|schema)\s+(?!public\.mogmine_)/i.test(code), false);
  const created = [...code.matchAll(/create (?:table|function|policy|trigger|index) (?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[1]);
  for (const name of created) assert.ok(isMogmineTable(name), name);
  const tables = [...code.matchAll(/create table public\.([a-z0-9_]+)/g)].map((m) => m[1]);
  for (const table of tables) assert.match(code, new RegExp(`alter table public\\.${table} enable row level security`), table);
  for (const contract of RECORD_CONTRACTS.filter((entry) => entry.readiness === "v1")) assert.ok(tables.includes(contract.table), contract.table);
});

const liveUrl = process.env.MOGMINE_IT_SUPABASE_URL;
const liveAnon = process.env.MOGMINE_IT_SUPABASE_ANON_KEY;
test("supabase live (opt-in, read-only): anon sees no mogmine_ rows", { skip: !(liveUrl && liveAnon) && "set MOGMINE_IT_SUPABASE_URL and MOGMINE_IT_SUPABASE_ANON_KEY" }, async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(liveUrl!, liveAnon!, { auth: { persistSession: false } });
  const adapter = createSupabaseAdapter({ client: client as never, candles: createMemoryCandleStore() });
  assert.equal(await adapter.currentOwner(), null);
  const { data } = await client.from("mogmine_trades").select("id").limit(1);
  assert.equal((data ?? []).length, 0);
});

test("supabase: daily reviews land in mogmine_daily_reviews under the signed-in uid, and an unapplied table reads as unavailable", async () => {
  const { db, repo } = setup();
  const review = {
    id: "review-2026-11-23", user_id: DEFAULT_OWNER_USER_ID, session_date: "2026-11-23", account_id: null, trade_ids: [],
    plan_ids: [], points: [], lesson: "Wait for the retest", status: "draft" as const, recorded_at: "2026-11-23T22:00:00.000Z",
  };
  const put = await repo.daily_reviews.put(DEFAULT_OWNER_USER_ID, review);
  assert.equal(put.ok, true);
  const rows = db.tables.get("mogmine_daily_reviews") ?? [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, CHRIS);
  assert.equal(rows[0].id, "review-2026-11-23");

  db.failNext({ code: "PGRST205", message: "Could not find the table 'public.mogmine_daily_reviews' in the schema cache" });
  const offline = await repo.daily_reviews.list(DEFAULT_OWNER_USER_ID, {});
  assert.equal(!offline.ok && offline.error.code, "unavailable");
});
