// #192: planning sessions on the sync layer, through the real store (lib/plans-store.ts) and the fake client.
// Pushes go through the debounce that `changed()` arms (`timers.fire()`), so a missing wire-up fails the test.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  PLANS_STORAGE_KEY, addPlan, configurePlansSyncForTests, getPlan, hydratePlans, removePlan, replacePlans,
  resetPlansForTests, restorePlans, setPlanLesson, updatePlan,
} from "../plans-store.ts";
import { newPlanningSession } from "../plans.ts";
import type { PlanningSession } from "../plans.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import {
  UID, adapterFor, installDevice, removeDevice, serverIds, serverRecord, settle, storeSyncOptions, writesOf,
} from "./store-sync-harness.ts";

const TABLE = "mogmine_plans";
const plan = (id: string, observations = "Watch the open"): PlanningSession => newPlanningSession({
  id, session_date: "2026-11-23", name: `Plan ${id}`, preset: null, anchor_time_utc: null, observations, bias: "bullish",
  watch_playbook_ids: [], levels: [], symbol: "MES", now: "2026-11-23T12:00:00.000Z",
});

afterEach(() => {
  resetPlansForTests();
  resetSyncRegistryForTests();
  removeDevice();
});

test("disabled: the store makes no adapter calls and keeps working on the device", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake, false);
  const sync = configurePlansSyncForTests(options);
  hydratePlans();
  addPlan(plan("local-only"));
  timers.fire();
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(timers.live().length, 0);
  assert.equal(sync.getState().status, "off");
  assert.match(device.get(PLANS_STORAGE_KEY) ?? "", /local-only/);
});

test("first sign-in imports device plans once; a second pull sends nothing", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  device.set(PLANS_STORAGE_KEY, JSON.stringify([plan("p1")]));
  const { options } = storeSyncOptions(fake);
  const sync = configurePlansSyncForTests(options);
  hydratePlans();
  await sync.pull();
  assert.deepEqual(serverIds(fake, TABLE), ["p1"]);

  fake.calls.splice(0);
  await sync.pull();
  assert.deepEqual(writesOf(fake), []);
});

test("add, edit, lesson and remove reach the server", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configurePlansSyncForTests(options);
  hydratePlans();
  await sync.pull();

  addPlan(plan("p1"));
  addPlan(plan("p2"));
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");
  assert.deepEqual(serverIds(fake, TABLE), ["p1", "p2"]);

  updatePlan("p1", { observations: "Changed my mind" });
  setPlanLesson("p1", "Wait for the sweep");
  removePlan("p2");
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");

  assert.equal(serverRecord(fake, TABLE, "p1")?.observations, "Changed my mind");
  assert.equal(serverRecord(fake, TABLE, "p1")?.lesson, "Wait for the sweep");
  assert.deepEqual(serverIds(fake, TABLE), ["p1"], "a removed plan is hard-deleted on the server");
  assert.equal(getPlan("p2"), undefined);
});

test("a plan saved on another device appears here", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  await adapterFor(fake).repositories.plans.put(UID, { ...plan("remote-plan", "From the laptop"), user_id: DEFAULT_OWNER_USER_ID });
  const { options } = storeSyncOptions(fake);
  const sync = configurePlansSyncForTests(options);
  hydratePlans();
  await sync.pull();

  assert.equal(getPlan("remote-plan")?.observations, "From the laptop");
});

test("an offline edit stays on this device and goes out on the next flush", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configurePlansSyncForTests(options);
  hydratePlans();
  await sync.pull();

  addPlan(plan("offline"));
  fake.failNext({ message: "fetch failed" });
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "pending");
  assert.ok(getPlan("offline"));
  assert.match(device.get(PLANS_STORAGE_KEY) ?? "", /offline/);
  assert.deepEqual(serverIds(fake, TABLE), []);

  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(serverIds(fake, TABLE), ["offline"]);
});

test("restoring a backup pushes the restored set, removing plans it does not hold", async () => {
  installDevice();
  const fake: FakeSupabase = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configurePlansSyncForTests(options);
  hydratePlans();
  addPlan(plan("keep"));
  addPlan(plan("drop"));
  await sync.pull();
  assert.deepEqual(serverIds(fake, TABLE), ["drop", "keep"]);

  restorePlans([plan("keep"), plan("restored")]);
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");
  assert.deepEqual(serverIds(fake, TABLE), ["keep", "restored"]);

  replacePlans([plan("keep")]);
  timers.fire();
  await settle();
  assert.deepEqual(serverIds(fake, TABLE), ["keep"]);
});
