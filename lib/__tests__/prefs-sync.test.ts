// #191: the preferences store on the singleton syncer (lib/prefs.ts). The device cache is written first; sync is
// background only. Prefs sync across devices on purpose, so a fresh device adopts the server copy.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_PREFS, PREFS_KEY, configurePrefsSyncForTests, getPrefs, hydratePrefs, resetPrefsForTests, setPrefs } from "../prefs.ts";
import type { Prefs } from "../prefs.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { SingletonRepository } from "../persistence/contract.ts";
import { sanitize } from "../prefs-sanitize.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { installDevice, manualTimers, rowsIn, settle, writesOf } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");

const prefs = (patch: Partial<Prefs> = {}): Prefs => sanitize({ ...DEFAULT_PREFS, ...patch });
const serverPrefs = (fake: FakeSupabase) => (rowsIn(fake, "mogmine_user_prefs").find((row) => row.user_id === UID)?.record ?? null) as Prefs | null;
const direct = (fake: FakeSupabase) =>
  createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.prefs as unknown as SingletonRepository<Prefs>;
const cached = (device: ReturnType<typeof installDevice>) => JSON.parse(device.memory.get(PREFS_KEY) ?? "null") as Prefs | null;

let device: ReturnType<typeof installDevice> | null = null;

afterEach(() => {
  resetPrefsForTests();
  device?.uninstall();
  device = null;
});

/** Install a device (optionally holding `seed` prefs), then hydrate with a syncer that talks to `fake`. */
function hydrate(options: { fake: FakeSupabase; seed?: Prefs; enabled?: boolean }) {
  device = installDevice(options.seed ? { [PREFS_KEY]: JSON.stringify(options.seed) } : {});
  resetPrefsForTests();
  const timers = manualTimers();
  const adapter = createSupabaseAdapter({ client: options.fake, candles: createMemoryCandleStore() });
  const sync = configurePrefsSyncForTests({
    enabled: options.enabled ?? true,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  hydratePrefs();
  return { sync, timers };
}

test("disabled: setPrefs stays on the device, no adapter calls", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = hydrate({ fake, enabled: false });
  setPrefs({ goldPreset: "amber" });
  assert.equal(getPrefs().goldPreset, "amber");
  assert.equal(cached(device!)?.goldPreset, "amber");
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
});

test("first sign-in imports the device preferences once", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = hydrate({ fake, seed: prefs({ goldPreset: "champagne" }) });
  await sync.pull();
  assert.equal(serverPrefs(fake)?.goldPreset, "champagne");
  const sent = writesOf(fake).length;
  await sync.pull();
  assert.equal(writesOf(fake).length, sent, "a second pull sends nothing");
});

test("setPrefs reaches the server after the debounce; the device copy is written at once", async () => {
  const fake = createFakeSupabase(UID);
  const { sync, timers } = hydrate({ fake });
  await sync.pull();
  setPrefs({ boxOpacity: 0.4 });
  assert.equal(getPrefs().boxOpacity, 0.4);
  assert.equal(cached(device!)?.boxOpacity, 0.4);
  assert.equal(serverPrefs(fake)?.boxOpacity, DEFAULT_PREFS.boxOpacity, "not yet: the push waits for the debounce");
  timers.fire();
  await settle();
  assert.equal(serverPrefs(fake)?.boxOpacity, 0.4);
});

test("preferences saved on another device arrive here on pull and are applied", async () => {
  const fake = createFakeSupabase(UID);
  await direct(fake).put(UID, prefs({ palette: "blue-orange" }));
  const { sync } = hydrate({ fake });
  await sync.pull();
  assert.equal(getPrefs().palette, "blue-orange");
  assert.equal(cached(device!)?.palette, "blue-orange");
});

test("an offline change stays on the device and is sent on the next flush", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = hydrate({ fake });
  await sync.pull();
  setPrefs({ goldPreset: "platinum" });
  fake.failNext({ message: "fetch failed" });
  assert.equal(await sync.flushNow(), false);
  assert.equal(getPrefs().goldPreset, "platinum");
  assert.equal(sync.getState().status, "pending");
  assert.equal(await sync.flushNow(), true);
  assert.equal(serverPrefs(fake)?.goldPreset, "platinum");
});

test("a restore that sets several fields pushes the whole restored set", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = hydrate({ fake });
  await sync.pull();
  const restored = prefs({ shield: true, riskBudgetUsd: 500, showSamples: false });
  setPrefs(restored);
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(serverPrefs(fake), getPrefs());
  assert.equal(serverPrefs(fake)?.riskBudgetUsd, 500);
});
