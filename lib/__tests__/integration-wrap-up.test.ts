// Regressions for the 2026-11-27 integration review: session truth, Current Focus scope and agent attribution.
import test from "node:test";
import assert from "node:assert/strict";
import { CURRENT_FOCUS_STORAGE_KEY, readPinnedCurrentFocus } from "../current-focus.ts";
import { sanitizePrefs } from "../prefs-sanitize.ts";
import { buildSessionSummary } from "../session-summary.ts";
import { addTrade, getTrade, resetJournalForTests, updateTrade } from "../store.ts";
import { sampleTrade } from "./persistence-contract-suite.ts";

const base = { sessionDate: "2026-11-27", plans: [], trades: [] };

test("session summary: no assessment is not a failed one", () => {
  assert.equal(buildSessionSummary(base).process, null);
  assert.equal(buildSessionSummary({ ...base, process: null }).process, null);
  assert.deepEqual(buildSessionSummary({ ...base, process: { followed: 0, total: 2 } }).process, { followed: 0, total: 2 });
});

test("session summary: an unknown check is reported as unverified", () => {
  assert.equal(buildSessionSummary({ ...base, dataConfidence: { missingArchiveSessions: 0, unverifiedFillTimes: 0 } }).dataConfidence.unverified, false);
  assert.equal(buildSessionSummary({ ...base, dataConfidence: { missingArchiveSessions: null } }).dataConfidence.unverified, true);
  assert.equal(buildSessionSummary({ ...base, dataConfidence: { unverifiedFillTimes: 2 } }).dataConfidence.unverified, true);
});

test("current focus: a legacy device value stays in its own scope", () => {
  const stored = new Map<string, string>();
  const globals = globalThis as unknown as Record<string, unknown>;
  const previous = { window: globals.window, localStorage: globals.localStorage };
  globals.window = {};
  globals.localStorage = { getItem: (key: string) => stored.get(key) ?? null };
  try {
    const prefs = sanitizePrefs({});
    stored.set(CURRENT_FOCUS_STORAGE_KEY, JSON.stringify({ text: "Wait for the retest", sessionDate: "2026-11-26", sourceAccountId: "a" }));
    assert.equal(readPinnedCurrentFocus("a", prefs)?.text, "Wait for the retest");
    assert.equal(readPinnedCurrentFocus("b", prefs), null);
    assert.equal(readPinnedCurrentFocus(null, prefs), null);
  } finally {
    Object.assign(globals, previous);
  }
});

test("agent attribution: a trader edit drops only the fields it changed", () => {
  resetJournalForTests();
  addTrade({ ...sampleTrade("t-prov"), note: "agent note", management_notes: "agent management",
    agent_provenance: { token_prefix: "tok", at: "2026-11-27T00:00:00.000Z" }, agent_provenance_fields: ["note", "management_notes"] });
  updateTrade("t-prov", { note: "my note" });
  assert.deepEqual(getTrade("t-prov")?.agent_provenance_fields, ["management_notes"]);
  updateTrade("t-prov", { management_notes: "mine too" });
  assert.equal(getTrade("t-prov")?.agent_provenance, undefined);
  resetJournalForTests();
});
