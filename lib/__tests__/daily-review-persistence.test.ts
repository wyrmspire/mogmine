// DR-1b: daily reviews in the persistence contract, the sync layer, the command layer and the Agent API.
// Driven through the real local/mock adapter and the real dispatch layer; Supabase is the in-memory fake (no network,
// no real tokens, no live /api/v1 calls). Migration text is checked as a file, never applied.
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLLECTION_KEYS, isCollectionKey, parseListQuery } from "../agent/http.ts";
import { dispatchAgentRoute } from "../agent/dispatch.ts";
import type { AgentRoute, AgentWho } from "../agent/dispatch.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { contractFor, isMogmineTable } from "../persistence/registry.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { mapDbError } from "../persistence/supabase-adapter.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import {
  configureDailyReviewsSyncForTests, getDailyReviews, hydrateDailyReviews, resetDailyReviewsForTests, upsertDailyReview,
} from "../daily-review-store.ts";
import type { DailyReview } from "../daily-review.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import { UID, installDevice, removeDevice, serverIds, settle, storeSyncOptions } from "./store-sync-harness.ts";

const TABLE = "mogmine_daily_reviews";
const MIGRATION = new URL("../../supabase/migrations/20261124120000_mogmine_daily_reviews.sql", import.meta.url);
const WHO: AgentWho = { userId: DEFAULT_OWNER_USER_ID, tokenId: "tok-test", scopes: ["read", "write"] };

