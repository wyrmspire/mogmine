// #191: the singleton sync layer (one prefs document per owner) against the fake Supabase client. Every branch of the
// pull and push in lib/persistence/singleton-sync.ts has a test here. The store wiring is in prefs-sync.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSingletonSync } from "../persistence/singleton-sync.ts";
import type { SingletonSync } from "../persistence/singleton-sync.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { PersistenceAdapter, SingletonRepository } from "../persistence/contract.ts";
import { DEFAULT_PREFS, sanitize } from "../prefs-sanitize.ts";
import type { Prefs } from "../prefs-sanitize.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { manualTimers, rowsIn, settle, writesOf } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER_UID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const BASE_KEY = "mogmine-sync-v1:base:prefs";
const OWNER_KEY = "mogmine-sync-v1:owner:prefs";
const ORPHAN_KEY = `mogmine-sync-v1:orphan:prefs:${OTHER_UID}`;

const prefs = (patch: Partial<Prefs> = {}): Prefs => sanitize({ ...DEFAULT_PREFS, ...patch });
const direct = (fake: FakeSupabase): SingletonRepository<Prefs> =>
  createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.prefs as unknown as SingletonRepository<Prefs>;
const serverPrefs = (fake: FakeSupabase, owner = UID) =>
  (rowsIn(fake, "mogmine_user_prefs").find((row) => row.user_id === owner)?.record ?? null) as Prefs | null;

interface Harness {
  sync: SingletonSync;
  timers: ReturnType<typeof manualTimers>;
  storage: KeyValueStore;
  value: () => Prefs;
  set: (next: Prefs) => void;
}

/** `unedited: null` leaves the option out, which is the brief's plain rule (no base means dirty). */
function harness(options: {
  fake: FakeSupabase;
  initial?: Prefs;
  storage?: KeyValueStore;
  adapter?: PersistenceAdapter;
  enabled?: boolean;
  unedited?: Prefs | null;
}): Harness {
  let value: Prefs = options.initial ?? DEFAULT_PREFS;
  const timers = manualTimers();
  const storage = options.storage ?? createMemoryKeyValueStore();
  const adapter = options.adapter ?? createSupabaseAdapter({ client: options.fake, candles: createMemoryCandleStore() });
  const unedited = options.unedited === null ? undefined : (options.unedited ?? DEFAULT_PREFS);
  const sync = createSingletonSync<Prefs>({
    key: "prefs",
    getLocal: () => value,
    apply: (next) => { value = next; },
    unedited,
    adapter: () => adapter,
    storage,
    enabled: options.enabled ?? true,
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { sync, timers, storage, value: () => value, set: (next) => { value = next; } };
}

test("disabled: no adapter calls, no timers, status off", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, enabled: false, initial: prefs({ goldPreset: "amber" }) });
  h.sync.start();
  await h.sync.pull();
  h.sync.changed();
  assert.equal(await h.sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(h.sync.getState().status, "off");
  assert.equal(h.timers.live().length, 0);
  assert.equal(h.value().goldPreset, "amber");
});

test("signed out: status signed-out, nothing written, device value untouched", async () => {
  const fake = createFakeSupabase(null);
  const h = harness({ fake, initial: prefs({ goldPreset: "amber" }) });
  h.sync.start();
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "signed-out");
  assert.equal(await h.sync.flushNow(), false);
  assert.deepEqual(writesOf(fake), []);
  assert.equal(h.value().goldPreset, "amber");
});

test("first sign-in imports the device value once; a second pull sends nothing", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: prefs({ goldPreset: "champagne" }) });
  h.sync.start();
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "synced");
  assert.equal(serverPrefs(fake)?.goldPreset, "champagne");
  const sent = writesOf(fake).length;
  await h.sync.pull();
  assert.equal(writesOf(fake).length, sent, "nothing new to send");
  assert.equal(h.value().goldPreset, "champagne");
});

test("a clean device copy takes the newer server copy", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake });
  await h.sync.pull(); // imports the defaults: the base now matches the device
  await direct(fake).put(UID, prefs({ riskBudgetUsd: 400 })); // edited on another device
  await h.sync.pull();
  assert.equal(h.value().riskBudgetUsd, 400);
  assert.equal(h.sync.getState().status, "synced");
});

test("a dirty device copy is kept and pushed over a newer server copy", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake });
  await h.sync.pull();
  h.set(prefs({ goldPreset: "amber" })); // edited here since the last pull
  await direct(fake).put(UID, prefs({ riskBudgetUsd: 400 }));
  await h.sync.pull();
  assert.equal(h.value().goldPreset, "amber");
  assert.equal(serverPrefs(fake)?.goldPreset, "amber");
});

