// #194: the sync layer across every synced store at once, against the fake Supabase client (no network). Covers:
// restore from a backup (every store's restore marks its syncer changed; a smaller trade backup leaves the server with
// exactly the backup's real trades), auth refresh (hydrate, start and pull are idempotent), and session expiry mid-use
// (device data stays; edits made while signed out go out after sign-in and the next pull).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_OWNER_USER_ID, normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { PREFS_KEY, configurePrefsSyncForTests, getPrefs, hydratePrefs, resetPrefsForTests, setPrefs } from "../prefs.ts";
import { DEFAULT_MOOD_REGISTRY, addSpoke, userMoodRecord } from "../mood.ts";
import {
  configureMoodSyncForTests, hydrateMood, resetMoodForTests, restoreMood,
} from "../mood-store.ts";
import {
  configureTradeSyncForTests, addTrade, flushJournal, getJournal, hydrateJournal, replaceTrades, resetJournalForTests,
} from "../store.ts";
import { configureAccountsSyncForTests, hydrateAccounts, resetAccountsForTests, restoreAccounts } from "../accounts-store.ts";
import { makeAccount } from "../accounts.ts";
import type { BalanceCheck } from "../accounts.ts";
import { configureChallengesSyncForTests, hydrateChallenges, resetChallengesForTests, restoreChallenges } from "../challenge-store.ts";
import { CHALLENGE_CALC_VERSION } from "../challenges.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import { configurePlaybooksSyncForTests, hydratePlaybooks, resetPlaybooksForTests, restorePlaybooks } from "../playbooks-store.ts";
import type { Playbook } from "../playbooks.ts";
import { configurePlansSyncForTests, hydratePlans, resetPlansForTests, restorePlans } from "../plans-store.ts";
import { newPlanningSession } from "../plans.ts";
import { configureDrillsSyncForTests, hydrateDrills, resetDrillsForTests, restoreDrills } from "../drills-store.ts";
import type { DrillRecord } from "../drills.ts";
import { configureCallsSyncForTests, hydrateCalls, resetCallsForTests, restoreCalls, sanitizeCall, sanitizeDismissal } from "../calls-store.ts";
import { reasonChipsFor } from "../calls.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { PersistenceAdapter } from "../persistence/contract.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import type { CollectionSync } from "../persistence/store-sync.ts";
import type { SingletonSync } from "../persistence/singleton-sync.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { manualTimers, rowsIn, settle, writesOf } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const NOW_ISO = "2026-11-23T12:00:00.000Z";

// ---- Device shim: localStorage plus a window that records which listeners were attached. ------------------------

interface Device {
  memory: Map<string, string>;
  listeners: string[];
  uninstall(): void;
}

function installDevice(): Device {
  const memory = new Map<string, string>();
  const listeners: string[] = [];
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear() { memory.clear(); },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: { localStorage: storage, addEventListener: (type: string) => { listeners.push(type); }, removeEventListener() {} },
  });
  return {
    memory,
    listeners,
    uninstall() {
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

// ---- Fixtures ---------------------------------------------------------------------------------------------------

function trade(id: string, extra: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id, symbol: "MES", direction: "LONG", quantity: 1, status: "closed",
    entry_time: "2026-11-20T14:30:00.000Z", exit_time: "2026-11-20T14:40:00.000Z",
    entry_price: 6800, exit_price: 6801, note: `note ${id}`, is_sample: false, ...extra,
  });
}

const drawdown = (id: string): ChallengeDefinition => ({
  id, user_id: DEFAULT_OWNER_USER_ID,
  rules: { kind: "drawdown", sessions: 20, max_drawdown_cents: 30_000 },
  started_at: "2026-11-01T00:00:00.000Z", ended_at: null, calc_version: CHALLENGE_CALC_VERSION,
});

const playbook = (id: string, name: string): Playbook => ({
  id, user_id: DEFAULT_OWNER_USER_ID, name, default_style: "session_90m",
  checklist_rules: [{ id: "r1", label: "Sweep first" }], archived: false,
});

const plan = (id: string) => newPlanningSession({
  id, session_date: "2026-11-23", name: `Plan ${id}`, preset: null, anchor_time_utc: null, observations: "Watch the open",
  bias: "bullish", watch_playbook_ids: [], levels: [], symbol: "MES", now: NOW_ISO,
});

