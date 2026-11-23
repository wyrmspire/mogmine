// #193: discretionary calls and prompt dismissals on the sync layer, against the fake Supabase client (no network).
// Covers the wiring in lib/calls-store.ts: syncers start on hydrate (also when addCall hydrates lazily), every
// persisted mutation calls changed(), and restoreCalls keeps its merge-by-id rule.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  addCall, addDismissal, configureCallsSyncForTests, getCallsState, hydrateCalls, removeCall, resetCallsForTests,
  restoreCalls, sanitizeCall, sanitizeDismissal, updateCall,
} from "../calls-store.ts";
import type { CallDraft } from "../calls-store.ts";
import { reasonChipsFor } from "../calls.ts";
import type { DiscretionCall, PromptDismissal } from "../calls.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { PersistenceAdapter } from "../persistence/contract.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import type { CollectionSync } from "../persistence/store-sync.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-11-23T12:00:00.000Z";
const CALLS_KEY = "mogmine-calls-v1";
const thesis = reasonChipsFor("cut")[0];

const draft = (over: Partial<CallDraft> = {}): CallDraft => ({
  kind: "cut", made_at: "2026-11-20T15:00:00Z", recorded_at: "2026-11-20T15:01:00Z", trade_id: "t1", plan_session_id: null,
  playbook_id: "orb-reclaim", price: 7600.25, price_ticks: 30401, signal_direction: null,
  reasons: [{ id: thesis.id, label: thesis.label, family: thesis.family }], note: "Stalled at VWAP", conviction: 2,
  prompt_id: null, prompt_question: "Why out before stop or target?", origin: "manual", trigger: null, rule: null, made_at_basis: "exact",
  ...over,
});

/** A saved call as an older session left it on this device. */
function callRecord(id: string, over: Partial<CallDraft> = {}): DiscretionCall {
  const call = sanitizeCall({ ...draft(over), id, user_id: "demo-owner", recorded_at: "2026-11-20T15:01:00.000Z" });
  assert.ok(call, `fixture call ${id} is valid`);
  return call;
}

function dismissalRecord(id: string, tradeId = "t1"): PromptDismissal {
  const dismissal = sanitizeDismissal({ id, user_id: "demo-owner", trade_id: tradeId, prompt_id: "seed:cut", deviation: null, reason: "later", recorded_at: NOW });
  assert.ok(dismissal, `fixture dismissal ${id} is valid`);
  return dismissal;
}

/** The device's localStorage, backed by a plain Map so tests can seed and read it. */
const device = new Map<string, string>();
const deviceStorage = {
  getItem: (key: string) => device.get(key) ?? null,
  setItem: (key: string, value: string) => { device.set(key, value); },
  removeItem: (key: string) => { device.delete(key); },
  clear() { device.clear(); },
  key: () => null,
  length: 0,
};

function useWindow() {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: deviceStorage });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage: deviceStorage, addEventListener() {}, removeEventListener() {} },
  });
}

