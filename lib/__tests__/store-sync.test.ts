// #190: the sync layer against the fake Supabase client (no network). Covers the pull/merge/push rules in
// lib/persistence/store-sync.ts and the trade store wiring in lib/store.ts.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { REMOTE_ROW_CAP, createCollectionSync, fingerprint, getSyncSummary, resetSyncRegistryForTests, subscribeSync } from "../persistence/store-sync.ts";
import type { CollectionSync, SyncStatus } from "../persistence/store-sync.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { PersistenceAdapter, CollectionRepository } from "../persistence/contract.ts";
import type { TradeRecord } from "../trades.ts";
import { normalizeTrade } from "../trades.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { addTrade, configureTradeSyncForTests, hydrateJournal, resetJournalForTests } from "../store.ts";
import { demoTrades } from "../fixtures.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER_UID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const BASE_KEY = "mogmine-sync-v1:base:trades";
const OWNER_KEY = "mogmine-sync-v1:owner:trades";

function trade(id: string, note = "", extra: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: "2026-11-20T14:30:00.000Z",
    exit_time: "2026-11-20T14:40:00.000Z",
    entry_price: 6800,
    exit_price: 6801,
    note,
    is_sample: false,
    ...extra,
  });
}

/** A manual timer queue: nothing fires until the test says so. */
function manualTimers() {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  return {
    setTimer: (fn: () => void, ms: number) => {
      const timer = { fn, ms, cancelled: false };
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

interface Harness {
  sync: CollectionSync;
  timers: ReturnType<typeof manualTimers>;
  storage: KeyValueStore;
  local: () => TradeRecord[];
  set: (next: TradeRecord[]) => void;
}

function harness(options: { fake: FakeSupabase; initial?: TradeRecord[]; storage?: KeyValueStore; adapter?: PersistenceAdapter; enabled?: boolean }): Harness {
  let list: TradeRecord[] = options.initial ?? [];
  const timers = manualTimers();
  const storage = options.storage ?? createMemoryKeyValueStore();
  const adapter = options.adapter ?? createSupabaseAdapter({ client: options.fake, candles: createMemoryCandleStore() });
  const sync = createCollectionSync<TradeRecord>({
    key: "trades",
    getLocal: () => list,
    apply: (next) => {
      list = next;
    },
    include: (record) => !record.is_sample,
    adapter: () => adapter,
    storage,
    enabled: options.enabled ?? true,
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { sync, timers, storage, local: () => list, set: (next) => { list = next; } };
}

/** Direct access to the server, as another device would have it. */
const direct = (fake: FakeSupabase): CollectionRepository<TradeRecord> =>
  createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.trades as unknown as CollectionRepository<TradeRecord>;

const rowsOf = (fake: FakeSupabase) => fake.tables.get("mogmine_trades") ?? [];
const serverIds = (fake: FakeSupabase, owner = UID) => rowsOf(fake).filter((row) => row.user_id === owner).map((row) => String(row.id)).sort();
const serverNote = (fake: FakeSupabase, id: string) => (rowsOf(fake).find((row) => row.id === id)?.record as { note?: string } | undefined)?.note;
/** Every call that changed the server (reads are `select`). */
const writesOf = (fake: FakeSupabase) => fake.calls.filter((call) => !call.startsWith("select"));
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Every put is refused as invalid, as a row the database rejects would be. */
function invalidPutAdapter(fake: FakeSupabase): PersistenceAdapter {
  const real = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  return {
    ...real,
    repositories: {
      ...real.repositories,
      trades: {
        ...real.repositories.trades,
        put: async () => ({ ok: false as const, error: { code: "invalid" as const, message: "This record did not pass validation." } }),
      },
    },
  } as PersistenceAdapter;
}

afterEach(() => {
  resetJournalForTests();
  resetSyncRegistryForTests();
});

test("disabled: no adapter calls, no timers, status off", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, enabled: false, initial: [trade("a")] });
  h.sync.start();
  await h.sync.pull();
  h.sync.changed();
  assert.equal(await h.sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(h.sync.getState().status, "off");
  assert.equal(h.timers.live().length, 0);
  assert.deepEqual(h.local().map((item) => item.id), ["a"]);
});

test("signed out: status signed-out, local records untouched, nothing written", async () => {
  const fake = createFakeSupabase(null);
  const h = harness({ fake, initial: [trade("a", "keep me")] });
  h.sync.start();
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "signed-out");
  assert.equal(h.local()[0].note, "keep me");
  assert.deepEqual(writesOf(fake), []);
  assert.equal(h.storage.getItem(OWNER_KEY), null);
});

test("first sign-in imports real trades, never samples, and a second pull sends nothing", async () => {
  const fake = createFakeSupabase(UID);
  const sample = trade("sample-1", "", { is_sample: true });
  const h = harness({ fake, initial: [trade("a"), trade("b"), trade("c"), sample] });
  await h.sync.pull();

  assert.equal(h.sync.getState().status, "synced");
  assert.deepEqual(serverIds(fake), ["a", "b", "c"]);
  assert.equal(h.storage.getItem(OWNER_KEY), UID);
  const base = JSON.parse(h.storage.getItem(BASE_KEY) ?? "{}") as { owner: string; ids: Record<string, string> };
  assert.equal(base.owner, UID);
  assert.deepEqual(Object.keys(base.ids).sort(), ["a", "b", "c"]);

  const before = writesOf(fake).length;
  await h.sync.pull();
  assert.equal(writesOf(fake).length, before, "an unchanged second pull writes nothing");
  assert.equal(h.sync.getState().status, "synced");
});

test("fingerprint ignores user_id, derived fields, candles and key order, but not content", () => {
  const record = trade("a", "hello");
  const asDemo = fingerprint("trades", { ...record, user_id: "demo-owner" });
  assert.equal(fingerprint("trades", { ...record, user_id: UID }), asDemo);
  assert.equal(fingerprint("trades", { ...record, net_pnl: 999, r_multiple: 3, candles: [{ time: 1 }] }), fingerprint("trades", record));
  const reversed = Object.fromEntries(Object.entries(record).reverse());
  assert.equal(fingerprint("trades", reversed), fingerprint("trades", record));
  assert.notEqual(fingerprint("trades", trade("a", "other")), fingerprint("trades", record));
});

test("a remote-only row is added and a remote edit of a clean record is taken without a write", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a", "v1")] });
  await h.sync.pull();

  await direct(fake).put(UID, trade("r1", "from phone"));
  await direct(fake).put(UID, trade("a", "v2 from phone"));
  const before = writesOf(fake).length;
  await h.sync.pull();

  assert.deepEqual(h.local().map((item) => item.id).sort(), ["a", "r1"]);
  assert.equal(h.local().find((item) => item.id === "a")?.note, "v2 from phone");
  assert.equal(writesOf(fake).length, before, "taking remote data pushes nothing back");
});

test("an edit made while offline stays on the device, shows pending, and goes out on the next flush", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a", "v1")] });
  await h.sync.pull();

  h.set([trade("a", "v2")]);
  fake.failNext({ message: "fetch failed" });
  assert.equal(await h.sync.flushNow(), false);
  assert.equal(h.sync.getState().status, "pending");
  assert.equal(h.local()[0].note, "v2", "the local edit survives the failed push");
  assert.equal(serverNote(fake, "a"), "v1");
  assert.equal(h.timers.live().length, 1, "one backoff retry is scheduled");

  assert.equal(await h.sync.flushNow(), true);
  assert.equal(h.sync.getState().status, "synced");
  assert.equal(serverNote(fake, "a"), "v2");
  const base = JSON.parse(h.storage.getItem(BASE_KEY) ?? "{}") as { ids: Record<string, string> };
  assert.equal(base.ids.a, fingerprint("trades", trade("a", "v2")));
});

