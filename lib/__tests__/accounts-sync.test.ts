// #191: accounts and balance checks on the collection syncer (lib/accounts-store.ts), against the fake Supabase
// client. Accounts are archived, never hard-deleted (archive policy); balance checks can be removed.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  addAccount, addBalanceCheck, configureAccountsSyncForTests, getAccountsState, hydrateAccounts, removeBalanceCheck,
  resetAccountsForTests, restoreAccounts, updateAccount,
} from "../accounts-store.ts";
import { makeAccount } from "../accounts.ts";
import type { BalanceCheck, TradingAccount } from "../accounts.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { installDevice, manualTimers, rowsIn, writesOf } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const ACCOUNTS_KEY = "mogmine-accounts-v1";
const CHECK_AT = "2026-11-20T21:00:00.000Z";

const account = (id: string, name: string) =>
  makeAccount({ id, name, starting_balance_cents: 5_000_000, now: "2026-11-01T00:00:00.000Z" });
const check = (id: string, accountId: string, balanceCents: number): BalanceCheck =>
  ({ id, account_id: accountId, at: CHECK_AT, balance_cents: balanceCents, note: "" });

const serverAccounts = (fake: FakeSupabase) => rowsIn(fake, "mogmine_accounts").map((row) => row.record as TradingAccount);
const serverChecks = (fake: FakeSupabase) => rowsIn(fake, "mogmine_balance_checks").map((row) => row.record as BalanceCheck);
const serverNames = (fake: FakeSupabase) => serverAccounts(fake).map((item) => `${item.name}:${item.archived}`).sort();
const adapterFor = (fake: FakeSupabase) => createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() });

let device: ReturnType<typeof installDevice> | null = null;

afterEach(() => {
  resetAccountsForTests({ hydrated: false });
  device?.uninstall();
  device = null;
});

/** Install a device holding `seed`, then hydrate the store with both syncers pointed at `fake`. */
async function hydrate(options: { fake: FakeSupabase; seed?: { accounts: TradingAccount[]; checks: BalanceCheck[] }; enabled?: boolean }) {
  device = installDevice(options.seed ? { [ACCOUNTS_KEY]: JSON.stringify(options.seed) } : {});
  resetAccountsForTests({ hydrated: false });
  const timers = manualTimers();
  const adapter = adapterFor(options.fake);
  const common = {
    enabled: options.enabled ?? true,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  };
  const syncs = configureAccountsSyncForTests({ accounts: common, checks: common });
  hydrateAccounts();
  await Promise.all([syncs.accounts.pull(), syncs.checks.pull()]);
  return { syncs, timers };
}

test("disabled: accounts and checks stay on the device, no adapter calls", async () => {
  const fake = createFakeSupabase(UID);
  const { syncs } = await hydrate({ fake, enabled: false });
  addAccount({ name: "Main", starting_balance_cents: 5_000_000 });
  assert.equal(await syncs.accounts.flushNow(), true);
  assert.equal(await syncs.checks.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(getAccountsState().accounts.length, 1);
});

test("first sign-in imports existing accounts and checks once; a second pull sends nothing", async () => {
  const fake = createFakeSupabase(UID);
  const main = account("acct-main", "Main");
  const { syncs } = await hydrate({ fake, seed: { accounts: [main], checks: [check("chk-1", main.id, 5_010_000)] } });
  assert.deepEqual(serverNames(fake), ["Main:false"]);
  assert.equal(serverChecks(fake).length, 1);
  const sent = writesOf(fake).length;
  await Promise.all([syncs.accounts.pull(), syncs.checks.pull()]);
  assert.equal(writesOf(fake).length, sent, "nothing new to send on a second pull");
});

test("add, edit, archive and balance-check changes reach the server with the right rows", async () => {
  const fake = createFakeSupabase(UID);
  const { syncs } = await hydrate({ fake });
  const main = addAccount({ name: "Main", starting_balance_cents: 5_000_000 }, "2026-11-01T00:00:00.000Z");
  const second = addAccount({ name: "Second", starting_balance_cents: 2_000_000 }, "2026-11-01T00:00:00.000Z");
  updateAccount(main.id, { name: "Renamed" });
  updateAccount(second.id, { archived: true });
  const kept = addBalanceCheck({ account_id: main.id, balance_cents: 5_010_000, at: CHECK_AT });
  const dropped = addBalanceCheck({ account_id: main.id, balance_cents: 5_020_000, at: CHECK_AT });
  assert.equal(await syncs.accounts.flushNow(), true);
  assert.equal(await syncs.checks.flushNow(), true);
  assert.deepEqual(serverNames(fake), ["Renamed:false", "Second:true"]);
  assert.deepEqual(serverChecks(fake).map((item) => item.id).sort(), [kept.id, dropped.id].sort());

  removeBalanceCheck(dropped.id);
  assert.equal(await syncs.checks.flushNow(), true);
  assert.deepEqual(serverChecks(fake).map((item) => item.id), [kept.id], "a removed check is deleted on the server");
});

test("a row added on another device appears locally on pull", async () => {
  const fake = createFakeSupabase(UID);
  const remote = account("acct-remote", "Remote");
  await adapterFor(fake).repositories.accounts.put(UID, remote);
  await hydrate({ fake });
  assert.deepEqual(getAccountsState().accounts.map((item) => item.name), ["Remote"]);
  assert.match(device!.memory.get(ACCOUNTS_KEY) ?? "", /Remote/, "the device copy is written too");
});

test("an offline edit stays on the device and is sent on the next flush", async () => {
  const fake = createFakeSupabase(UID);
  const main = account("acct-main", "Main");
  const { syncs } = await hydrate({ fake, seed: { accounts: [main], checks: [] } });
  updateAccount(main.id, { name: "Offline" });
  fake.failNext({ message: "fetch failed" });
  assert.equal(await syncs.accounts.flushNow(), false);
  assert.equal(syncs.accounts.getState().status, "pending");
  assert.equal(getAccountsState().accounts[0].name, "Offline", "the edit is kept on the device");
  assert.deepEqual(serverNames(fake), ["Main:false"]);
  assert.equal(await syncs.accounts.flushNow(), true);
  assert.deepEqual(serverNames(fake), ["Offline:false"]);
});

test("a restore pushes the restored set: checks not in the backup are removed on the server", async () => {
  const fake = createFakeSupabase(UID);
  const old = account("acct-old", "Old");
  const { syncs } = await hydrate({ fake, seed: { accounts: [old], checks: [check("chk-old", old.id, 4_900_000)] } });
  assert.equal(serverChecks(fake).length, 1);

  const restored = account("acct-restored", "Restored");
  restoreAccounts({ accounts: [restored], checks: [] });
  assert.equal(await syncs.accounts.flushNow(), true);
  assert.equal(await syncs.checks.flushNow(), true);
  assert.ok(serverNames(fake).includes("Restored:false"), "the restored account is pushed");
  assert.deepEqual(serverChecks(fake), [], "the check missing from the backup is removed");
  // Accounts are archive-only on the server, so the old account row stays there. This device drops it; see the handoff.
  assert.deepEqual(getAccountsState().accounts.map((item) => item.name), ["Restored"]);
});