/** A manual timer queue: nothing fires until the test says so. */
function manualTimers() {
  const timers: { fn: () => void; cancelled: boolean }[] = [];
  return {
    setTimer: (fn: () => void) => {
      const timer = { fn, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle: unknown) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    live: () => timers.filter((timer) => !timer.cancelled),
    fire: () => {
      for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
    },
  };
}

function seedDevice(calls: DiscretionCall[] = [], dismissals: PromptDismissal[] = []) {
  device.set(CALLS_KEY, JSON.stringify({ calls, dismissals }));
}

interface Session {
  fake: FakeSupabase;
  adapter: PersistenceAdapter;
  calls: CollectionSync;
  dismissals: CollectionSync;
  timers: ReturnType<typeof manualTimers>;
}

/** Reset the store, point its syncers at the fake server, and hydrate from the seeded device data. */
async function boot(enabled = true): Promise<Session> {
  resetCallsForTests();
  const fake = createFakeSupabase(UID);
  const adapter = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const timers = manualTimers();
  const common = {
    enabled,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => Date.parse(NOW),
  };
  const syncs = configureCallsSyncForTests({ calls: common, dismissals: common });
  hydrateCalls();
  await syncs.calls.pull();
  await syncs.dismissals.pull();
  return { fake, adapter, calls: syncs.calls, dismissals: syncs.dismissals, timers };
}

const rowsOf = (fake: FakeSupabase, table: string) => (fake.tables.get(table) ?? []).filter((row) => row.user_id === UID);
const serverCallIds = (fake: FakeSupabase) => rowsOf(fake, "mogmine_calls").map((row) => String(row.id)).sort();
const serverDismissalIds = (fake: FakeSupabase) => rowsOf(fake, "mogmine_prompt_dismissals").map((row) => String(row.id)).sort();
const serverNote = (fake: FakeSupabase, id: string) => (rowsOf(fake, "mogmine_calls").find((row) => row.id === id)?.record as { note?: string } | undefined)?.note;
/** Every call that changed the server (reads are `select`). */
const writesOf = (fake: FakeSupabase) => fake.calls.filter((call) => !call.startsWith("select"));

afterEach(() => {
  resetCallsForTests();
  resetSyncRegistryForTests();
  device.clear();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("disabled: no adapter calls, no timers, status off, and the device copy still works", async () => {
  useWindow();
  const session = await boot(false);
  const added = addCall(draft());
  addDismissal({ trade_id: "t1", prompt_id: "seed:cut", deviation: null, reason: "later" });

  assert.ok(added);
  assert.deepEqual(session.fake.calls, []);
  assert.equal(session.timers.live().length, 0);
  assert.equal(session.calls.getState().status, "off");
  assert.equal(getCallsState().calls.length, 1);
  assert.equal(JSON.parse(device.get(CALLS_KEY) ?? "{}").calls.length, 1, "device cache written first");
});

test("first sign-in imports the device's calls and dismissals once; a second pull sends nothing", async () => {
  useWindow();
  seedDevice([callRecord("call-a")], [dismissalRecord("dismiss-a")]);
  const session = await boot();

  assert.deepEqual(serverCallIds(session.fake), ["call-a"]);
  assert.deepEqual(serverDismissalIds(session.fake), ["dismiss-a"]);
  const writes = writesOf(session.fake).length;
  await session.calls.pull();
  await session.dismissals.pull();
  assert.equal(writesOf(session.fake).length, writes, "nothing new to send");
});

test("addCall, updateCall and removeCall reach the server with the right rows", async () => {
  useWindow();
  const session = await boot();
  const added = addCall(draft({ note: "first note" }));
  assert.ok(added);
  session.timers.fire();
  assert.equal(await session.calls.flushNow(), true);
  assert.deepEqual(serverCallIds(session.fake), [added.id]);

  updateCall(added.id, { note: "edited note" });
  session.timers.fire();
  assert.equal(await session.calls.flushNow(), true);
  assert.equal(serverNote(session.fake, added.id), "edited note");

  removeCall(added.id);
  session.timers.fire();
  assert.equal(await session.calls.flushNow(), true);
  assert.deepEqual(serverCallIds(session.fake), []);
});

test("addDismissal reaches the server as a prompt dismissal row", async () => {
  useWindow();
  const session = await boot();
  const dismissal = addDismissal({ trade_id: "t1", prompt_id: "seed:cut", deviation: null, reason: "not_a_call" });
  assert.ok(dismissal);
  session.timers.fire();
  assert.equal(await session.dismissals.flushNow(), true);

  assert.deepEqual(serverDismissalIds(session.fake), [dismissal.id]);
  assert.equal(session.calls.getState().status, "synced", "calls syncer has nothing to send");
});

test("a call made on another device appears locally after a pull", async () => {
  useWindow();
  const session = await boot();
  await session.adapter.repositories.calls.put(UID, callRecord("call-remote", { note: "from the phone" }));
  await session.calls.pull();

  assert.ok(getCallsState().calls.some((call) => call.id === "call-remote" && call.note === "from the phone"));
});

test("a call edited offline stays on the device, shows pending, and goes out on the next flush", async () => {
  useWindow();
  seedDevice([callRecord("call-a")]);
  const session = await boot();
  updateCall("call-a", { note: "written on the train" });
  session.fake.failNext({ message: "fetch failed" });

  assert.equal(await session.calls.flushNow(), false);
  assert.equal(session.calls.getState().status, "pending");
  assert.equal(getCallsState().calls[0].note, "written on the train", "the local edit survives");
  assert.equal(serverNote(session.fake, "call-a"), "Stalled at VWAP");

  assert.equal(await session.calls.flushNow(), true);
  assert.equal(serverNote(session.fake, "call-a"), "written on the train");
});

test("restoreCalls pushes the restored calls and keeps this device's own copies (merge by id)", async () => {
  useWindow();
  seedDevice([callRecord("call-here")]);
  const session = await boot();
  restoreCalls({ calls: [callRecord("call-backup")], dismissals: [dismissalRecord("dismiss-backup")] });
  session.timers.fire();
  assert.equal(await session.calls.flushNow(), true);
  assert.equal(await session.dismissals.flushNow(), true);

  assert.deepEqual(serverCallIds(session.fake), ["call-backup", "call-here"]);
  assert.deepEqual(serverDismissalIds(session.fake), ["dismiss-backup"]);
});
