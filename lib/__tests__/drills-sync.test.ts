// #192: drill answers on the sync layer, through the real store (lib/drills-store.ts) and the fake client.
// Answers are append-only, so the cases are add, import, remote, offline and restore (there is no edit or delete).
// Pushes go through the debounce that `changed()` arms (`timers.fire()`), so a missing wire-up fails the test.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DRILLS_STORAGE_KEY, addDrillAnswer, configureDrillsSyncForTests, getDrillsState, hydrateDrills, resetDrillsForTests, restoreDrills,
} from "../drills-store.ts";
import type { DrillRecord } from "../drills.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import {
  UID, adapterFor, installDevice, removeDevice, serverIds, serverRecord, settle, storeSyncOptions, writesOf,
} from "./store-sync-harness.ts";

const TABLE = "mogmine_drills";
const answer = (trade_id: string, at: string): Parameters<typeof addDrillAnswer>[0] => ({
  trade_id, kind: "take_it", answer: "take", hidden: ["bars_after_entry"], answered_at: at,
});
const remote = (id: string, trade_id: string): DrillRecord => ({
  id, user_id: DEFAULT_OWNER_USER_ID, trade_id, kind: "take_it", answer: "pass", answered_at: "2026-11-21T10:00:00.000Z", hidden: ["exit"],
});

afterEach(() => {
  resetDrillsForTests();
  resetSyncRegistryForTests();
  removeDevice();
});

test("disabled: the store makes no adapter calls and keeps working on the device", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake, false);
  const sync = configureDrillsSyncForTests(options);
  hydrateDrills();
  assert.ok(addDrillAnswer(answer("local-trade", "2026-11-20T10:00:00.000Z")));
  timers.fire();
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(timers.live().length, 0);
  assert.equal(sync.getState().status, "off");
  assert.match(device.get(DRILLS_STORAGE_KEY) ?? "", /local-trade/);
});

test("first sign-in imports device answers once; a second pull sends nothing", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  device.set(DRILLS_STORAGE_KEY, JSON.stringify([remote("d-old", "trade-1")]));
  const { options } = storeSyncOptions(fake);
  const sync = configureDrillsSyncForTests(options);
  hydrateDrills();
  await sync.pull();
  assert.deepEqual(serverIds(fake, TABLE), ["d-old"]);

  fake.calls.splice(0);
  await sync.pull();
  assert.deepEqual(writesOf(fake), []);
});

test("every answer reaches the server, including repeat answers on one trade", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configureDrillsSyncForTests(options);
  hydrateDrills();
  await sync.pull();

  assert.ok(addDrillAnswer(answer("trade-1", "2026-11-20T10:00:00.000Z")));
  assert.ok(addDrillAnswer(answer("trade-1", "2026-11-20T10:05:00.000Z")));
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");
  const ids = getDrillsState().records.map((record) => record.id);
  assert.equal(ids.length, 2);
  assert.deepEqual(serverIds(fake, TABLE), [...ids].sort());
  assert.equal(serverRecord(fake, TABLE, ids[0])?.trade_id, "trade-1");
});

test("an answer given on another device appears here", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  await adapterFor(fake).repositories.drills.put(UID, remote("d-remote", "trade-9"));
  const { options } = storeSyncOptions(fake);
  const sync = configureDrillsSyncForTests(options);
  hydrateDrills();
  await sync.pull();

  assert.ok(getDrillsState().records.some((record) => record.id === "d-remote" && record.trade_id === "trade-9"));
});

test("an offline answer stays on this device and goes out on the next flush", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configureDrillsSyncForTests(options);
  hydrateDrills();
  await sync.pull();

  const saved = addDrillAnswer(answer("trade-offline", "2026-11-20T10:00:00.000Z"));
  assert.ok(saved);
  fake.failNext({ message: "fetch failed" });
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "pending");
  assert.match(device.get(DRILLS_STORAGE_KEY) ?? "", /trade-offline/);
  assert.deepEqual(serverIds(fake, TABLE), []);

  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(serverIds(fake, TABLE), [saved.id]);
});

test("restoring a backup pushes the merged answers and removes nothing", async () => {
  installDevice();
  const fake: FakeSupabase = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configureDrillsSyncForTests(options);
  hydrateDrills();
  await sync.pull();
  const mine = addDrillAnswer(answer("trade-1", "2026-11-20T10:00:00.000Z"));
  assert.ok(mine);
  timers.fire();
  await settle();

  restoreDrills([remote("d-backup", "trade-2")]);
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");
  assert.deepEqual(serverIds(fake, TABLE), [mine.id, "d-backup"].sort());
});
