// R3-08 (docs/26 §8.4 #4, #5, #7): cross-tab `storage` listeners on the six remaining stores, and archive-on-restore
// for accounts and playbooks. Dispatches synthetic storage events on a fake window; no network (fake Supabase only).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_PREFS, PREFS_KEY, configurePrefsSyncForTests, getPrefs, hydratePrefs, resetPrefsForTests, sanitizePrefs } from "../prefs.ts";
import { PLANS_STORAGE_KEY, configurePlansSyncForTests, getPlansState, hydratePlans, resetPlansForTests } from "../plans-store.ts";
import { DRILLS_STORAGE_KEY, configureDrillsSyncForTests, getDrillsState, hydrateDrills, resetDrillsForTests } from "../drills-store.ts";
import { CALLS_STORAGE_KEY, configureCallsSyncForTests, getCallsState, hydrateCalls, resetCallsForTests, sanitizeCall } from "../calls-store.ts";
import { DAILY_REVIEWS_STORAGE_KEY, configureDailyReviewsSyncForTests, getDailyReviewsState, hydrateDailyReviews, resetDailyReviewsForTests } from "../daily-review-store.ts";
import { TAGS_STORAGE_KEY, configureTagRegistrySyncForTests, getTagRegistryState, hydrateTagRegistry, resetTagRegistryForTests } from "../tag-registry-store.ts";
import { DEFAULT_TAG_REGISTRY, sanitizeTagRegistry } from "../tag-registry.ts";
import { configureAccountsSyncForTests, getAccountsState, hydrateAccounts, resetAccountsForTests, restoreAccounts } from "../accounts-store.ts";
import { makeAccount } from "../accounts.ts";
import type { TradingAccount } from "../accounts.ts";
import { PLAYBOOKS_STORAGE_KEY, configurePlaybooksSyncForTests, getPlaybooksState, hydratePlaybooks, resetPlaybooksForTests, restorePlaybooks } from "../playbooks-store.ts";
import { PLAYBOOK_SEEDS } from "../playbooks.ts";
import type { Playbook } from "../playbooks.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { newPlanningSession } from "../plans.ts";
import { makeDailyReview } from "../daily-review.ts";
import { reasonChipsFor } from "../calls.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { manualTimers, rowsIn, settle } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW_ISO = "2026-11-23T12:00:00.000Z";
const NOW = Date.parse(NOW_ISO);
const ACCOUNTS_KEY = "mogmine-accounts-v1";

type StorageHandler = (event: StorageEvent) => void;

/**
 * A browser-like `window` + `localStorage` that remembers its storage listeners, so a test can fire `storage` events
 * the way another tab would. Listener bookkeeping is exposed so tests can assert nothing accumulates.
 */
function installWindow(seed: Record<string, string> = {}) {
  const memory = new Map(Object.entries(seed));
  const handlers = new Set<StorageHandler>();
  const device = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear() { memory.clear(); },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: device });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      localStorage: device,
      addEventListener: (type: string, handler: StorageHandler) => { if (type === "storage") handlers.add(handler); },
      removeEventListener: (type: string, handler: StorageHandler) => { if (type === "storage") handlers.delete(handler); },
    },
  });
  return {
    memory,
    handlers,
    /** Fire a storage event as another tab would: its write to `key` arrives here with `newValue`. */
    fire(key: string, newValue: string | null) {
      const event = { type: "storage", key, newValue, storageArea: device } as unknown as StorageEvent;
      for (const handler of [...handlers]) handler(event);
    },
    uninstall() {
      Reflect.deleteProperty(globalThis, "window");
      Reflect.deleteProperty(globalThis, "localStorage");
    },
  };
}

let device: ReturnType<typeof installWindow> | null = null;

afterEach(() => {
  resetPrefsForTests();
  resetPlansForTests();
  resetDrillsForTests();
  resetCallsForTests();
  resetDailyReviewsForTests();
  resetTagRegistryForTests();
  resetAccountsForTests({ hydrated: false });
  resetPlaybooksForTests();
  resetSyncRegistryForTests();
  device?.uninstall();
  device = null;
});

/** Shared sync options: enabled, pointed at the fake server, with manual timers so `changed()` is observable. */
function syncOptions(fake: FakeSupabase) {
  const timers = manualTimers();
  const adapter = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const options = {
    enabled: true,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  };
  return { timers, options };
}

// ---- Cross-tab storage listeners (docs/26 §8.4 #7) -------------------------------------------------------------

interface StoreCase {
  key: string;
  seed: string;
  next: string;
  /** Build the store's syncer(s) on the fake server, then hydrate it. */
  hydrate(options: ReturnType<typeof syncOptions>["options"]): void;
  /** Pull once so the syncer is "pulled" and `changed()` arms a push. */
  pull(): Promise<void>;
  read(): unknown;
  expected: unknown;
  reset(): void;
}

