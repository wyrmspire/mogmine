// #193: mood records and candidate spokes on the sync layer, against the fake Supabase client (no network).
// Covers the wiring in lib/mood-store.ts: syncers start on hydrate, every persisted mutation calls changed(),
// and apply() keeps suggestions and the spoke registry on this device.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_MOOD_REGISTRY, userMoodRecord } from "../mood.ts";
import type { MoodRecord } from "../mood.ts";
import {
  configureMoodSyncForTests, dismissCandidate, getMoodBackup, getMoodState, hydrateMood, recordUserMood, resetMoodForTests,
  restoreMood, setSpokeScore, undoMoodRecord,
} from "../mood-store.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { PersistenceAdapter } from "../persistence/contract.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import type { CollectionSync } from "../persistence/store-sync.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-11-23T12:00:00.000Z";
const STORAGE_KEY = "mogmine-mood-v1";

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

const record = (id: string, tradeId = "t1", scores: Record<string, number | null> = { calm: 0.8 }): MoodRecord =>
  userMoodRecord({ id, trade_id: tradeId, now: NOW, captured_at: null, recorded_at: NOW }, DEFAULT_MOOD_REGISTRY, scores);

/** Device data as an older session left it. Candidate ids are derived from labels when read. */
function seedDevice(records: MoodRecord[] = [], candidates: object[] = [], suggestions: Record<string, unknown> = {}) {
  device.set(STORAGE_KEY, JSON.stringify({ registry: DEFAULT_MOOD_REGISTRY, records, suggestions, candidates }));
}

interface Session {
  fake: FakeSupabase;
  adapter: PersistenceAdapter;
  records: CollectionSync;
  candidates: CollectionSync;
  timers: ReturnType<typeof manualTimers>;
}

/** Reset the store, point its syncers at the fake server, and hydrate from the seeded device data. */
async function boot(enabled = true): Promise<Session> {
  resetMoodForTests({ hydrated: false });
  const fake = createFakeSupabase(UID);
  const adapter = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const timers = manualTimers();
  const storage = createMemoryKeyValueStore();
  const common = {
    enabled,
    adapter: () => adapter,
    storage,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => Date.parse(NOW),
  };
  const syncs = configureMoodSyncForTests({ records: common, candidates: common });
  hydrateMood();
  await syncs.records.pull();
  await syncs.candidates.pull();
  return { fake, adapter, records: syncs.records, candidates: syncs.candidates, timers };
}

const rowsOf = (fake: FakeSupabase, table: string) => (fake.tables.get(table) ?? []).filter((row) => row.user_id === UID);
const serverMoodIds = (fake: FakeSupabase) => rowsOf(fake, "mogmine_mood_records").map((row) => String(row.id)).sort();
const serverCandidateIds = (fake: FakeSupabase) => rowsOf(fake, "mogmine_mood_candidates").map((row) => String(row.id)).sort();
/** Every call that changed the server (reads are `select`). */
const writesOf = (fake: FakeSupabase) => fake.calls.filter((call) => !call.startsWith("select"));

