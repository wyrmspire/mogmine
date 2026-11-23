// Review of #174 + #175: the command layer driven over the real local/mock adapter, not a stand-in, so the two
// implement the contract the same way (owner stamping, optimistic concurrency, archive policy, cascades, singletons).
import test from "node:test";
import assert from "node:assert/strict";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";

function setup(seed: Record<string, string> = {}) {
  const store: KeyValueStore = createMemoryKeyValueStore(seed);
  const adapter = createLocalAdapter({ kind: "mock", store, candles: createMemoryCandleStore() });
  return { store, commands: createJournalCommands(adapter.repositories) };
}

const trade = (over: Record<string, unknown> = {}) => ({
  id: "t-1", symbol: "MES", direction: "LONG", quantity: 1,
  entry_time: "2026-11-20T15:00:00Z", exit_time: "2026-11-20T15:30:00Z",
  entry_price: 7600.25, exit_price: 7602.25, stop_loss_price: 7598.25,
  ...over,
});

test("create, update and list a trade through the local adapter, stored under the device key", async () => {
  const { store, commands } = setup();
  const created = await commands.create("trades", trade());
  assert.ok(created.ok, created.ok ? "" : created.error.message);
  assert.equal(created.value.record.user_id, DEFAULT_OWNER_USER_ID);
  const updated = await commands.update("trades", "t-1", { note: "held the shelf" });
  assert.ok(updated.ok, updated.ok ? "" : updated.error.message);
  assert.equal(updated.value.record.note, "held the shelf");
  const raw = JSON.parse(store.getItem("mogmine-trades-v3") ?? "[]") as { id: string; note?: string }[];
  assert.deepEqual(raw.map((row) => [row.id, row.note]), [["t-1", "held the shelf"]]);
  const listed = await commands.list("trades");
  assert.equal(listed.ok && listed.value.length, 1);
});

test("a row the UI wrote directly can still be updated (epoch meta matches the expected updated_at)", async () => {
  const { commands: seedCommands, store: seedStore } = setup();
  await seedCommands.create("trades", trade());
  const { commands } = setup({ "mogmine-trades-v3": seedStore.getItem("mogmine-trades-v3") ?? "[]" });
  const updated = await commands.update("trades", "t-1", { note: "from the UI" });
  assert.ok(updated.ok, updated.ok ? "" : updated.error.message);
});

test("an invalid patch fails closed and leaves the stored trade untouched", async () => {
  const { store, commands } = setup();
  await commands.create("trades", trade());
  const before = store.getItem("mogmine-trades-v3");
  const bad = await commands.update("trades", "t-1", { stop_loss_price: 7605 });
  assert.equal(!bad.ok && bad.error.code, "invalid");
  assert.equal(store.getItem("mogmine-trades-v3"), before);
});

test("accounts archive through the adapter and cannot be removed by either layer", async () => {
  const { commands } = setup();
  const account = { id: "acc-1", name: "Eval 50K", starting_balance_cents: 5_000_000, rules: {}, created_at: "2026-11-20T00:00:00Z", archived: false };
  assert.equal((await commands.create("accounts", account)).ok, true);
  const removed = await commands.remove("accounts", "acc-1");
  assert.equal(!removed.ok && removed.error.code, "forbidden");
  const archived = await commands.archive("accounts", "acc-1");
  assert.equal(archived.ok && archived.value.record.archived, true);
  const active = await commands.list("accounts", { includeArchived: false });
  assert.equal(active.ok && active.value.length, 0);
});

test("removing a trade cascades its drills through the adapter parent link and keeps other trades children", async () => {
  const { commands } = setup();
  await commands.create("trades", trade());
  await commands.create("trades", trade({ id: "t-2" }));
  const drill = (id: string, tradeId: string) => ({ id, trade_id: tradeId, kind: "take_it", answer: "take", answered_at: "2026-11-20T16:00:00Z", hidden: [] });
  assert.equal((await commands.create("drills", drill("d-1", "t-1"))).ok, true);
  assert.equal((await commands.create("drills", drill("d-2", "t-2"))).ok, true);
  assert.equal((await commands.remove("trades", "t-1")).ok, true);
  assert.equal((await commands.read("drills", "d-1")).ok, false);
  assert.equal((await commands.read("drills", "d-2")).ok, true);
  assert.equal((await commands.read("trades", "t-2")).ok, true);
});

test("prefs singleton round-trips through the device key", async () => {
  const { store, commands } = setup();
  const before = await commands.readSingleton("prefs");
  assert.equal(before.ok && before.value, null);
  const written = await commands.writeSingleton("prefs", { shield: true });
  assert.equal(written.ok && written.value.record.shield, true);
  assert.equal((JSON.parse(store.getItem("mogmine-prefs-v1") ?? "{}") as { shield?: boolean }).shield, true);
  const read = await commands.readSingleton("prefs");
  assert.equal(read.ok && read.value?.record.shield, true);
});