const planRecord = newPlanningSession({
  id: "plan-tab-b", session_date: "2026-11-23", name: "From tab B", preset: null, anchor_time_utc: null,
  observations: "Watch VWAP", bias: "bullish", watch_playbook_ids: [], levels: [], symbol: "MES", now: NOW_ISO,
});
const drillRecord = { id: "drill-tab-b", trade_id: "t-real", kind: "take_it", answer: "take", answered_at: NOW_ISO, hidden: [] };
const thesis = reasonChipsFor("cut")[0];
const callRecordRaw = {
  kind: "cut", made_at: "2026-11-20T15:00:00Z", recorded_at: NOW_ISO, trade_id: "t1", plan_session_id: null,
  playbook_id: "orb-reclaim", price: 7600.25, price_ticks: 30401, signal_direction: null,
  reasons: [{ id: thesis.id, label: thesis.label, family: thesis.family }], note: "From tab B", conviction: 2,
  prompt_id: null, prompt_question: "Why out?", origin: "manual", trigger: null, rule: null, made_at_basis: "exact",
  id: "call-tab-b", user_id: DEFAULT_OWNER_USER_ID,
};
const reviewRecord = makeDailyReview({ session_date: "2026-11-23", account_id: null, trade_ids: ["t-real"], recorded_at: NOW_ISO });
const tagsWithoutSetup = { setup: DEFAULT_TAG_REGISTRY.setup.slice(0, 1), execution: DEFAULT_TAG_REGISTRY.execution };

const CASES: Record<string, StoreCase> = {
  prefs: {
    key: PREFS_KEY,
    seed: JSON.stringify(DEFAULT_PREFS),
    next: JSON.stringify({ ...DEFAULT_PREFS, goldPreset: "amber" }),
    hydrate: (options) => {
      configurePrefsSyncForTests(options);
      hydratePrefs();
    },
    pull: () => Promise.resolve(),
    read: () => getPrefs(),
    expected: sanitizePrefs({ ...DEFAULT_PREFS, goldPreset: "amber" }),
    reset: () => resetPrefsForTests(),
  },
  plans: {
    key: PLANS_STORAGE_KEY,
    seed: "[]",
    next: JSON.stringify([planRecord]),
    hydrate: (options) => {
      configurePlansSyncForTests(options);
      hydratePlans();
    },
    pull: () => Promise.resolve(),
    read: () => getPlansState().plans.map((plan) => plan.id),
    expected: ["plan-tab-b"],
    reset: () => resetPlansForTests(),
  },
  drills: {
    key: DRILLS_STORAGE_KEY,
    seed: "[]",
    next: JSON.stringify([drillRecord]),
    hydrate: (options) => {
      configureDrillsSyncForTests(options);
      hydrateDrills();
    },
    pull: () => Promise.resolve(),
    read: () => getDrillsState().records.map((record) => record.id),
    expected: ["drill-tab-b"],
    reset: () => resetDrillsForTests(),
  },
  calls: {
    key: CALLS_STORAGE_KEY,
    seed: JSON.stringify({ calls: [], dismissals: [] }),
    next: JSON.stringify({ calls: [callRecordRaw], dismissals: [] }),
    hydrate: (options) => {
      configureCallsSyncForTests({ calls: options, dismissals: options });
      hydrateCalls();
    },
    pull: () => Promise.resolve(),
    read: () => getCallsState().calls.map((call) => call.id),
    expected: [sanitizeCall(callRecordRaw)?.id],
    reset: () => resetCallsForTests(),
  },
  "daily-reviews": {
    key: DAILY_REVIEWS_STORAGE_KEY,
    seed: "[]",
    next: JSON.stringify([reviewRecord]),
    hydrate: (options) => {
      configureDailyReviewsSyncForTests(options);
      hydrateDailyReviews();
    },
    pull: () => Promise.resolve(),
    read: () => getDailyReviewsState().reviews.map((review) => review.id),
    expected: [reviewRecord.id],
    reset: () => resetDailyReviewsForTests(),
  },
  "tag-registry": {
    key: TAGS_STORAGE_KEY,
    seed: JSON.stringify(DEFAULT_TAG_REGISTRY),
    next: JSON.stringify(tagsWithoutSetup),
    hydrate: (options) => {
      configureTagRegistrySyncForTests(options);
      hydrateTagRegistry();
    },
    pull: () => Promise.resolve(),
    read: () => getTagRegistryState().registry,
    expected: sanitizeTagRegistry(tagsWithoutSetup),
    reset: () => resetTagRegistryForTests(),
  },
};