test("changed() is debounced: the last change wins and one flush runs", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a", "v1")] });
  await h.sync.pull();

  h.set([trade("a", "v2")]);
  h.sync.changed();
  h.set([trade("a", "v3")]);
  h.sync.changed();
  assert.equal(h.timers.live().length, 1);
  assert.equal(h.timers.live()[0].ms, 800);
  h.timers.fire();
  await settle();
  assert.equal(serverNote(fake, "a"), "v3");
});

test("a local delete is sent as a remote remove", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a"), trade("b")] });
  await h.sync.pull();

  h.set([trade("b")]);
  assert.equal(await h.sync.flushNow(), true);
  assert.deepEqual(serverIds(fake), ["b"]);
});

test("a remote delete of a clean record is dropped locally; nothing is sent back", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a"), trade("b")] });
  await h.sync.pull();

  await direct(fake).remove(UID, "a");
  const before = writesOf(fake).length;
  await h.sync.pull();
  assert.deepEqual(h.local().map((item) => item.id), ["b"]);
  assert.equal(writesOf(fake).length, before);
});

test("a full page from the server (row cap) is not read as deletions: clean local records are kept", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a"), trade("b")] });
  await h.sync.pull();
  await direct(fake).remove(UID, "a");
  const real = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const filler = Array.from({ length: REMOTE_ROW_CAP }, (_, index) => trade(`r${index}`));
  const capped = {
    ...real,
    repositories: { ...real.repositories, trades: { ...real.repositories.trades, list: async () => ({ ok: true as const, value: filler }) } },
  } as PersistenceAdapter;
  const h2 = harness({ fake, initial: h.local(), storage: h.storage, adapter: capped });
  await h2.sync.pull();
  assert.ok(h2.local().some((item) => item.id === "a"), "a clean record missing from a capped page must stay");
  h.sync.dispose();
  h2.sync.dispose();
});