const drill = (id: string, tradeId: string): DrillRecord => ({
  id, user_id: DEFAULT_OWNER_USER_ID, trade_id: tradeId, kind: "take_it", answer: "pass", answered_at: "2026-11-21T10:00:00.000Z", hidden: ["exit"],
});

const thesis = reasonChipsFor("cut")[0];
const call = (id: string) => {
  const saved = sanitizeCall({
    kind: "cut", made_at: "2026-11-20T15:00:00Z", recorded_at: "2026-11-20T15:01:00Z", trade_id: "t1", plan_session_id: null,
    playbook_id: "orb-reclaim", price: 7600.25, price_ticks: 30401, signal_direction: null,
    reasons: [{ id: thesis.id, label: thesis.label, family: thesis.family }], note: "Stalled at VWAP", conviction: 2,
    prompt_id: null, prompt_question: "Why out before stop or target?", origin: "manual", trigger: null, rule: null, made_at_basis: "exact",
    id, user_id: DEFAULT_OWNER_USER_ID,
  });
  if (!saved) throw new Error(`fixture call ${id} is invalid`);
  return saved;
};
const dismissal = (id: string) => {
  const saved = sanitizeDismissal({ id, user_id: DEFAULT_OWNER_USER_ID, trade_id: "t1", prompt_id: "seed:cut", deviation: null, reason: "later", recorded_at: NOW_ISO });
  if (!saved) throw new Error(`fixture dismissal ${id} is invalid`);
  return saved;
};

// ---- Harness ----------------------------------------------------------------------------------------------------

let device: Device | null = null;

// The mood and accounts resets default to `hydrated: true` (a test hook for "already open"); ask for unhydrated stores.
afterEach(() => {
  resetJournalForTests();
  resetPrefsForTests();
  resetMoodForTests({ hydrated: false });
  resetAccountsForTests({ hydrated: false });
  resetChallengesForTests();
  resetPlaybooksForTests();
  resetPlansForTests();
  resetDrillsForTests();
  resetCallsForTests();
  resetSyncRegistryForTests();
  device?.uninstall();
  device = null;
});

interface Stores {
  trades: CollectionSync;
  prefs: SingletonSync;
  mood: { records: CollectionSync; candidates: CollectionSync; registry: SingletonSync };
  accounts: CollectionSync;
  checks: CollectionSync;
  challenges: CollectionSync;
  playbooks: CollectionSync;
  plans: CollectionSync;
  drills: CollectionSync;
  calls: CollectionSync;
  dismissals: CollectionSync;
}

/** Every syncer in the app shares one adapter, one manual timer queue and one storage, as the browser would. */
function wireAll(fake: FakeSupabase): { stores: Stores; timers: ReturnType<typeof manualTimers>; adapter: PersistenceAdapter } {
  const timers = manualTimers();
  const adapter = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const common = {
    enabled: true,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  };
  const mood = configureMoodSyncForTests({ records: common, candidates: common, registry: common });
  const accounts = configureAccountsSyncForTests({ accounts: common, checks: common });
  const calls = configureCallsSyncForTests({ calls: common, dismissals: common });
  const stores: Stores = {
    trades: configureTradeSyncForTests(common),
    prefs: configurePrefsSyncForTests(common),
    mood,
    accounts: accounts.accounts,
    checks: accounts.checks,
    challenges: configureChallengesSyncForTests(common),
    playbooks: configurePlaybooksSyncForTests(common),
    plans: configurePlansSyncForTests(common),
    drills: configureDrillsSyncForTests(common),
    calls: calls.calls,
    dismissals: calls.dismissals,
  };
  return { stores, timers, adapter };
}

/** Hydrate every store, as AppShell does on mount. Each hydrate starts its syncers, which pull in the background. */
function hydrateAll() {
  hydrateJournal();
  hydratePrefs();
  hydrateMood();
  hydrateAccounts();
  hydrateChallenges();
  hydratePlaybooks();
  hydratePlans();
  hydrateDrills();
  hydrateCalls();
}

