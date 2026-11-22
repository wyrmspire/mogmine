import test from "node:test";
import assert from "node:assert/strict";
import {
  addCall, addDismissal, getCallsBackup, getCallsState, removeCall, resetCallsForTests, restoreCalls,
  sanitizeCall, sanitizeCalls, sanitizeCallsBackup, sanitizeDismissal, updateCall,
} from "../calls-store.ts";
import type { CallDraft } from "../calls-store.ts";
import { isAfterTheFact, reasonChipsFor, validateCall } from "../calls.ts";
import type { DiscretionCall } from "../calls.ts";
import { buildBackup, parseBackupFile } from "../store.ts";

const thesis = reasonChipsFor("cut")[0];
const draft = (over: Partial<CallDraft> = {}): CallDraft => ({
  kind: "cut", made_at: "2026-11-20T15:00:00Z", recorded_at: "2026-11-20T15:01:00Z", trade_id: "t1", plan_session_id: null,
  playbook_id: "orb-reclaim", price: 7600.25, price_ticks: 30401, signal_direction: null,
  reasons: [{ id: thesis.id, label: thesis.label, family: thesis.family }], note: "Stalled at VWAP", conviction: 2,
  prompt_id: null, prompt_question: "Why out before stop or target?", origin: "manual", trigger: null, rule: null, made_at_basis: "exact",
  ...over,
});
const stored = (id: string, over: Partial<DiscretionCall> = {}): DiscretionCall => ({ ...draft(), id, user_id: "demo-owner", recorded_at: "2026-11-20T15:01:00.000Z", ...over } as DiscretionCall);

test("DC-2: a saved call is owner-stamped (Invariant 7), keeps its frozen reasons and the §1.4 fields", () => {
  resetCallsForTests();
  const call = addCall(draft({ origin: "close_sheet", trigger: { deviation: "exit_before_target_loss", basis: "recorded" }, prompt_id: "seed:cut" }));
  assert.ok(call);
  assert.equal(call.user_id, "demo-owner");
  assert.match(call.id, /^call-/);
  assert.deepEqual(call.reasons, [{ id: thesis.id, label: thesis.label, family: thesis.family }]);
  assert.equal(call.origin, "close_sheet");
  assert.deepEqual(call.trigger, { deviation: "exit_before_target_loss", basis: "recorded" });
  assert.equal(call.made_at, "2026-11-20T15:00:00.000Z");
  assert.equal(isAfterTheFact(call), false);
  assert.equal(getCallsState().calls.length, 1);
  resetCallsForTests();
});

test("DC-2: the kind's structural rules hold; a retired or custom chip on a saved call is kept", () => {
  assert.equal(sanitizeCall(stored("a", { trade_id: null })), null, "a Cut belongs to a trade");
  assert.equal(sanitizeCall(stored("a", { kind: "skip" })), null, "a Skip has no trade");
  assert.equal(sanitizeCall(stored("a", { kind: "flip", signal_direction: null })), null, "a Flip needs the signal");
  assert.equal(sanitizeCall(stored("a", { made_at: "nope" })), null);
  assert.equal(sanitizeCall({ ...stored("a"), kind: "guess" }), null);
  const custom = sanitizeCall(stored("a", { reasons: [{ id: "owner:cut:spoofed", label: "Spoofed bid", family: "market" }, { id: "owner:cut:spoofed", label: "dup", family: "market" }] }));
  assert.deepEqual(custom?.reasons, [{ id: "owner:cut:spoofed", label: "Spoofed bid", family: "market" }]);
  // Price and ticks go together or not at all; unknown origin and basis fall back safely.
  const odd = sanitizeCall({ ...stored("a"), price_ticks: null, origin: "telepathy", made_at_basis: "maybe", conviction: 7 });
  assert.equal(odd?.price, null);
  assert.equal(odd?.origin, "manual");
  assert.equal(odd?.made_at_basis, "exact");
  assert.equal(odd?.conviction, null);
});

