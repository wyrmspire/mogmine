// R3-02: offset/range paging in the repositories and the full-history pull in store-sync. Everything runs against
// the in-memory fake Supabase (no network). Filler mocks that ignore `offset` are covered in store-sync.test.ts.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { REMOTE_ROW_CAP, createCollectionSync, resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import type { CollectionSync } from "../persistence/store-sync.ts";
import { createLocalAdapter, createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { CollectionRepository, PersistenceAdapter } from "../persistence/contract.ts";
import type { TradeRecord } from "../trades.ts";
import { DEFAULT_OWNER_USER_ID, normalizeTrade } from "../trades.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { sampleTrade } from "./persistence-contract-suite.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const LOCAL_OWNER = DEFAULT_OWNER_USER_ID;
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const TOTAL = 2350;
const idOf = (index: number) => `t${String(index).padStart(5, "0")}`;

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

/** Put `count` trades straight into the fake server's table, with ascending `created_at` (the list order). */
function seedServer(fake: FakeSupabase, count: number): void {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const rows = Array.from({ length: count }, (_, index) => {
    const at = new Date(base + index * 1000).toISOString();
    return { user_id: UID, id: idOf(index), record: trade(idOf(index)), created_at: at, updated_at: at };
  });
  fake.tables.set("mogmine_trades", rows);
}

const serverCount = (fake: FakeSupabase) => (fake.tables.get("mogmine_trades") ?? []).filter((row) => row.user_id === UID).length;
const selectsOf = (fake: FakeSupabase) => fake.calls.filter((call) => call === "select mogmine_trades").length;

/** A device-side sync over an in-memory key-value store, timers that never fire by themselves. */
function syncFor(fake: FakeSupabase, initial: TradeRecord[] = []) {
  let list: TradeRecord[] = initial;
  const adapter = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });
  const sync: CollectionSync = createCollectionSync<TradeRecord>({
    key: "trades",
    getLocal: () => list,
    apply: (next) => {
      list = next;
    },
    include: (record) => !record.is_sample,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    enabled: true,
    debounceMs: 800,
    now: () => NOW,
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  return { sync, local: () => list, set: (next: TradeRecord[]) => { list = next; } };
}

afterEach(() => {
  resetSyncRegistryForTests();
});

test("local adapter: list honors offset and limit with no overlap or gaps across pages", async () => {
  const { repositories: repo } = createLocalAdapter({ kind: "local", store: createMemoryKeyValueStore(), candles: createMemoryCandleStore() });
  for (let index = 0; index < 25; index += 1) {
    const put = await repo.trades.put(LOCAL_OWNER, sampleTrade(idOf(index)));
    assert.equal(put.ok, true);
  }
  const all = await repo.trades.list(LOCAL_OWNER, { includeSamples: true, includeArchived: true });
  assert.equal(all.ok, true);
  if (!all.ok) return;
  const order = all.value.map((record) => record.id);
  const pages: string[] = [];
  for (let offset = 0; offset < 25; offset += 10) {
    const page = await repo.trades.list(LOCAL_OWNER, { includeSamples: true, includeArchived: true, limit: 10, offset });
    assert.equal(page.ok, true);
    if (page.ok) pages.push(...page.value.map((record) => record.id));
  }
  assert.deepEqual(pages, order, "concatenated pages equal the full list in order");
  assert.equal(new Set(pages).size, pages.length, "no id appears twice");
  const beyond = await repo.trades.list(LOCAL_OWNER, { includeSamples: true, includeArchived: true, limit: 10, offset: 40 });
  assert.deepEqual(beyond.ok && beyond.value, []);
});

test("supabase adapter: list honors offset and limit across pages (createFakeSupabase)", async () => {
  const fake = createFakeSupabase(UID);
  seedServer(fake, 25);
  const repo = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.trades as unknown as CollectionRepository<TradeRecord>;
  const all = await repo.list(UID, { includeSamples: true, includeArchived: true });
  assert.equal(all.ok, true);
  if (!all.ok) return;
  const pages: string[] = [];
  for (let offset = 0; offset < 25; offset += 10) {
    const page = await repo.list(UID, { includeSamples: true, includeArchived: true, limit: 10, offset });
    assert.equal(page.ok, true);
    if (page.ok) pages.push(...page.value.map((record) => record.id));
  }
  assert.equal(pages.length, 25);
  assert.deepEqual(pages, all.value.map((record) => record.id));
  assert.deepEqual(pages, Array.from({ length: 25 }, (_, index) => idOf(index)), "created_at, id order, no gaps");
});

test("supabase adapter: offset without limit reads to the end (default page of 1000)", async () => {
  const fake = createFakeSupabase(UID);
  seedServer(fake, TOTAL);
  const repo = createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.trades as unknown as CollectionRepository<TradeRecord>;
  const tail = await repo.list(UID, { includeSamples: true, includeArchived: true, offset: 2000 });
  assert.equal(tail.ok && tail.value.length, TOTAL - 2000);
  assert.equal(tail.ok && tail.value[0]?.id, idOf(2000));
});

test("pull pages through a 2,350-row history in three requests and keeps every record", async () => {
  const fake = createFakeSupabase(UID);
  seedServer(fake, TOTAL);
  const h = syncFor(fake);
  await h.sync.pull();
  assert.equal(h.local().length, TOTAL);
  assert.equal(new Set(h.local().map((record) => record.id)).size, TOTAL);
  assert.equal(selectsOf(fake), 3, "1000 + 1000 + 350");
});

test("a remote delete of a clean record drops it on a >1,000-row collection; a dirty edit survives", async () => {
  const fake = createFakeSupabase(UID);
  seedServer(fake, TOTAL);
  const h = syncFor(fake);
  await h.sync.pull(); // base now holds all 2,350 rows, clean

  const edited = h.local().map((record) => (record.id === idOf(2100) ? { ...record, note: "edited here" } : record));
  h.set(edited);
  fake.tables.set("mogmine_trades", (fake.tables.get("mogmine_trades") ?? []).filter((row) => row.id !== idOf(5)));
  assert.equal(serverCount(fake), TOTAL - 1, "2,349 rows remain on the server");

  await h.sync.pull();
  assert.equal(h.local().some((record) => record.id === idOf(5)), false, "clean trade #5 dropped");
  assert.equal(h.local().find((record) => record.id === idOf(2100))?.note, "edited here", "dirty trade #2,100 kept");
  assert.equal(h.local().length, TOTAL - 1);
});