/** Every store's restore, as the Tune screen runs them after a backup file is confirmed. */
function restoreEverything(stores: Stores, tradeIds: string[] = ["t1"]) {
  replaceTrades(tradeIds.map((id) => trade(id)));
  setPrefs({ goldPreset: "amber" });
  restoreMood({ registry: addSpoke(DEFAULT_MOOD_REGISTRY, "Patience"), records: [userMoodRecord({ id: "m1", trade_id: "t1", now: NOW_ISO, captured_at: null, recorded_at: NOW_ISO }, DEFAULT_MOOD_REGISTRY, { calm: 0.8 })], candidates: [] });
  restoreAccounts({
    accounts: [makeAccount({ id: "acct-1", name: "Eval", starting_balance_cents: 5_000_000, now: NOW_ISO })],
    checks: [{ id: "chk-1", account_id: "acct-1", at: NOW_ISO, balance_cents: 5_000_000, note: "" } as BalanceCheck],
  });
  restoreChallenges([drawdown("ch-1")]);
  restorePlaybooks([playbook("pb-1", "Mine")]);
  restorePlans([plan("pl-1")]);
  restoreDrills([drill("dr-1", "t1")]);
  restoreCalls({ calls: [call("call-1")], dismissals: [dismissal("dis-1")] });
  void stores;
}

/** Every syncer's pull, in the order a refresh would run them. */
async function pullAll(stores: Stores) {
  for (const sync of [stores.trades, stores.mood.records, stores.mood.candidates, stores.accounts, stores.checks, stores.challenges,
    stores.playbooks, stores.plans, stores.drills, stores.calls, stores.dismissals]) await sync.pull();
  await stores.prefs.pull();
  await stores.mood.registry.pull();
  await settle();
}

const serverIds = (fake: FakeSupabase, table: string) =>
  rowsIn(fake, table).filter((row) => row.user_id === UID).map((row) => String(row.id)).sort();
const serverRecord = (fake: FakeSupabase, table: string) =>
  rowsIn(fake, table).find((row) => row.user_id === UID)?.record as Record<string, unknown> | undefined;

// ---- Restore ----------------------------------------------------------------------------------------------------

test("restore: a backup with fewer trades than the server leaves the server with exactly the backup's real trades; samples never sent", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores, timers, adapter } = wireAll(fake);
  // The server already holds three real trades from another device.
  for (const id of ["a", "b", "c"]) await adapter.repositories.trades.put(UID, trade(id));

  hydrateJournal();
  await stores.trades.pull();
  assert.deepEqual(serverIds(fake, "mogmine_trades"), ["a", "b", "c"]);
  const writesBeforeRestore = writesOf(fake).length;

  // The backup holds only `a` and a sample trade (samples are backed up, never synced).
  replaceTrades([trade("a"), trade("sample-1", { is_sample: true })]);
  assert.equal(timers.live().length > 0, true, "the restore armed the trade syncer's debounce");
  timers.fire();
  await settle();

  assert.deepEqual(serverIds(fake, "mogmine_trades"), ["a"], "the server ends with exactly the backup's real trades");
  assert.equal(getJournal().trades.some((item) => item.id === "sample-1"), true, "the sample stays on this device");
  assert.deepEqual(writesOf(fake).slice(writesBeforeRestore), ["delete mogmine_trades", "delete mogmine_trades"], "only the two removals were sent: no sample, no re-write of a");
});

test("restore: every store's restore marks its syncer changed, and the server ends with the backup's contents", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores, timers } = wireAll(fake);
  hydrateAll();
  await pullAll(stores);
  assert.equal(timers.live().length, 0, "nothing to send before the restore");

  restoreEverything(stores);

  // No explicit flush: only the debounce that each restore arms may send. A store that skipped changed() stays out.
  timers.fire();
  await settle();

  assert.deepEqual(serverIds(fake, "mogmine_trades"), ["t1"]);
  assert.equal(serverRecord(fake, "mogmine_user_prefs")?.goldPreset, "amber");
  assert.equal((serverRecord(fake, "mogmine_mood_registries") as { version?: number } | undefined)?.version, 2);
  assert.deepEqual(serverIds(fake, "mogmine_mood_records"), ["m1"]);
  assert.deepEqual(serverIds(fake, "mogmine_accounts"), ["acct-1"]);
  assert.deepEqual(serverIds(fake, "mogmine_balance_checks"), ["chk-1"]);
  assert.deepEqual(serverIds(fake, "mogmine_challenges"), ["ch-1"]);
  assert.ok(serverIds(fake, "mogmine_playbooks").includes("pb-1"));
  assert.deepEqual(serverIds(fake, "mogmine_plans"), ["pl-1"]);
  assert.deepEqual(serverIds(fake, "mogmine_drills"), ["dr-1"]);
  assert.deepEqual(serverIds(fake, "mogmine_calls"), ["call-1"]);
  assert.deepEqual(serverIds(fake, "mogmine_prompt_dismissals"), ["dis-1"]);
});

