import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKED_TEXT, headerSaveLabel, headerSaveTitle, inlineSaveText } from "../save-label.ts";
import type { SyncState } from "../persistence/sync-status.ts";

const sync = (status: SyncState["status"], message: string | null = null): SyncState => ({ status, message, lastSyncedAt: null });

test("device-only mode keeps today's copy everywhere", () => {
  assert.equal(inlineSaveText("saved", false, sync("synced")), "✓ Saved on this device");
  assert.equal(inlineSaveText("idle", false, sync("off")), "✓ Saved on this device");
  assert.equal(inlineSaveText("saving", false, sync("off")), "Saving…");
  assert.equal(inlineSaveText("error", false, sync("off")), BLOCKED_TEXT);
  assert.deepEqual(headerSaveLabel("saved", false, sync("synced")), { state: "saved", text: "Saved on this device" });
});

test("with sync on, the inline note follows the sync status (field notes: it said 'Saved on this device' while synced)", () => {
  assert.equal(inlineSaveText("saved", true, sync("synced")), "✓ Saved to your account");
  assert.equal(inlineSaveText("saved", true, sync("syncing")), "Syncing…");
  assert.equal(inlineSaveText("saved", true, sync("pending")), "Saved on this device — will sync");
  assert.equal(inlineSaveText("saved", true, sync("signed-out")), "Saved on this device — sign in to sync");
  assert.equal(inlineSaveText("saved", true, sync("error")), "Saved on this device — couldn't sync");
  // Remote sync configured but no syncer registered yet: device copy.
  assert.equal(inlineSaveText("saved", true, sync("off")), "✓ Saved on this device");
});

test("a blocked device store wins over any sync status; a local save in flight shows first", () => {
  assert.equal(inlineSaveText("error", true, sync("synced")), BLOCKED_TEXT);
  assert.equal(inlineSaveText("error", true, sync("synced"), { blocked: "Storage is blocked: this lesson will not be kept" }), "Storage is blocked: this lesson will not be kept");
  assert.equal(inlineSaveText("saving", true, sync("synced")), "Saving…");
  assert.deepEqual(headerSaveLabel("error", true, sync("synced")), { state: "error", text: "Not saved — storage is blocked" });
});

test("records that never sync (samples) keep the device copy; check: false drops the tick", () => {
  assert.equal(inlineSaveText("saved", false, sync("synced")), "✓ Saved on this device");
  assert.equal(inlineSaveText("saved", true, sync("synced"), { check: false }), "Saved to your account");
  assert.equal(inlineSaveText("saved", false, sync("off"), { check: false }), "Saved on this device");
});

test("the header keeps its exact strings and tooltip", () => {
  assert.deepEqual(headerSaveLabel("saved", true, sync("synced")), { state: "saved", text: "Synced" });
  assert.deepEqual(headerSaveLabel("saved", true, sync("pending")), { state: "idle", text: "Offline — will sync" });
  assert.deepEqual(headerSaveLabel("saved", true, sync("error")), { state: "error", text: "Sync problem — saved on this device" });
  assert.equal(headerSaveTitle("saved", true, sync("error", "2 records couldn't sync")), "2 records couldn't sync");
  assert.equal(headerSaveTitle("saved", true, sync("synced")), undefined);
  assert.equal(headerSaveTitle("saved", false, sync("error", "x")), undefined);
});
