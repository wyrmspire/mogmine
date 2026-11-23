// #192: the playbook list on the sync layer, through the real store (lib/playbooks-store.ts) and the fake client.
// Pushes go through the debounce that `changed()` arms (`timers.fire()`), so a missing wire-up fails the test.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  PLAYBOOKS_STORAGE_KEY, configurePlaybooksSyncForTests, createPlaybook, getPlaybooksState, hydratePlaybooks,
  resetPlaybooksForTests, restorePlaybooks, setPlaybookArchived, updatePlaybook,
} from "../playbooks-store.ts";
import type { PlaybookDraft } from "../playbooks-store.ts";
import { PLAYBOOK_SEEDS } from "../playbooks.ts";
import type { Playbook } from "../playbooks.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { resetSyncRegistryForTests } from "../persistence/store-sync.ts";
import { createFakeSupabase } from "./fake-supabase.ts";
import type { FakeSupabase } from "./fake-supabase.ts";
import {
  UID, adapterFor, installDevice, removeDevice, serverIds, serverRecord, settle, storeSyncOptions, writesOf,
} from "./store-sync-harness.ts";

const TABLE = "mogmine_playbooks";
const draft = (name: string): PlaybookDraft => ({ name, default_style: "scalp", checklist_rules: [{ id: "r1", label: "Wait for the close" }] });
const custom = (id: string, name: string): Playbook => ({
  id, user_id: DEFAULT_OWNER_USER_ID, name, default_style: "session_90m", checklist_rules: [{ id: "r1", label: "Sweep first" }], archived: false,
});

afterEach(() => {
  resetPlaybooksForTests();
  resetSyncRegistryForTests();
  removeDevice();
});

test("disabled: the store makes no adapter calls and keeps working on the device", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake, false);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  assert.equal(createPlaybook(draft("Local Only")).ok, true);
  timers.fire();
  assert.equal(await sync.flushNow(), true);
  assert.deepEqual(fake.calls, []);
  assert.equal(timers.live().length, 0);
  assert.equal(sync.getState().status, "off");
  assert.match(device.get(PLAYBOOKS_STORAGE_KEY) ?? "", /Local Only/);
});

test("first sign-in imports device playbooks once; a second pull sends nothing", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  device.set(PLAYBOOKS_STORAGE_KEY, JSON.stringify([...PLAYBOOK_SEEDS, custom("mine", "Mine")]));
  const { options } = storeSyncOptions(fake);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  await sync.pull();
  assert.equal(sync.getState().status, "synced");
  const expected = [...PLAYBOOK_SEEDS.map((item) => item.id), "mine"].sort();
  assert.deepEqual(serverIds(fake, TABLE), expected);

  fake.calls.splice(0);
  await sync.pull();
  assert.deepEqual(writesOf(fake), []);
});

test("add, edit and archive reach the server as rows, never as deletes", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  await sync.pull();

  const created = createPlaybook(draft("Late Fade"));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const id = created.playbook.id;
  timers.fire();
  await settle();
  assert.equal(serverRecord(fake, TABLE, id)?.name, "Late Fade");

  assert.equal(updatePlaybook(id, draft("Late Fade v2")).ok, true);
  assert.equal(setPlaybookArchived(id, true).ok, true);
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");

  const row = serverRecord(fake, TABLE, id);
  assert.equal(row?.name, "Late Fade v2");
  assert.equal(row?.archived, true, "archived, not removed");
  assert.equal(fake.calls.some((call) => call.startsWith("delete")), false);
});

test("a playbook saved on another device appears here", async () => {
  installDevice();
  const fake = createFakeSupabase(UID);
  await adapterFor(fake).repositories.playbooks.put(UID, custom("remote-fade", "Remote Fade"));
  const { options } = storeSyncOptions(fake);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  await sync.pull();

  const found = getPlaybooksState().playbooks.find((item) => item.id === "remote-fade");
  assert.equal(found?.name, "Remote Fade");
});

test("an offline edit stays on this device and goes out on the next flush", async () => {
  const device = installDevice();
  const fake = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  await sync.pull();

  assert.equal(createPlaybook(draft("Offline Idea")).ok, true);
  fake.failNext({ message: "fetch failed" });
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "pending");
  assert.ok(getPlaybooksState().playbooks.some((item) => item.name === "Offline Idea"));
  assert.match(device.get(PLAYBOOKS_STORAGE_KEY) ?? "", /Offline Idea/);
  assert.equal(serverIds(fake, TABLE).length, PLAYBOOK_SEEDS.length, "not sent yet");

  assert.equal(await sync.flushNow(), true);
  assert.ok(serverIds(fake, TABLE).some((id) => serverRecord(fake, TABLE, id)?.name === "Offline Idea"));
});

test("restoring a backup pushes the restored list", async () => {
  installDevice();
  const fake: FakeSupabase = createFakeSupabase(UID);
  const { timers, options } = storeSyncOptions(fake);
  const sync = configurePlaybooksSyncForTests(options);
  hydratePlaybooks();
  await sync.pull();

  restorePlaybooks([...PLAYBOOK_SEEDS, custom("restored-1", "Restored Idea")]);
  timers.fire();
  await settle();
  assert.equal(sync.getState().status, "synced");
  assert.equal(serverRecord(fake, TABLE, "restored-1")?.name, "Restored Idea");
  assert.ok(PLAYBOOK_SEEDS.every((seed) => serverIds(fake, TABLE).includes(seed.id)));
});