test("a remote delete of a dirty local record keeps the record and sends it again (no data loss)", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a", "v1")] });
  await h.sync.pull();

  h.set([trade("a", "edited here")]);
  await direct(fake).remove(UID, "a");
  await h.sync.pull();
  assert.deepEqual(h.local().map((item) => item.id), ["a"]);
  assert.equal(h.local()[0].note, "edited here");
  assert.equal(serverNote(fake, "a"), "edited here");
});

test("an unsent local edit survives a pull that returns an older remote version", async () => {
  const fake = createFakeSupabase(UID);
  const h = harness({ fake, initial: [trade("a", "v1")] });
  await h.sync.pull();

  h.set([trade("a", "v2 unsent")]);
  await direct(fake).put(UID, trade("a", "remote other"));
  await h.sync.pull();
  assert.equal(h.local()[0].note, "v2 unsent");
  assert.equal(serverNote(fake, "a"), "v2 unsent", "the pull pushes the kept edit");
});

test("another user on the same device: their records are copied aside, not sent, and not shown", async () => {
  const fake = createFakeSupabase(UID);
  const storage = createMemoryKeyValueStore();
  const first = harness({ fake, storage, initial: [trade("a"), trade("b")] });
  await first.sync.pull();
  assert.deepEqual(serverIds(fake), ["a", "b"]);

  fake.signIn(OTHER_UID);
  const second = harness({ fake, storage, initial: first.local() });
  await second.sync.pull();

  assert.deepEqual(second.local(), []);
  assert.equal(second.sync.getState().status, "synced");
  const orphan = JSON.parse(storage.getItem("mogmine-sync-v1:orphan:trades:" + UID) ?? "[]") as TradeRecord[];
  assert.deepEqual(orphan.map((item) => item.id).sort(), ["a", "b"]);
  assert.deepEqual(serverIds(fake, UID), ["a", "b"], "the first user's rows are untouched");
  assert.deepEqual(serverIds(fake, OTHER_UID), []);
  assert.equal(storage.getItem(OWNER_KEY), OTHER_UID);
});

test("a refused remove (archive policy) is remembered: never retried, never re-added", async () => {
  const fake = createFakeSupabase(UID);
  const real = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  let removeCalls = 0;
  const adapter = {
    ...real,
    repositories: {
      ...real.repositories,
      trades: {
        ...real.repositories.trades,
        remove: async () => {
          removeCalls += 1;
          return { ok: false as const, error: { code: "forbidden" as const, message: "This record is archived, not deleted." } };
        },
      },
    },
  } as PersistenceAdapter;
  const h = harness({ fake, adapter, initial: [trade("a"), trade("b")] });
  await h.sync.pull();

  h.set([trade("b")]);
  assert.equal(await h.sync.flushNow(), true);
  assert.equal(removeCalls, 1);
  assert.deepEqual(JSON.parse(h.storage.getItem(BASE_KEY) ?? "{}").gone, ["a"]);

  assert.equal(await h.sync.flushNow(), true);
  await h.sync.pull();
  assert.equal(removeCalls, 1, "the refused remove is not retried");
  assert.deepEqual(h.local().map((item) => item.id), ["b"], "the server's copy is not re-added");
});

