// #175: the shared contract suite. Every adapter (local, mock, and the Supabase adapter in #176) runs this same file.
// Each `make` call must return a fresh, empty adapter for the demo owner.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OWNER_USER_ID, normalizeTrade } from "../trades.ts";
import type { Candle, TradeRecord } from "../trades.ts";
import type { PersistenceAdapter } from "../persistence/contract.ts";
import { DEFAULT_PREFS } from "../prefs.ts";

export function sampleTrade(id: string, overrides: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-02T14:30:00.000Z",
    exit_time: "2026-11-02T14:45:00.000Z",
    entry_price: 5000,
    exit_price: 5004,
    ...overrides,
  });
}

export function runPersistenceContractSuite(label: string, make: () => PersistenceAdapter | Promise<PersistenceAdapter>) {
  test(`${label}: owner is the demo owner`, async () => {
    const adapter = await make();
    assert.equal(await adapter.currentOwner(), DEFAULT_OWNER_USER_ID);
  });

  test(`${label}: trades round-trip through put, get and list`, async () => {
    const { repositories: repo } = await make();
    const trade = sampleTrade("t-1");
    const put = await repo.trades.put(DEFAULT_OWNER_USER_ID, trade);
    assert.ok(put.ok, put.ok ? "" : put.error.message);
    assert.equal(put.value.record.id, "t-1");
    assert.equal(put.value.meta.user_id, DEFAULT_OWNER_USER_ID);
    const got = await repo.trades.get(DEFAULT_OWNER_USER_ID, "t-1");
    assert.ok(got.ok);
    assert.equal(got.value.record.entry_price, 5000);
    const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
    assert.ok(listed.ok);
    assert.deepEqual(listed.value.map((row) => row.id), ["t-1"]);
  });

  test(`${label}: put replaces an existing id rather than duplicating it`, async () => {
    const { repositories: repo } = await make();
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1", { exit_price: 5010 }));
    const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
    assert.ok(listed.ok);
    assert.equal(listed.value.length, 1);
    assert.equal(listed.value[0].exit_price, 5010);
  });

  test(`${label}: a record that fails validation is invalid and nothing is written`, async () => {
    const { repositories: repo } = await make();
    const bad = { ...sampleTrade("t-bad"), id: "" };
    const result = await repo.trades.put(DEFAULT_OWNER_USER_ID, bad);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid");
    const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
    assert.ok(listed.ok);
    assert.equal(listed.value.length, 0);
  });

  test(`${label}: list hides samples when includeSamples is false`, async () => {
    const { repositories: repo } = await make();
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("real"));
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("demo", { is_sample: true }));
    const all = await repo.trades.list(DEFAULT_OWNER_USER_ID);
    const stats = await repo.trades.list(DEFAULT_OWNER_USER_ID, { includeSamples: false });
    assert.ok(all.ok && stats.ok);
    assert.equal(all.value.length, 2);
    assert.deepEqual(stats.value.map((row) => row.id), ["real"]);
  });

  test(`${label}: expectedUpdatedAt guards against a stale write`, async () => {
    const { repositories: repo } = await make();
    const first = await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
    assert.ok(first.ok);
    const stale = await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1", { exit_price: 5002 }), { expectedUpdatedAt: "1999-01-01T00:00:00.000Z" });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, "conflict");
    const fresh = await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1", { exit_price: 5002 }), { expectedUpdatedAt: first.value.meta.updated_at });
    assert.ok(fresh.ok);
  });

  test(`${label}: other owners see nothing and cannot write`, async () => {
    const { repositories: repo } = await make();
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
    const listed = await repo.trades.list("someone-else");
    assert.ok(listed.ok);
    assert.equal(listed.value.length, 0);
    const got = await repo.trades.get("someone-else", "t-1");
    assert.equal(got.ok, false);
    if (!got.ok) assert.equal(got.error.code, "not_found");
    const written = await repo.trades.put("someone-else", sampleTrade("t-2"));
    assert.equal(written.ok, false);
    if (!written.ok) assert.equal(written.error.code, "forbidden");
  });

  test(`${label}: hard delete removes the row; archive-policy types refuse`, async () => {
    const { repositories: repo } = await make();
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("t-1"));
    const removed = await repo.trades.remove(DEFAULT_OWNER_USER_ID, "t-1");
    assert.ok(removed.ok);
    const gone = await repo.trades.get(DEFAULT_OWNER_USER_ID, "t-1");
    assert.equal(gone.ok, false);
    const archive = await repo.accounts.remove(DEFAULT_OWNER_USER_ID, "acct-1");
    assert.equal(archive.ok, false);
    if (!archive.ok) assert.equal(archive.error.code, "forbidden");
  });

  test(`${label}: replaceAll swaps the whole list for the owner`, async () => {
    const { repositories: repo } = await make();
    await repo.trades.put(DEFAULT_OWNER_USER_ID, sampleTrade("old"));
    const replaced = await repo.trades.replaceAll(DEFAULT_OWNER_USER_ID, [sampleTrade("a"), sampleTrade("b")]);
    assert.ok(replaced.ok);
    const listed = await repo.trades.list(DEFAULT_OWNER_USER_ID);
    assert.ok(listed.ok);
    assert.deepEqual(listed.value.map((row) => row.id).sort(), ["a", "b"]);
  });

  test(`${label}: prefs singleton is null until the first write`, async () => {
    const { repositories: repo } = await make();
    const before = await repo.prefs.get(DEFAULT_OWNER_USER_ID);
    assert.ok(before.ok);
    assert.equal(before.value, null);
    const put = await repo.prefs.put(DEFAULT_OWNER_USER_ID, { ...DEFAULT_PREFS, shield: true });
    assert.ok(put.ok);
    const after = await repo.prefs.get(DEFAULT_OWNER_USER_ID);
    assert.ok(after.ok && after.value);
    assert.equal(after.value.record.shield, true);
  });

  test(`${label}: candle cache round-trips candles by key`, async () => {
    const { repositories: repo } = await make();
    const miss = await repo.candles.get("MES|x");
    assert.ok(miss.ok);
    assert.equal(miss.value, null);
    const candle: Candle = { time: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 };
    const put = await repo.candles.put("MES|x", [candle]);
    assert.ok(put.ok);
    const hit = await repo.candles.get("MES|x");
    assert.ok(hit.ok && hit.value);
    assert.equal(hit.value.length, 1);
  });
}