for (const [name, caseOf] of Object.entries(CASES)) {
  test(`cross-tab (#7): a storage event from another tab updates ${name}, arms its push, ignores junk, and is removed on reset`, async () => {
    device = installWindow({ [caseOf.key]: caseOf.seed });
    const fake = createFakeSupabase(UID);
    const { timers, options } = syncOptions(fake);
    caseOf.hydrate(options);
    await settle();
    await settle();
    assert.equal(device.handlers.size, 1, "one listener after hydrate");

    timers.fire();
    device.fire(caseOf.key, caseOf.next);
    assert.deepEqual(caseOf.read(), caseOf.expected, "in-memory state follows the other tab");
    // calls-store runs two syncers (calls + dismissals), so it may arm two debounced pushes.
    assert.ok(timers.live().length >= 1, "changed() armed a debounced push");

    assert.doesNotThrow(() => device!.fire(caseOf.key, "{not json"), "malformed JSON never throws");
    assert.doesNotThrow(() => device!.fire(caseOf.key, "[1,"), "truncated JSON never throws");
    assert.deepEqual(caseOf.read(), caseOf.expected, "malformed events keep this tab's copy");

    device.fire("mogmine-unrelated-v1", caseOf.next);
    assert.deepEqual(caseOf.read(), caseOf.expected, "other keys are ignored");

    caseOf.reset();
    assert.equal(device.handlers.size, 0, "reset removes the listener");
  });
}

test("cross-tab (#7): a repeated hydrate does not stack listeners", () => {
  device = installWindow({});
  hydratePlans();
  hydratePlans();
  resetPlansForTests();
  hydratePlans();
  assert.equal(device.handlers.size, 1);
});

// ---- Archive-on-restore (docs/26 §8.4 #4, #5) -------------------------------------------------------------------

const account = (id: string, name: string) => makeAccount({ id, name, starting_balance_cents: 5_000_000, now: "2026-11-01T00:00:00.000Z" });

test("restoreAccounts (#4): an account the backup omits stays archived locally and is pushed archived:true", async () => {
  const old = account("acct-old", "Old");
  device = installWindow({ [ACCOUNTS_KEY]: JSON.stringify({ accounts: [old], checks: [] }) });
  const fake = createFakeSupabase(UID);
  const { options } = syncOptions(fake);
  const syncs = configureAccountsSyncForTests({ accounts: options, checks: options });
  hydrateAccounts();
  await Promise.all([syncs.accounts.pull(), syncs.checks.pull()]);
  assert.equal(await syncs.accounts.flushNow(), true);
  const serverRow = () => rowsIn(fake, "mogmine_accounts").find((row) => row.id === "acct-old")?.record as TradingAccount | undefined;
  assert.equal(serverRow()?.archived, false, "synced active first");

  restoreAccounts({ accounts: [account("acct-new", "New")], checks: [] });
  assert.deepEqual(
    getAccountsState().accounts.map((item) => [item.id, item.archived]).sort(),
    [["acct-new", false], ["acct-old", true]],
    "the omitted account is kept, archived",
  );
  assert.equal(await syncs.accounts.flushNow(), true);
  assert.equal(serverRow()?.archived, true, "mogmine_accounts row is archived, not left active");
});

const custom = (id: string, name: string): Playbook => ({
  id, user_id: DEFAULT_OWNER_USER_ID, name, default_style: "session_90m", checklist_rules: [{ id: "r1", label: "Sweep first" }], archived: false,
});

test("restorePlaybooks (#5): a custom playbook the backup omits stays archived locally and is pushed archived:true", async () => {
  const oldPlaybook = custom("pb-old", "Old Idea");
  device = installWindow({ [PLAYBOOKS_STORAGE_KEY]: JSON.stringify([...PLAYBOOK_SEEDS, oldPlaybook]) });
  const fake = createFakeSupabase(UID);
  const { options } = syncOptions(fake);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  await sync.pull();
  assert.equal(await sync.flushNow(), true);
  const serverRow = () => rowsIn(fake, "mogmine_playbooks").find((row) => row.id === "pb-old")?.record as Playbook | undefined;
  assert.equal(serverRow()?.archived, false, "synced active first");

  restorePlaybooks([...PLAYBOOK_SEEDS, custom("pb-new", "New Idea")]);
  const local = getPlaybooksState().playbooks.find((item) => item.id === "pb-old");
  assert.equal(local?.archived, true, "kept locally, archived");
  assert.equal(await sync.flushNow(), true);
  assert.equal(serverRow()?.archived, true, "mogmine_playbooks row is archived, not left active");
});

test("restorePlaybooks (#5): No Setup is never archived by a restore that omits it", () => {
  device = installWindow({});
  resetPlaybooksForTests();
  hydratePlaybooks();
  restorePlaybooks([custom("only", "Only Idea")]);
  const list = getPlaybooksState().playbooks;
  assert.equal(list.find((item) => item.id === "no-setup")?.archived ?? false, false);
  assert.equal(list.find((item) => item.id === "only")?.archived, false);
});