test("DC-2: an edit never changes the id, owner or first recorded time", () => {
  resetCallsForTests();
  const first = addCall(draft({ recorded_at: "2026-11-20T15:01:00Z" }))!;
  const edited = updateCall(first.id, { note: "Thesis broke at VWAP", conviction: 3 });
  assert.equal(edited?.note, "Thesis broke at VWAP");
  assert.equal(edited?.recorded_at, "2026-11-20T15:01:00.000Z");
  assert.equal(edited?.id, first.id);
  assert.equal(updateCall("missing", { note: "x" }), null);
  assert.equal(updateCall(first.id, { trade_id: null }), null, "an edit cannot break the kind's rules");
  assert.equal(getCallsState().calls[0].trade_id, "t1");
  assert.equal(removeCall(first.id), true);
  assert.equal(getCallsState().calls.length, 0);
  resetCallsForTests();
});

test("DC-2: validateCall checks the §1.4 fields", () => {
  assert.deepEqual(validateCall(stored("a")), []);
  assert.match(validateCall(stored("a", { origin: "telepathy" as "manual" })).join(" "), /origin/);
  assert.match(validateCall(stored("a", { made_at_basis: "maybe" as "exact" })).join(" "), /basis/);
  assert.match(validateCall(stored("a", { trigger: { deviation: "bogus" as "no_stop", basis: "recorded" } })).join(" "), /deviation/);
  assert.match(validateCall(stored("a", { prompt_id: "seed:cut", prompt_question: " " })).join(" "), /question/);
});

test("DC-2: dismissals need a trade, a prompt and a reason", () => {
  resetCallsForTests();
  assert.ok(addDismissal({ trade_id: "t1", prompt_id: "seed:cut", deviation: "exit_before_target_loss", reason: "later" }));
  assert.equal(addDismissal({ trade_id: "t1", prompt_id: "seed:cut", deviation: null, reason: "never" as "later" }), null);
  assert.equal(sanitizeDismissal({ id: "d", trade_id: "", prompt_id: "p", reason: "later", recorded_at: "2026-11-20T15:00:00Z" }), null);
  assert.equal(sanitizeDismissal({ id: "d", trade_id: "t", prompt_id: "p", reason: "later", deviation: "bogus", recorded_at: "2026-11-20T15:00:00Z" })?.deviation, null);
  assert.equal(getCallsState().dismissals.length, 1);
  resetCallsForTests();
});

test("DC-2: restore merges by id and this device's edit wins over an older backup", () => {
  resetCallsForTests();
  restoreCalls({ calls: [stored("a", { note: "edited here" })], dismissals: [] });
  restoreCalls({ calls: [stored("a", { note: "old backup" }), stored("b", { made_at: "2026-11-19T15:00:00.000Z", recorded_at: "2026-11-19T15:00:00.000Z" })], dismissals: [] });
  const calls = getCallsState().calls;
  assert.deepEqual(calls.map((call) => [call.id, call.note]), [["b", "Stalled at VWAP"], ["a", "edited here"]]);
  assert.equal(sanitizeCallsBackup(undefined), null);
  assert.equal(sanitizeCallsBackup({ calls: [], dismissals: [] }), null);
  assert.deepEqual(sanitizeCalls("junk"), { calls: [], dismissals: [] });
  resetCallsForTests();
});

test("DC-2: calls round-trip through the journal backup file, and a calls-only backup restores", () => {
  resetCallsForTests();
  addCall(draft());
  addDismissal({ trade_id: "t1", prompt_id: "seed:cut", deviation: null, reason: "not_a_call" });
  const file = JSON.stringify(buildBackup([], undefined, undefined, undefined, undefined, undefined, undefined, undefined, getCallsBackup()));
  const parsed = parseBackupFile(file);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  assert.equal(parsed.calls?.calls.length, 1);
  assert.equal(parsed.calls?.dismissals.length, 1);
  assert.equal(parsed.calls?.calls[0].user_id, "demo-owner");
  // No calls means no `calls` key, so older readers see the same file as before.
  assert.equal("calls" in buildBackup([], undefined, undefined, undefined, undefined, undefined, undefined, undefined, { calls: [], dismissals: [] }), false);
  resetCallsForTests();
});
