// R3-05: optimistic concurrency in background sync (docs/26 §2 & §8, MOGMINE-BLUEPRINT §3.4). Every write the sync layer
// makes carries `expectedUpdatedAt` once the server's `updated_at` is known; a write refused as `conflict` is resolved
// by one re-read and at most one retry. Runs against the in-memory fake Supabase (no network).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createCollectionSync, resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import type { CollectionSync } from "../persistence/store-sync.ts";
import { createSingletonSync } from "../persistence/singleton-sync.ts";
import type { SingletonSync } from "../persistence/singleton-sync.ts";
import { readBase } from "../persistence/sync-storage.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import type { KeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { CollectionRepository, PersistenceAdapter, SingletonRepository, WriteOptions } from "../persistence/contract.ts";
import type { TradeRecord } from "../trades.ts";
import { DEFAULT_OWNER_USER_ID, normalizeTrade } from "../trades.ts";
import { DEFAULT_PREFS, sanitize } from "../prefs-sanitize.ts";
import type { Prefs } from "../prefs-sanitize.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { manualTimers, rowsIn, settle } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");

afterEach(() => resetSyncRegistryForTests());

function trade(id: string, note = ""): TradeRecord {
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
  });
}

const prefs = (patch: Partial<Prefs> = {}): Prefs => sanitize({ ...DEFAULT_PREFS, ...patch });

/** The real Supabase adapter with every write recorded: the options each `put` was called with, in order. */
function recording(fake: FakeSupabase) {
  const real = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const puts: { id: string; options: WriteOptions | undefined }[] = [];
  const trades = real.repositories.trades as unknown as CollectionRepository<TradeRecord>;
  const prefsRepo = real.repositories.prefs as unknown as SingletonRepository<Prefs>;
  const wrapped: CollectionRepository<TradeRecord> = {
    ...trades,
    put: (owner, record, options) => {
      puts.push({ id: record.id, options });
      return trades.put(owner, record, options);
    },
  };
  const singletonPuts: (WriteOptions | undefined)[] = [];
  const wrappedPrefs: SingletonRepository<Prefs> = {
    ...prefsRepo,
    put: (owner, value, options) => {
      singletonPuts.push(options);
      return prefsRepo.put(owner, value, options);
    },
  };
  const adapter = { ...real, repositories: { ...real.repositories, trades: wrapped, prefs: wrappedPrefs } } as unknown as PersistenceAdapter;
  return { adapter, puts, singletonPuts };
}

/** Direct access to the server, as the Agent API or another device writes it. */
const directTrades = (fake: FakeSupabase) =>
  createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.trades as unknown as CollectionRepository<TradeRecord>;
const directPrefs = (fake: FakeSupabase) =>
  createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.prefs as unknown as SingletonRepository<Prefs>;

const serverRow = (fake: FakeSupabase, table: string, id?: string) =>
  rowsIn(fake, table).find((row) => row.user_id === UID && (id === undefined || row.id === id));

