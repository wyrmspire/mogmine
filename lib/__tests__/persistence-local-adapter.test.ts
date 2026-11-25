// #175: the local and mock adapters pass the shared contract suite, keep the device storage shape the UI already
// reads, fail soft when storage is blocked, and the env flag picks the adapter (missing = today's behaviour).
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { chooseAdapter, createAdapter, createUnavailableAdapter } from "../persistence/select.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { DEFAULT_MOOD_REGISTRY } from "../mood.ts";
import { runPersistenceContractSuite, sampleTrade } from "./persistence-contract-suite.ts";

const mock = () => createLocalAdapter({ kind: "mock", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
runPersistenceContractSuite("mock adapter", mock);

const device = () => createLocalAdapter({ kind: "local", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
runPersistenceContractSuite("local adapter", device);

const blockedStore: KeyValueStore = {
  getItem: () => { throw new Error("SecurityError: storage blocked"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

test("local: blocked storage fails soft with unavailable, never throws", async () => {
  const { repositories: repo } = createLocalAdapter({ kind: "local", store: blockedStore, candles: createMemoryCandleStore() });
  const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
  assert.equal(listed.ok, false);
  if (!listed.ok) assert.equal(listed.error.code, "unavailable");
  const put = await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
  assert.equal(put.ok, false);
  if (!put.ok) assert.equal(put.error.code, "unavailable");
});

test("local: writes use the keys and shapes the UI stores already read", async () => {
  const store = createMemoryKeyValueStore();
  const { repositories: repo } = createLocalAdapter({ kind: "local", store, candles: createMemoryCandleStore() });
  await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
  const trades = JSON.parse(store.getItem("mogmine-trades-v3") ?? "null") as Array<{ id: string }>;
  assert.deepEqual(trades.map((trade) => trade.id), ["t-1"]);

  await repo.mood_registry.put(DEFAULT_OWNER_USER_ID, DEFAULT_MOOD_REGISTRY);
  await repo.prefs.put(DEFAULT_OWNER_USER_ID, {
    shield: true, goldPreset: "bullion", goldIntensity: 0.5, boxOpacity: 0.4, palette: "classic",
    timeZone: "America/New_York", showSamples: true, blindReview: false, riskBudgetUsd: 100,
    vwapAnchor: "off", levelLabels: "tap", ema200: false, reviewCardOrientation: "portrait",
  });
  const mood = JSON.parse(store.getItem("mogmine-mood-v1") ?? "null") as Record<string, unknown>;
  assert.ok(mood.registry && typeof mood.registry === "object", "registry kept in the mood blob");
  assert.ok(JSON.parse(store.getItem("mogmine-prefs-v1") ?? "null").shield === true);
});

test("local: unreadable stored JSON is invalid and is not overwritten", async () => {
  const store = createMemoryKeyValueStore({ "mogmine-trades-v3": "{not json" });
  const { repositories: repo } = createLocalAdapter({ kind: "local", store, candles: createMemoryCandleStore() });
  const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
  assert.equal(listed.ok, false);
  if (!listed.ok) assert.equal(listed.error.code, "invalid");
  const put = await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
  assert.equal(put.ok, false);
  assert.equal(store.getItem("mogmine-trades-v3"), "{not json");
});

test("local: parentId filters children; drills and balance checks keep their parent", async () => {
  const { repositories: repo } = device();
  await repo.balance_checks.put(DEFAULT_OWNER_USER_ID, { id: "c-1", account_id: "acct-a", at: "2026-11-02T15:00:00.000Z", balance_cents: 5_000_00, note: "" });
  await repo.balance_checks.put(DEFAULT_OWNER_USER_ID, { id: "c-2", account_id: "acct-b", at: "2026-11-02T16:00:00.000Z", balance_cents: 4_000_00, note: "" });
  const listed = await repo.balance_checks.list(DEFAULT_OWNER_USER_ID, { parentId: "acct-a" });
  assert.ok(listed.ok);
  assert.deepEqual(listed.value.map((check) => check.id), ["c-1"]);
});

test("select: missing, empty, local/mock and unknown values keep the device adapter", () => {
  assert.equal(chooseAdapter(undefined), "local");
  assert.equal(chooseAdapter(""), "local");
  assert.equal(chooseAdapter("local/mock"), "local");
  assert.equal(chooseAdapter("something-else"), "local");
  assert.equal(chooseAdapter("mock"), "mock");
  assert.equal(chooseAdapter(" MOCK "), "mock");
  assert.equal(chooseAdapter("supabase"), "supabase");
});

test("select: supabase without env vars answers unavailable and never falls back to the device", async () => {
  const adapter = createAdapter("supabase");
  assert.equal(adapter.kind, "supabase");
  assert.equal(await adapter.currentOwner(), null);
  const listed = await adapter.repositories.trades.list(DEFAULT_OWNER_USER_ID);
  assert.equal(listed.ok, false);
  if (!listed.ok) assert.equal(listed.error.code, "unavailable");
  assert.equal(createUnavailableAdapter().kind, "supabase");
});

test("select: the mock choice never touches device storage", async () => {
  const adapter = createAdapter("mock");
  assert.equal(adapter.kind, "mock");
  await adapter.repositories.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
  const listed = await adapter.repositories.trades.list(DEFAULT_OWNER_USER_ID);
  assert.ok(listed.ok);
  assert.equal(listed.value.length, 1);
});