afterEach(() => {
  resetMoodForTests();
  resetSyncRegistryForTests();
  device.clear();
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("disabled: no adapter calls, no timers, status off, and the device copy still works", async () => {
  useWindow();
  const session = await boot(false);
  recordUserMood("t1", { calm: 0.8 }, NOW, null, NOW);
  setSpokeScore("t1", "calm", 0.4, NOW, null, NOW);

  assert.deepEqual(session.fake.calls, []);
  assert.equal(session.timers.live().length, 0);
  assert.equal(session.records.getState().status, "off");
  assert.equal(getMoodState().records.length, 2);
  assert.equal(JSON.parse(device.get(STORAGE_KEY) ?? "{}").records.length, 2, "device cache written first");
});

test("first sign-in imports the device's records and candidates once; a second pull sends nothing", async () => {
  useWindow();
  seedDevice([record("m1"), record("m2", "t2")], [{ label: "Patience", trade_ids: ["t1"], first_seen: NOW, last_seen: NOW }]);
  const session = await boot();

  assert.deepEqual(serverMoodIds(session.fake), ["m1", "m2"]);
  assert.equal(serverCandidateIds(session.fake).length, 1);
  const writes = writesOf(session.fake).length;
  await session.records.pull();
  await session.candidates.pull();
  assert.equal(writesOf(session.fake).length, writes, "nothing new to send");
});

test("recordUserMood and setSpokeScore reach the server; undoMoodRecord removes the row there", async () => {
  useWindow();
  const session = await boot();
  const first = recordUserMood("t1", { calm: 0.8 }, NOW, null, NOW);
  const second = setSpokeScore("t1", "calm", 0.4, NOW, null, NOW);
  session.timers.fire();
  assert.equal(await session.records.flushNow(), true);
  assert.deepEqual(serverMoodIds(session.fake), [first.id, second.id].sort());
  const row = rowsOf(session.fake, "mogmine_mood_records").find((item) => item.id === second.id);
  assert.equal((row?.record as { trade_id?: string } | undefined)?.trade_id, "t1");

  undoMoodRecord(first.id);
  session.timers.fire();
  assert.equal(await session.records.flushNow(), true);
  assert.deepEqual(serverMoodIds(session.fake), [second.id]);
});

test("dismissCandidate reaches the server as the candidate row with dismissed set", async () => {
  useWindow();
  seedDevice([], [{ label: "Patience", trade_ids: ["t1"], first_seen: NOW, last_seen: NOW }]);
  const session = await boot();
  const [candidate] = getMoodState().candidates;
  dismissCandidate(candidate.id);
  session.timers.fire();
  assert.equal(await session.candidates.flushNow(), true);

  const row = rowsOf(session.fake, "mogmine_mood_candidates").find((item) => item.id === candidate.id);
  assert.equal((row?.record as { dismissed?: boolean } | undefined)?.dismissed, true);
});

test("a mood record added on another device appears locally after a pull", async () => {
  useWindow();
  const session = await boot();
  await session.adapter.repositories.mood_records.put(UID, record("remote-1", "t9"));
  await session.records.pull();

  assert.ok(getMoodState().records.some((item) => item.id === "remote-1" && item.trade_id === "t9"));
});

test("a change made offline stays on the device, shows pending, and goes out on the next flush", async () => {
  useWindow();
  const session = await boot();
  const added = recordUserMood("t1", { calm: 0.8 }, NOW, null, NOW);
  session.fake.failNext({ message: "fetch failed" });

  assert.equal(await session.records.flushNow(), false);
  assert.equal(session.records.getState().status, "pending");
  assert.equal(getMoodState().records.length, 1, "kept on this device");
  assert.deepEqual(serverMoodIds(session.fake), []);

  assert.equal(await session.records.flushNow(), true);
  assert.deepEqual(serverMoodIds(session.fake), [added.id]);
});

test("restoreMood pushes the restored set and removes server records the backup does not have", async () => {
  useWindow();
  seedDevice([record("old-1")]);
  const session = await boot();
  assert.deepEqual(serverMoodIds(session.fake), ["old-1"]);

  restoreMood({ registry: DEFAULT_MOOD_REGISTRY, records: [record("new-1", "t3")], candidates: [] });
  session.timers.fire();
  assert.equal(await session.records.flushNow(), true);

  assert.deepEqual(serverMoodIds(session.fake), ["new-1"]);
  assert.deepEqual(getMoodBackup().records.map((item) => item.id), ["new-1"]);
});

test("a pull that changes records keeps pending suggestions and the spoke registry on this device", async () => {
  useWindow();
  const suggestion = {
    trade_id: "t1", spoke_set_version: 1, scores: { calm: 0.5 }, evidence: {}, candidates: [],
    model: "local", captured_at: null, created_at: NOW,
  };
  seedDevice([], [], { t1: suggestion });
  const session = await boot();
  await session.adapter.repositories.mood_records.put(UID, record("remote-2", "t9"));
  await session.records.pull();

  assert.ok(getMoodState().records.some((item) => item.id === "remote-2"));
  assert.equal(getMoodState().suggestions.t1?.scores.calm, 0.5, "suggestions are not replaced by apply()");
  assert.deepEqual(getMoodState().registry, DEFAULT_MOOD_REGISTRY);
  const stored = JSON.parse(device.get(STORAGE_KEY) ?? "{}") as { suggestions?: Record<string, unknown> };
  assert.ok(stored.suggestions?.t1, "the device cache keeps the suggestion too");
});