test("an invalid record sets error with a count and does not retry in a loop", async () => {
  const fake = createFakeSupabase(UID);
  const real = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  let badAttempts = 0;
  const adapter = {
    ...real,
    repositories: {
      ...real.repositories,
      trades: {
        ...real.repositories.trades,
        put: async (owner: string, record: TradeRecord) => {
          if (record.id !== "bad") return real.repositories.trades.put(owner, record);
          badAttempts += 1;
          return { ok: false as const, error: { code: "invalid" as const, message: "This record did not pass validation." } };
        },
      },
    },
  } as PersistenceAdapter;
  const h = harness({ fake, adapter, initial: [] });
  await h.sync.pull();

  h.set([trade("good"), trade("bad")]);
  assert.equal(await h.sync.flushNow(), false);
  assert.equal(h.sync.getState().status, "error");
  assert.equal(h.sync.getState().message, "1 record couldn't sync");
  assert.deepEqual(serverIds(fake), ["good"], "the other records still go out");
  assert.equal(badAttempts, 1);
  assert.equal(h.timers.live().length, 0, "no backoff retry for a validation failure");
});

test("aggregate status: the worst of all syncers wins, and listeners hear about changes", async () => {
  resetSyncRegistryForTests();
  let notified = 0;
  const unsubscribe = subscribeSync(() => { notified += 1; });

  harness({ fake: createFakeSupabase(UID), enabled: false });
  assert.equal(getSyncSummary().status, "off");

  const out = harness({ fake: createFakeSupabase(null) });
  await out.sync.pull();
  assert.equal(getSyncSummary().status, "signed-out");

  const synced = harness({ fake: createFakeSupabase(UID) });
  await synced.sync.pull();
  assert.equal(synced.sync.getState().status, "synced");
  assert.equal(getSyncSummary().status, "signed-out", "signed-out outranks synced");

  const unreachable = createFakeSupabase(UID);
  unreachable.failNext({ message: "fetch failed" });
  const pending = harness({ fake: unreachable });
  await pending.sync.pull();
  assert.equal(getSyncSummary().status, "pending");

  const broken = createFakeSupabase(UID);
  const broke = harness({ fake: broken, initial: [trade("x")], adapter: invalidPutAdapter(broken) });
  await broke.sync.pull();
  const status: SyncStatus = getSyncSummary().status;
  assert.equal(status, "error");
  assert.ok(notified > 0);
  unsubscribe();
});

test("garbage sync metadata reads as missing, so a pull still works", async () => {
  const fake = createFakeSupabase(UID);
  const storage = createMemoryKeyValueStore({ [BASE_KEY]: "{not json", [OWNER_KEY]: UID });
  const h = harness({ fake, storage, initial: [trade("a")] });
  await h.sync.pull();
  assert.equal(h.sync.getState().status, "synced");
  assert.deepEqual(serverIds(fake), ["a"]);
});

test("trade store: hydrate pulls, addTrade pushes a real trade, and samples never reach the server", async () => {
  const memory = new Map<string, string>();
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
    value: { localStorage: device, addEventListener() {}, removeEventListener() {} },
  });
  try {
    const fake = createFakeSupabase(UID);
    const adapter = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
    const timers = manualTimers();
    const sync = configureTradeSyncForTests({
      enabled: true,
      adapter: () => adapter,
      storage: createMemoryKeyValueStore(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });

    hydrateJournal();
    await sync.pull();
    addTrade(trade("real-1", "saved from the store"));
    assert.equal(await sync.flushNow(), true);

    assert.deepEqual(serverIds(fake), ["real-1"]);
    assert.equal(serverNote(fake, "real-1"), "saved from the store");
    const demoIds = new Set(demoTrades.map((item) => item.id));
    assert.equal(rowsOf(fake).some((row) => demoIds.has(String(row.id))), false, "sample trades never reach the server");
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