function setup(): JournalCommands {
  const adapter = createLocalAdapter({ kind: "mock", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
  return createJournalCommands(adapter.repositories);
}

const review = (over: Record<string, unknown> = {}) => ({
  id: "review-2026-11-23",
  session_date: "2026-11-23",
  account_id: null,
  trade_ids: ["t-1"],
  plan_ids: [],
  points: [{ id: "p-1", kind: "mistake", text: "Chased the open", trade_id: "t-1" }],
  lesson: "Wait for the retest",
  status: "draft",
  recorded_at: "2026-11-23T22:00:00.000Z",
  ...over,
});

const run = (route: AgentRoute, commands: JournalCommands) => dispatchAgentRoute(route, commands, WHO);

afterEach(() => {
  resetDailyReviewsForTests();
  resetSyncRegistryForTests();
  removeDevice();
});

test("daily_reviews is a v1 collection on the registry and in the Agent API key list", () => {
  assert.ok(COLLECTION_KEYS.includes("daily_reviews"));
  assert.equal(isCollectionKey("daily_reviews"), true);
  const entry = contractFor("daily_reviews");
  assert.equal(entry.table, "mogmine_daily_reviews");
  assert.equal(entry.deviceKey, "mogmine-daily-reviews-v1");
  assert.equal(entry.deletePolicy, "hard");
  assert.equal(entry.readiness, "v1");
  assert.deepEqual([...entry.derivedNeverStored].sort(), ["cards", "totals"]);
});

test("the Agent API creates, lists by session_date, reads, updates and deletes a daily review", async () => {
  const commands = setup();
  const created = await run({ kind: "create", type: "daily_reviews", body: review() }, commands);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const listed = await run({ kind: "list", type: "daily_reviews", query: parseListQuery(new URLSearchParams("session_date=2026-11-23")) }, commands);
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal((listed.body as { data: unknown[] }).data.length, 1);

  const other = await run({ kind: "list", type: "daily_reviews", query: parseListQuery(new URLSearchParams("session_date=2026-11-24")) }, commands);
  assert.equal((other.body as { data: unknown[] }).data.length, 0);

  const read = await run({ kind: "read", type: "daily_reviews", id: "review-2026-11-23" }, commands);
  assert.equal(read.status, 200);
  assert.match(JSON.stringify(read.body), /Wait for the retest/);

  const patched = await run({ kind: "update", type: "daily_reviews", id: "review-2026-11-23", body: { lesson: "Size down after two losses" } }, commands);
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.match(JSON.stringify(patched.body), /Size down after two losses/);

  const removed = await run({ kind: "remove", type: "daily_reviews", id: "review-2026-11-23" }, commands);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const gone = await run({ kind: "read", type: "daily_reviews", id: "review-2026-11-23" }, commands);
  assert.equal(gone.status, 404);
});

test("a second review for the same (session_date, account_id) is a 409 that names the existing review", async () => {
  const commands = setup();
  assert.equal((await run({ kind: "create", type: "daily_reviews", body: review() }, commands)).status, 201);

  const duplicate = await run({ kind: "create", type: "daily_reviews", body: review({ id: "review-dup" }) }, commands);
  assert.equal(duplicate.status, 409);
  assert.match(JSON.stringify(duplicate.body), /already exists \(review-2026-11-23\)/);

  // A different account on the same day is a different scope (Q-3), so it is allowed.
  const accountScoped = await run({ kind: "create", type: "daily_reviews", body: review({ id: "review-2026-11-23-sim-1", account_id: "sim-1" }) }, commands);
  assert.equal(accountScoped.status, 201, JSON.stringify(accountScoped.body));
});

test("moving a review onto another review's scope is a 409 too; a same-scope edit is not", async () => {
  const commands = setup();
  await run({ kind: "create", type: "daily_reviews", body: review() }, commands);
  await run({ kind: "create", type: "daily_reviews", body: review({ id: "review-2026-11-24", session_date: "2026-11-24", recorded_at: "2026-11-24T22:00:00.000Z" }) }, commands);

  const moved = await run({ kind: "update", type: "daily_reviews", id: "review-2026-11-24", body: { session_date: "2026-11-23" } }, commands);
  assert.equal(moved.status, 409);
  assert.match(JSON.stringify(moved.body), /review-2026-11-23/);

  const edited = await run({ kind: "update", type: "daily_reviews", id: "review-2026-11-23", body: { status: "done" } }, commands);
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
});

test("derived totals and cards are never stored: a write carrying them is a 403", async () => {
  const commands = setup();
  const withTotals = await run({ kind: "create", type: "daily_reviews", body: review({ totals: { pnl: 10 } }) }, commands);
  assert.equal(withTotals.status, 403);
  assert.match(JSON.stringify(withTotals.body), /"forbidden"/);

  await run({ kind: "create", type: "daily_reviews", body: review() }, commands);
  const withCards = await run({ kind: "update", type: "daily_reviews", id: "review-2026-11-23", body: { cards: [] } }, commands);
  assert.equal(withCards.status, 403);
});

test("the migration is additive: mogmine_ names only, no showmob_ touch, RLS and grants as the journal tables", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.doesNotMatch(sql, /showmob_/i);
  assert.doesNotMatch(sql, /\b(drop|alter\s+user|disable_signup|site_url)\b/i);
  const named = [...sql.matchAll(/public\.([a-z_][a-z0-9_]*)/g)].map((match) => match[1]);
  assert.ok(named.length > 0);
  for (const name of named) assert.ok(name.startsWith("mogmine_"), name);
  assert.ok(isMogmineTable(TABLE));

  assert.match(sql, /MIGRATION NEEDS APPLYING \(apply_migration via Supabase MCP\)/);
  assert.match(sql, /create table public\.mogmine_daily_reviews \(/);
  assert.match(sql, /primary key \(user_id, id\)/);
  assert.match(sql, /session_date text not null generated always as \(record->>'session_date'\) stored/);
  assert.match(sql, /account_id text generated always as \(record->>'account_id'\) stored/);
  assert.match(sql, /create unique index mogmine_daily_reviews_scope_idx on public\.mogmine_daily_reviews \(user_id, session_date, coalesce\(account_id, ''\)\);/);
  assert.match(sql, /alter table public\.mogmine_daily_reviews enable row level security;/);
  assert.match(sql, /revoke all on table public\.mogmine_daily_reviews from anon;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.mogmine_daily_reviews to authenticated, service_role;/);
  assert.match(sql, /using \(user_id = \(select auth\.uid\(\)\) and \(select public\.mogmine_is_allowed\(\)\)\)/);
  assert.match(sql, /create trigger mogmine_daily_reviews_touch before insert or update on public\.mogmine_daily_reviews/);
  assert.match(sql, /create or replace function public\.mogmine_replace_rows\(p_table text, p_rows jsonb\)/);
  assert.match(sql, /'mogmine_daily_reviews'\)/);
});

test("an unapplied migration degrades to unavailable: 42P01 and PGRST205 never read as unknown", () => {
  assert.equal(mapDbError({ code: "42P01", message: 'relation "public.mogmine_daily_reviews" does not exist' }).error.code, "unavailable");
  assert.equal(mapDbError({ code: "PGRST205", message: "Could not find the table in the schema cache" }).error.code, "unavailable");
});

test("with the table not yet applied the device keeps the review and the sync waits (pending), not error", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configureDailyReviewsSyncForTests(options);
  hydrateDailyReviews();
  await sync.pull();

  fake.failNext({ code: "42P01", message: 'relation "public.mogmine_daily_reviews" does not exist' });
  upsertDailyReview(review() as unknown as DailyReview);
  timers.fire();
  await settle();

  assert.equal(sync.getState().status, "pending");
  assert.equal(getDailyReviews().length, 1);
  assert.match(device.get("mogmine-daily-reviews-v1") ?? "", /Wait for the retest/);
});

test("device edits reach mogmine_daily_reviews through the sync layer, scoped to the signed-in owner", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configureDailyReviewsSyncForTests(options);
  hydrateDailyReviews();
  await sync.pull();

  upsertDailyReview(review() as unknown as DailyReview);
  upsertDailyReview(review({ id: "review-2026-11-23-sim-1", account_id: "sim-1" }) as unknown as DailyReview);
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");
  assert.deepEqual(serverIds(fake, TABLE), ["review-2026-11-23", "review-2026-11-23-sim-1"]);
});

test("the command layer refuses a bad date, an over-long lesson or point, a bad time or scope: 422, nothing stored", async () => {
  const commands = setup();
  const cases: Array<[string, Record<string, unknown>]> = [
    ["impossible date", review({ session_date: "2026-02-30" })],
    ["lesson over 500", review({ lesson: "x".repeat(501) })],
    ["point over 500", review({ points: [{ id: "p-1", kind: "mistake", text: "x".repeat(501), trade_id: null }] })],
    ["bad recorded_at", review({ recorded_at: "soon" })],
    ["numeric account", review({ account_id: 7 })],
  ];
  for (const [label, body] of cases) {
    const result = await run({ kind: "create", type: "daily_reviews", body }, commands);
    assert.equal(result.status, 422, label);
  }
  const listed = await commands.list("daily_reviews");
  assert.equal(listed.ok && listed.value.length, 0);
});