test("a fresh device with untouched defaults adopts the server copy instead of overwriting it", async () => {
  const fake = createFakeSupabase(UID);
  await direct(fake).put(UID, prefs({ riskBudgetUsd: 400 }));
  const sent = writesOf(fake).length;
  const h = harness({ fake }); // no base yet, and the device holds the defaults
  await h.sync.pull();
  assert.equal(h.value().riskBudgetUsd, 400);
  assert.equal(writesOf(fake).length, sent, "the defaults were not pushed");
});

test("a fresh device with edited prefs keeps them and pushes over the server copy", async () => {
  const fake = createFakeSupabase(UID);
  await direct(fake).put(UID, prefs({ riskBudgetUsd: 400 }));
  const h = harness({ fake, initial: prefs({ goldPreset: "amber" }) });
  await h.sync.pull();
  assert.equal(h.value().goldPreset, "amber");
  assert.equal(serverPrefs(fake)?.goldPreset, "amber");
});

test("without an unedited value, a fresh device's defaults are dirty and are pushed (the plain rule)", async () => {
  const fake = createFakeSupabase(UID);
  await direct(fake).put(UID, prefs({ riskBudgetUsd: 400 }));
  const h = harness({ fake, unedited: null });
  await h.sync.pull();
  assert.equal(serverPrefs(fake)?.riskBudgetUsd, DEFAULT_PREFS.riskBudgetUsd);
  assert.equal(h.value().riskBudgetUsd, DEFAULT_PREFS.riskBudgetUsd);
});

test("another user's device value is kept under their id, never pushed; the server copy wins", async () => {
  const fake = createFakeSupabase(UID);
  await direct(fake).put(UID, prefs({ riskBudgetUsd: 400 }));
  const sent = writesOf(fake).length;
  const h = harness({ fake, storage: createMemoryKeyValueStore({ [OWNER_KEY]: OTHER_UID }), initial: prefs({ goldPreset: "amber" }) });
  await h.sync.pull();
  assert.equal(h.value().riskBudgetUsd, 400);
  assert.equal(writesOf(fake).length, sent, "another user's value is never pushed");
  assert.ok(h.storage.getItem(ORPHAN_KEY)?.includes('"goldPreset":"amber"'), "their copy is kept");
});

test("another user's value with nothing on the server stays on the device and is not pushed, now or on later pulls", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, storage: createMemoryKeyValueStore({ [OWNER_KEY]: OTHER_UID }), initial: prefs({ goldPreset: "amber" }) });
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "synced");
  assert.deepEqual(writesOf(fake), []);
  assert.equal(h.value().goldPreset, "amber");
  assert.equal(h.storage.getItem(OWNER_KEY), UID, "the device now belongs to this owner");
  await h.sync.pull();
  assert.deepEqual(writesOf(fake), [], "a later pull does not push it either");
});

test("an offline edit stays on the device and is sent on the next flush", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake });
  await h.sync.pull();
  h.set(prefs({ boxOpacity: 0.4 }));
  fake.failNext({ message: "fetch failed" });
  assert.equal(await h.sync.flushNow(), false);
  assert.equal(h.sync.getState().status, "pending");
  assert.equal(h.value().boxOpacity, 0.4);
  assert.equal(serverPrefs(fake)?.boxOpacity, DEFAULT_PREFS.boxOpacity);
  assert.equal(await h.sync.flushNow(), true);
  assert.equal(serverPrefs(fake)?.boxOpacity, 0.4);
});

test("a record the server refuses is an error, not a retry loop", async () => {
  const fake = createFakeSupabase(UID);
  const real = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const refusing = {
    ...real,
    repositories: {
      ...real.repositories,
      prefs: {
        ...real.repositories.prefs,
        put: async () => ({ ok: false as const, error: { code: "invalid" as const, message: "This record did not pass validation." } }),
      },
    },
  } as unknown as PersistenceAdapter;
  const h = harness({ fake, adapter: refusing, initial: prefs({ goldPreset: "amber" }) });
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "error");
  assert.equal(h.timers.live().length, 0, "no retry is scheduled for a refused record");
});

test("garbage sync metadata reads as no base, so the first import still runs", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({
    fake,
    storage: createMemoryKeyValueStore({ [BASE_KEY]: "{not json", [OWNER_KEY]: UID }),
    initial: prefs({ goldPreset: "platinum" }),
  });
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "synced");
  assert.equal(serverPrefs(fake)?.goldPreset, "platinum");
});

test("changed() waits for the debounce, then makes one push", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake });
  await h.sync.pull();
  const sent = writesOf(fake).length;
  h.set(prefs({ palette: "blue-orange" }));
  h.sync.changed();
  h.sync.changed();
  assert.equal(h.timers.live().length, 1, "two edits share one debounce timer");
  h.timers.fire();
  await settle();
  assert.equal(writesOf(fake).length, sent + 1);
  assert.equal(serverPrefs(fake)?.palette, "blue-orange");
});
