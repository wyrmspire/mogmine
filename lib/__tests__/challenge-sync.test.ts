// #191: challenges on the collection syncer (lib/challenge-store.ts), against the fake Supabase client. Records carry
// `user_id` = DEFAULT_OWNER_USER_ID on the device; the adapter stamps the signed-in owner on the server.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  configureChallengesSyncForTests, endChallenge, getChallengesState, hydrateChallenges, resetChallengesForTests,
  restoreChallenges, startChallenge,
} from "../challenge-store.ts";
import { CHALLENGE_CALC_VERSION } from "../challenges.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { createMemoryCandleStore, createMemoryKeyValueStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import { installDevice, manualTimers, rowsIn, settle, writesOf } from "./sync-test-helpers.ts";

const UID = "11111111-2222-4333-8444-555555555555";
const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const STORAGE_KEY = "mogmine-challenges-v1";
const STARTED = "2026-11-02T14:00:00.000Z";
const ENDED = "2026-11-02T20:00:00.000Z";

const drawdown = (id: string): ChallengeDefinition => ({
  id,
  user_id: DEFAULT_OWNER_USER_ID,
  rules: { kind: "drawdown", sessions: 20, max_drawdown_cents: 30_000 },
  started_at: STARTED,
  ended_at: null,
  calc_version: CHALLENGE_CALC_VERSION,
});

const serverIds = (fake: FakeSupabase) => rowsIn(fake, "mogmine_challenges").map((row) => String(row.id)).sort();
const serverEnded = (fake: FakeSupabase, id: string) =>
  (rowsIn(fake, "mogmine_challenges").find((row) => row.id === id)?.record as ChallengeDefinition | undefined)?.ended_at ?? null;
const ids = () => getChallengesState().challenges.map((item) => item.id).sort();

let device: ReturnType<typeof installDevice> | null = null;

afterEach(() => {
  resetChallengesForTests();
  device?.uninstall();
  device = null;
});

/** Install a device holding `seed`, then hydrate the store with the syncer pointed at `fake`. */
async function hydrate(options: { fake: FakeSupabase; seed?: ChallengeDefinition[]; enabled?: boolean }) {
  device = installDevice(options.seed ? { [STORAGE_KEY]: JSON.stringify(options.seed) } : {});
  resetChallengesForTests();
  const timers = manualTimers();
  const adapter = createSupabaseAdapter({ client: options.fake, candles: createMemoryCandleStore() });
  const sync = configureChallengesSyncForTests({
    enabled: options.enabled ?? true,
    adapter: () => adapter,
    storage: createMemoryKeyValueStore(),
    debounceMs: 800,
    now: () => NOW,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  hydrateChallenges();
  await sync.pull();
  return { sync, timers };
}

test("disabled: challenges stay on the device, no adapter calls", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = await hydrate({ fake, enabled: false });
  const started = startChallenge({ kind: "clean_run", target_trades: 5, playbook_ids: [] }, STARTED);
  assert.equal(started.ok, true);
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(getChallengesState().challenges.length, 1);
});

test("first sign-in imports existing challenges once; a second pull sends nothing", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = await hydrate({ fake, seed: [drawdown("chal-1")] });
  assert.deepEqual(serverIds(fake), ["chal-1"]);
  const sent = writesOf(fake).length;
  await sync.pull();
  assert.equal(writesOf(fake).length, sent, "nothing new to send on a second pull");
});

test("starting and ending a challenge reach the server", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = await hydrate({ fake });
  const started = startChallenge({ kind: "clean_run", target_trades: 5, playbook_ids: [] }, STARTED);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(serverIds(fake), [started.challenge.id]);

  endChallenge(started.challenge.id, undefined, ENDED);
  assert.equal(await sync.flushNow(), true);
  assert.equal(serverEnded(fake, started.challenge.id), ENDED);
});

test("a challenge started on another device appears locally on pull", async () => {
  const fake = createFakeSupabase(UID);
  await createSupabaseAdapter({ client: fake, candles: createMemoryCandleStore() }).repositories.challenges.put(UID, drawdown("chal-remote"));
  await hydrate({ fake });
  assert.deepEqual(ids(), ["chal-remote"]);
  assert.match(device!.memory.get(STORAGE_KEY) ?? "", /chal-remote/, "the device copy is written too");
});

test("an offline change stays on the device and is sent on the next flush", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = await hydrate({ fake });
  const started = startChallenge({ kind: "clean_run", target_trades: 5, playbook_ids: [] }, STARTED);
  if (!started.ok) assert.fail("the challenge should start");
  fake.failNext({ message: "fetch failed" });
  assert.equal(await sync.flushNow(), false);
  assert.equal(sync.getState().status, "pending");
  assert.equal(getChallengesState().challenges.length, 1, "kept on the device");
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(serverIds(fake), [started.challenge.id]);
  await settle();
});

test("a restore pushes the restored set: a challenge not in the backup is removed on the server", async () => {
  const fake = createFakeSupabase(UID);
  const { sync } = await hydrate({ fake, seed: [drawdown("chal-old")] });
  assert.deepEqual(serverIds(fake), ["chal-old"]);

  restoreChallenges([drawdown("chal-restored")]);
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(serverIds(fake), ["chal-restored"]);
});