function collectionDevice(adapter: PersistenceAdapter) {
  let list: TradeRecord[] = [];
  const timers = manualTimers();
  const storage: KeyValueStore = createMemoryKeyValueStore();
  const sync: CollectionSync = createCollectionSync<TradeRecord>({
    key: "trades",
    getLocal: () => list,
    apply: (next) => {
      list = next;
    },
    include: (record) => !record.is_sample,
    adapter: () => adapter,
    storage,
    enabled: true,
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { sync, storage, local: () => list, set: (next: TradeRecord[]) => { list = next; } };
}

function singletonDevice(adapter: PersistenceAdapter, initial: Prefs, storage: KeyValueStore = createMemoryKeyValueStore()) {
  let value: Prefs = initial;
  const timers = manualTimers();
  const sync: SingletonSync = createSingletonSync<Prefs>({
    key: "prefs",
    getLocal: () => value,
    apply: (next) => {
      value = next;
    },
    unedited: DEFAULT_PREFS,
    adapter: () => adapter,
    storage,
    enabled: true,
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  return { sync, storage, value: () => value, set: (next: Prefs) => { value = next; } };
}

test("collection: after a pull, an edit is sent with the server's updated_at; a brand-new record is an upsert", async () => {
  const fake = createFakeSupabase(UID);
  await directTrades(fake).put(UID, trade("t-1", "v1"));
  const { adapter, puts } = recording(fake);
  const device = collectionDevice(adapter);
  await device.sync.pull();
  const serverAt = serverRow(fake, "mogmine_trades", "t-1")!.updated_at;
  assert.equal(
    (JSON.parse(device.storage.getItem("mogmine-sync-v1:base:trades")!) as { updatedAt: Record<string, string> }).updatedAt["t-1"],
    serverAt,
    "the pull records the server's updated_at per row",
  );

  device.set(device.local().map((record) => (record.id === "t-1" ? trade("t-1", "edited here") : record)).concat(trade("new-1", "fresh")));
  assert.equal(await device.sync.flushNow(), true);
  assert.deepEqual(puts.find((put) => put.id === "t-1")?.options, { expectedUpdatedAt: serverAt });
  assert.equal(puts.find((put) => put.id === "new-1")?.options, undefined, "a brand-new device record has no expectation");
  assert.equal(device.sync.getState().status, "synced");
  device.sync.dispose();
});

test("concurrent Agent API write: the stale device edit conflicts once, re-reads, lands on top, and converges", async () => {
  const fake = createFakeSupabase(UID);
  await directTrades(fake).put(UID, trade("t-1", "v1"));
  const { adapter, puts } = recording(fake);
  const device = collectionDevice(adapter);
  await device.sync.pull(); // device holds t-1 at v1

  // The agent updates t-1 straight in Supabase, bumping updated_at.
  const agent = directTrades(fake);
  const agentWrite = await agent.put(UID, trade("t-1", "agent note"));
  assert.equal(agentWrite.ok, true);
  const agentAt = agentWrite.ok ? agentWrite.value.meta.updated_at : "";

  device.set(device.local().map((record) => (record.id === "t-1" ? trade("t-1", "device edit") : record)));
  puts.length = 0;
  assert.equal(await device.sync.flushNow(), true);
  assert.equal(puts.length, 2, "one stale write, one retry on top of the re-read row: no loop");
  assert.notEqual(puts[0].options?.expectedUpdatedAt, undefined);
  assert.equal(puts[1].options?.expectedUpdatedAt, agentAt, "the retry is conditional on the agent's updated_at");
  assert.equal((serverRow(fake, "mogmine_trades", "t-1")!.record as { note: string }).note, "device edit");
  assert.equal(device.sync.getState().status, "synced");
  device.sync.dispose();
});

test("a conflict that keeps repeating stops after one retry: the edit stays dirty, nothing loops", async () => {
  const fake = createFakeSupabase(UID);
  await directTrades(fake).put(UID, trade("t-1", "v1"));
  const { adapter: base, puts } = recording(fake);
  const trades = base.repositories.trades as unknown as CollectionRepository<TradeRecord>;
  // Every conditional write is refused, as if another writer keeps winning.
  const adapter = {
    ...base,
    repositories: {
      ...base.repositories,
      trades: { ...trades, put: async (owner: string, record: TradeRecord, options?: WriteOptions) => {
        puts.push({ id: record.id, options });
        if (options?.expectedUpdatedAt !== undefined) return { ok: false as const, error: { code: "conflict" as const, message: "changed" } };
        return trades.put(owner, record, options);
      } },
    },
  } as unknown as PersistenceAdapter;
  const device = collectionDevice(adapter);
  await device.sync.pull();
  device.set([trade("t-1", "device edit")]);
  puts.length = 0;
  assert.equal(await device.sync.flushNow(), false);
  assert.equal(puts.length, 2, "the stale write and one retry, then stop");
  assert.equal(device.sync.getState().status, "error");
  device.sync.dispose();
});

test("server-deleted record edited locally: the update conflicts, get says not_found, and the edit is re-created without expectedUpdatedAt", async () => {
  const fake = createFakeSupabase(UID);
  await directTrades(fake).put(UID, trade("t-1", "v1"));
  const { adapter, puts } = recording(fake);
  const device = collectionDevice(adapter);
  await device.sync.pull();

  const agent = directTrades(fake);
  assert.equal((await agent.remove(UID, "t-1")).ok, true);
  assert.equal(serverRow(fake, "mogmine_trades", "t-1"), undefined);

  device.set([trade("t-1", "edited after the delete")]);
  puts.length = 0;
  assert.equal(await device.sync.flushNow(), true);
  assert.equal(puts.length, 2);
  assert.notEqual(puts[0].options?.expectedUpdatedAt, undefined);
  assert.equal(puts[1].options, undefined, "re-created as a plain upsert: the dirty edit is never dropped");
  assert.equal((serverRow(fake, "mogmine_trades", "t-1")!.record as { note: string }).note, "edited after the delete");
  assert.equal(device.sync.getState().status, "synced");
  device.sync.dispose();
});

test("singleton prefs: a concurrent server update is re-read and the device value is pushed once on top", async () => {
  const fake = createFakeSupabase(UID);
  await directPrefs(fake).put(UID, prefs({ riskBudgetUsd: 300 }));
  const { adapter, singletonPuts } = recording(fake);
  const device = singletonDevice(adapter, DEFAULT_PREFS);
  await device.sync.pull();
  assert.equal(device.value().riskBudgetUsd, 300, "a clean device adopts the server copy");

  // Another writer (the Agent API) updates the prefs document after this device's pull.
  const other = directPrefs(fake);
  const otherWrite = await other.put(UID, prefs({ riskBudgetUsd: 400 }));
  assert.equal(otherWrite.ok, true);
  const otherAt = otherWrite.ok ? otherWrite.value.meta.updated_at : "";

  device.set(prefs({ riskBudgetUsd: 300, goldPreset: "amber" }));
  singletonPuts.length = 0;
  assert.equal(await device.sync.flushNow(), true);
  assert.equal(singletonPuts.length, 2, "one stale write, one retry with the fresh updated_at");
  assert.notEqual(singletonPuts[0]?.expectedUpdatedAt, undefined);
  assert.equal(singletonPuts[1]?.expectedUpdatedAt, otherAt, "the retry is conditional on the other writer's updated_at");
  assert.equal((serverRow(fake, "mogmine_user_prefs")!.record as Prefs).goldPreset, "amber");
  assert.equal(device.sync.getState().status, "synced");
  device.sync.dispose();
});

test("singleton prefs: a conflict that keeps repeating is reported after one retry, never looped", async () => {
  const fake = createFakeSupabase(UID);
  await directPrefs(fake).put(UID, prefs({ riskBudgetUsd: 300 }));
  const { adapter: base, singletonPuts } = recording(fake);
  const prefsRepo = base.repositories.prefs as unknown as SingletonRepository<Prefs>;
  const adapter = {
    ...base,
    repositories: {
      ...base.repositories,
      prefs: { ...prefsRepo, put: async (owner: string, value: Prefs, options?: WriteOptions) => {
        singletonPuts.push(options);
        if (options?.expectedUpdatedAt !== undefined) return { ok: false as const, error: { code: "conflict" as const, message: "changed" } };
        return prefsRepo.put(owner, value, options);
      } },
    },
  } as unknown as PersistenceAdapter;
  const device = singletonDevice(adapter, DEFAULT_PREFS);
  await device.sync.pull();
  device.set(prefs({ goldPreset: "amber" }));
  singletonPuts.length = 0;
  assert.equal(await device.sync.flushNow(), false);
  await settle();
  assert.equal(singletonPuts.length, 2, "the stale write and one retry, then stop");
  assert.equal(device.sync.getState().status, "error");
  device.sync.dispose();
});

test("base metadata saved before R3-05 (no updatedAt) reads as an empty map, not as garbage", () => {
  const storage = createMemoryKeyValueStore({ "mogmine-sync-v1:base:trades": JSON.stringify({ owner: UID, ids: { a: "fp" }, gone: [] }) });
  assert.deepEqual(readBase(storage, "trades"), { owner: UID, ids: { a: "fp" }, gone: [], updatedAt: {} });
});

test("listStored returns the same rows, in the same order, with metadata, on both adapters", async () => {
  const fake = createFakeSupabase(UID);
  const supabase = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const repo = supabase.repositories.trades as unknown as CollectionRepository<TradeRecord>;
  for (const id of ["t-b", "t-a", "t-c"]) assert.equal((await repo.put(UID, trade(id))).ok, true);
  const listed = await repo.list(UID, { limit: 2, offset: 1 });
  const stored = await repo.listStored!(UID, { limit: 2, offset: 1 });
  assert.equal(listed.ok && stored.ok, true);
  if (!listed.ok || !stored.ok) return;
  assert.deepEqual(stored.value.map((row) => row.record), listed.value);
  assert.equal(stored.value.every((row) => row.meta.updated_at === serverRow(fake, "mogmine_trades", row.record.id)!.updated_at), true);

  const device = createLocalAdapter({ kind: "local", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
  const local = device.repositories.trades as unknown as CollectionRepository<TradeRecord>;
  assert.equal((await local.put(DEFAULT_OWNER_USER_ID, trade("l-1"))).ok, true);
  const localStored = await local.listStored!(DEFAULT_OWNER_USER_ID);
  assert.equal(localStored.ok && localStored.value[0]?.meta.user_id, DEFAULT_OWNER_USER_ID);
  assert.equal(localStored.ok && localStored.value[0]?.record.id, "l-1");
});
