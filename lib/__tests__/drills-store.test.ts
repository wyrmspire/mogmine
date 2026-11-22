import test from "node:test";
import assert from "node:assert/strict";
import { addDrillAnswer, getDrillsState, resetDrillsForTests, restoreDrills, sanitizeDrillRecord, sanitizeDrills, sanitizeDrillsBackup } from "../drills-store.ts";
import type { DrillRecord } from "../drills.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import { demoTrades } from "../fixtures.ts";

const record = (id: string, at: string, over: Partial<DrillRecord> = {}): DrillRecord => ({
  id, user_id: "demo-owner", trade_id: "t1", kind: "take_it", answer: "take", answered_at: at, hidden: ["bars_after_entry"], ...over,
});

test("CD-2b: records are sanitized, owner-stamped (Invariant 7), deduped by id and kept oldest first", () => {
  assert.equal(sanitizeDrillRecord({ ...record("a", "2026-11-20T10:00:00Z"), answer: "maybe" }), null);
  assert.equal(sanitizeDrillRecord({ ...record("a", "2026-11-20T10:00:00Z"), kind: "guess" }), null);
  assert.equal(sanitizeDrillRecord({ ...record("a", "not a date") }), null);
  assert.equal(sanitizeDrillRecord({ ...record("a", "2026-11-20T10:00:00Z"), user_id: "" })?.user_id, "demo-owner");
  const list = sanitizeDrills([record("b", "2026-11-21T10:00:00Z"), record("a", "2026-11-20T10:00:00Z"), record("a", "2026-11-22T10:00:00Z", { answer: "pass" })]);
  assert.deepEqual(list.map((r) => [r.id, r.answer]), [["a", "take"], ["b", "take"]]);
  assert.equal(sanitizeDrillsBackup(undefined), null);
  assert.equal(sanitizeDrillsBackup([]), null);
});

test("CD-2b: every answer is appended, even for the same trade", () => {
  resetDrillsForTests();
  addDrillAnswer({ trade_id: "t1", kind: "take_it", answer: "take", hidden: ["bars_after_entry"], answered_at: "2026-11-20T10:00:00Z" });
  addDrillAnswer({ trade_id: "t1", kind: "take_it", answer: "pass", hidden: ["bars_after_entry"] });
  const records = getDrillsState().records;
  assert.equal(records.length, 2);
  assert.equal(records[0].answered_at, "2026-11-20T10:00:00.000Z");
  assert.ok(Number.isFinite(Date.parse(records[1].answered_at)));
  assert.notEqual(records[0].id, records[1].id);
  assert.equal(addDrillAnswer({ trade_id: "", kind: "take_it", answer: "take", hidden: [] }), null);
  resetDrillsForTests();
});

test("CD-2b: restoring merges by id, so an older backup never erases newer answers", () => {
  resetDrillsForTests();
  restoreDrills([record("old", "2026-11-18T10:00:00Z")]);
  restoreDrills([record("new", "2026-11-21T10:00:00Z"), record("old", "2026-11-18T10:00:00Z")]);
  restoreDrills([record("old", "2026-11-18T10:00:00Z")]);
  assert.deepEqual(getDrillsState().records.map((r) => r.id), ["old", "new"]);
  restoreDrills(undefined);
  assert.equal(getDrillsState().records.length, 2);
  resetDrillsForTests();
});

test("CD-2b: drill answers round-trip through the journal backup; older backups carry none", () => {
  const drills = [record("a", "2026-11-20T10:00:00Z")];
  const parsed = parseBackupFile(JSON.stringify(buildBackup([], undefined, undefined, undefined, undefined, undefined, undefined, drills)));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.drills, [{ ...drills[0], answered_at: "2026-11-20T10:00:00.000Z" }]);
  const olderBackup = buildBackup(demoTrades.slice(0, 1));
  assert.equal("drills" in olderBackup, false);
  const older = parseBackupFile(JSON.stringify(olderBackup));
  assert.equal(older.ok, true);
  if (older.ok) assert.equal(older.drills, undefined);
});