// ---- Auth refresh ------------------------------------------------------------------------------------------------

test("refresh: hydrating every store twice starts nothing new (no second pull, no second listener set)", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores } = wireAll(fake);
  hydrateAll();
  await pullAll(stores);
  const listenersAfterFirst = device.listeners.length;
  const callsAfterFirst = fake.calls.length;

  hydrateAll();
  await settle();
  assert.equal(device.listeners.length, listenersAfterFirst, "no listener was attached twice");
  assert.equal(fake.calls.length, callsAfterFirst, "no adapter call from the second hydrate");
});

test("refresh: start() is idempotent for every syncer; a second start() pulls nothing", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores } = wireAll(fake);
  hydrateAll();
  await pullAll(stores);
  const callsBefore = fake.calls.length;

  for (const sync of [stores.trades, stores.prefs, stores.mood.records, stores.mood.candidates, stores.mood.registry, stores.accounts, stores.checks,
    stores.challenges, stores.playbooks, stores.plans, stores.drills, stores.calls, stores.dismissals]) sync.start();
  await settle();
  assert.equal(fake.calls.length, callsBefore);
});

test("refresh: a second pull with no changes sends no writes for any store", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores, timers } = wireAll(fake);
  hydrateAll();
  await pullAll(stores);
  // Put one real item in every store, send it, then pull again: the server now holds data to compare against.
  restoreEverything(stores);
  timers.fire();
  await settle();
  await pullAll(stores);
  assert.ok(serverIds(fake, "mogmine_trades").length === 1 && serverIds(fake, "mogmine_calls").length === 1);

  const writes = writesOf(fake).length;
  await pullAll(stores);
  await pullAll(stores);
  assert.equal(writesOf(fake).length, writes, "a pull with nothing changed writes nothing");
});

// ---- Session expiry mid-use ----------------------------------------------------------------------------------------

test("expiry: a save refused as unauthenticated shows signed-out and the device keeps the edit", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores, timers } = wireAll(fake);
  hydrateJournal();
  await stores.trades.pull();

  fake.failNext({ message: "JWT expired" });
  addTrade(trade("kept-on-device"));
  timers.fire();
  await settle();

  assert.equal(stores.trades.getState().status, "signed-out");
  assert.ok(getJournal().trades.some((item) => item.id === "kept-on-device"), "still in the journal");
  flushJournal(); // the journal writes its device cache after a short debounce
  assert.ok(JSON.stringify([...device.memory.values()]).includes("kept-on-device"), "and in the device cache");
  assert.deepEqual(serverIds(fake, "mogmine_trades"), []);
});

test("expiry: edits made while signed out are sent after sign-in and the next pull, across two stores", async () => {
  device = installDevice();
  const fake = createFakeSupabase(UID);
  const { stores, timers } = wireAll(fake);
  hydrateAll();
  await pullAll(stores);

  fake.signIn(null); // the session has expired
  addTrade(trade("while-signed-out"));
  setPrefs({ goldPreset: "platinum" });
  timers.fire();
  await settle();

  assert.equal(stores.trades.getState().status, "signed-out");
  assert.equal(stores.prefs.getState().status, "signed-out");
  assert.ok(getJournal().trades.some((item) => item.id === "while-signed-out"), "trade kept on the device");
  assert.equal(getPrefs().goldPreset, "platinum", "preferences kept on the device");
  assert.ok(String(device.memory.get(PREFS_KEY)).includes("platinum"), "preferences cached on the device");
  assert.deepEqual(serverIds(fake, "mogmine_trades"), []);

  fake.signIn(UID);
  await stores.trades.pull();
  await stores.prefs.pull();
  await settle();

  assert.deepEqual(serverIds(fake, "mogmine_trades"), ["while-signed-out"]);
  assert.equal(serverRecord(fake, "mogmine_user_prefs")?.goldPreset, "platinum");
  assert.equal(stores.trades.getState().status, "synced");
  assert.equal(stores.prefs.getState().status, "synced");
});
