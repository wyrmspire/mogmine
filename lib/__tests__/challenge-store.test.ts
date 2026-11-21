import test from "node:test";
import assert from "node:assert/strict";
import {
  endChallenge,
  getChallengesBackup,
  getChallengesState,
  resetChallengesForTests,
  restoreChallenges,
  sanitizeChallengeRules,
  sanitizeChallenges,
  startChallenge,
} from "../challenge-store.ts";
import { CHALLENGE_CALC_VERSION } from "../challenges.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import type { TradeRecord } from "../trades.ts";

function fakeTrade(): TradeRecord {
  return {
    id: "t1",
    user_id: "test-user",
    account_id: null,
    symbol: "MES",
    yahoo_ticker: "MES=F",
    direction: "LONG",
    trade_style: "scalp",
    status: "closed",
    entry_time: "2026-11-17T14:30:00Z",
    exit_time: "2026-11-17T14:45:00Z",
    entry_price: 6000.0,
    exit_price: 6010.0,
    stop_loss_price: 5990.0,
    initial_stop_price: 5990.0,
    initial_stop_set_at: "2026-11-17T14:30:00Z",
    planned_target_price: 6020.0,
    key_level_price: null,
    quantity: 1,
    note: "",
    review_status: "reviewed",
    playbook_id: "pb-trend",
    quick_tags: [],
    checklist_state: [{ id: "r1", label: "Rule 1", checked: true }],
    pre_trade_thesis: "",
    management_notes: "",
    post_exit_notes: "",
    flagged: false,
    take_again: null,
    take_again_at: null,
    is_sample: false,
    sparkline: [],
  };
}

test("R-09b: startChallenge enforces at most one active challenge of each kind", () => {
  resetChallengesForTests();

  const dd1 = startChallenge({
    kind: "drawdown",
    sessions: 20,
    max_drawdown_cents: 30000,
  }, "2026-11-17T14:00:00Z");
  assert.equal(dd1.ok, true);
  if (!dd1.ok) return;
  assert.equal(dd1.challenge.rules.kind, "drawdown");
  assert.equal(dd1.challenge.ended_at, null);

  // Attempting second active drawdown challenge is refused
  const dd2 = startChallenge({
    kind: "drawdown",
    sessions: 10,
    max_drawdown_cents: 15000,
  });
  assert.equal(dd2.ok, false);
  if (!dd2.ok) {
    assert.match(dd2.error, /already running/i);
  }

  // An active clean_run challenge can be started concurrently (one of EACH kind)
  const cr1 = startChallenge({
    kind: "clean_run",
    target_trades: 10,
    playbook_ids: ["pb-1"],
  });
  assert.equal(cr1.ok, true);
  if (!cr1.ok) return;

  // A second clean_run is refused
  const cr2 = startChallenge({
    kind: "clean_run",
    target_trades: 5,
    playbook_ids: ["pb-2"],
  });
  assert.equal(cr2.ok, false);

  // Once dd1 is ended, a new drawdown challenge can be started
  endChallenge(dd1.challenge.id, undefined, "2026-11-17T16:00:00Z");
  const state = getChallengesState();
  const ended = state.challenges.find((c) => c.id === dd1.challenge.id);
  assert.equal(ended?.ended_at, "2026-11-17T16:00:00Z");

  const dd3 = startChallenge({
    kind: "drawdown",
    sessions: 15,
    max_drawdown_cents: 20000,
  });
  assert.equal(dd3.ok, true);
});

test("R-09b: endChallenge saves final result and preserves ended attempts", () => {
  resetChallengesForTests();

  const c = startChallenge({
    kind: "clean_run",
    target_trades: 5,
    playbook_ids: ["pb-1"],
  }, "2026-11-18T11:00:00Z");
  assert.equal(c.ok, true);
  if (!c.ok) return;

  endChallenge(
    c.challenge.id,
    {
      state: "passed",
      provisional: false,
      issues: [],
      points: [],
      decided_by: "trade-99",
      excluded_before_start: 0,
      run: 5,
      best_run: 5,
    },
    "2026-11-18T12:00:00Z",
  );

  endChallenge(c.challenge.id, {
    state: "failed", provisional: false, issues: [], points: [],
    decided_by: null, excluded_before_start: 0,
  }, "2026-11-18T13:00:00Z");

  const updated = getChallengesState().challenges.find((item) => item.id === c.challenge.id);
  assert.ok(updated);
  assert.equal(updated.ended_at, "2026-11-18T12:00:00Z");
  assert.equal(updated.final?.state, "passed");
  assert.equal(updated.final?.decided_by, "trade-99");
});

test("R-09b: backup round-trips challenges", () => {
  const challenge1: ChallengeDefinition = {
    id: "c-1",
    user_id: "test-user",
    rules: { kind: "drawdown", sessions: 20, max_drawdown_cents: 30000 },
    started_at: "2026-11-17T14:00:00Z",
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };
  const challenge2: ChallengeDefinition = {
    id: "c-2",
    user_id: "test-user",
    rules: { kind: "clean_run", target_trades: 10, playbook_ids: ["pb-1", "pb-2"] },
    started_at: "2026-11-16T14:00:00Z",
    ended_at: "2026-11-17T10:00:00Z",
    calc_version: CHALLENGE_CALC_VERSION,
    final: {
      state: "failed",
      provisional: false,
      issues: [],
      points: [],
      decided_by: null,
      excluded_before_start: 1,
      run: 2,
      best_run: 4,
    },
  };

  const backup = buildBackup([fakeTrade()], undefined, undefined, undefined, [challenge1, challenge2]);
  assert.deepEqual(backup.challenges, [challenge1, challenge2]);

  const json = JSON.stringify(backup);
  const parsed = parseBackupFile(json);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.ok(parsed.challenges);
  assert.equal(parsed.challenges.length, 2);
  assert.deepEqual(parsed.challenges[0], challenge1);
  assert.deepEqual(parsed.challenges[1], challenge2);

  // Restore challenges into store
  resetChallengesForTests();
  restoreChallenges(parsed.challenges);
  assert.deepEqual(getChallengesBackup(), [challenge1, challenge2]);

  const withoutTrades = parseBackupFile(JSON.stringify(buildBackup([], undefined, undefined, undefined, [challenge1])));
  assert.equal(withoutTrades.ok, true);
  if (!withoutTrades.ok) return;
  assert.deepEqual(withoutTrades.trades, []);
  assert.deepEqual(withoutTrades.challenges, [challenge1]);
});

test("R-09b: legacy backup restores without challenges", () => {
  const legacyBackup = {
    app: "mogmine",
    version: 1,
    exportedAt: "2026-11-15T00:00:00Z",
    includesCandles: false,
    trades: [fakeTrade()],
  };

  const parsed = parseBackupFile(JSON.stringify(legacyBackup));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.challenges, undefined);

  resetChallengesForTests();
  assert.equal(startChallenge({ kind: "clean_run", target_trades: 3, playbook_ids: [] }).ok, true);
  restoreChallenges(parsed.challenges);
  assert.deepEqual(getChallengesState().challenges, []);
});

test("R-09b: corrupt challenges in backup do not drop trades or crash", () => {
  const backupWithBadChallenges = {
    app: "mogmine",
    version: 1,
    exportedAt: "2026-11-15T00:00:00Z",
    includesCandles: false,
    trades: [fakeTrade()],
    challenges: [
      { id: "", rules: null },
      { id: "bad-rules", rules: { kind: "unknown" } },
      { id: "bad-time", rules: { kind: "drawdown", sessions: 10, max_drawdown_cents: 5000 }, started_at: "not-a-date" },
    ],
  };

  const parsed = parseBackupFile(JSON.stringify(backupWithBadChallenges));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.trades.length, 1);
  assert.deepEqual(parsed.challenges, []);
});

test("R-09b: sanitization rules and duplicates", () => {
  assert.equal(sanitizeChallengeRules(null), null);
  assert.equal(sanitizeChallengeRules({ kind: "drawdown", sessions: 0, max_drawdown_cents: 100 }), null);
  assert.equal(sanitizeChallengeRules({ kind: "drawdown", sessions: 5, max_drawdown_cents: -50 }), null);
  assert.equal(sanitizeChallengeRules({ kind: "clean_run", target_trades: 0, playbook_ids: [] }), null);

  const validDef: ChallengeDefinition = {
    id: "c-dup",
    user_id: "u-1",
    rules: { kind: "drawdown", sessions: 10, max_drawdown_cents: 10000 },
    started_at: "2026-11-17T12:00:00Z",
    ended_at: null,
    calc_version: 1,
  };

  // Duplicate IDs and conflicting active attempts are filtered
  const list = sanitizeChallenges([validDef, validDef, { ...validDef, id: "another-active" }]);
  assert.equal(list.length, 1);
});

test("R-09b: start validates rule ranges and takes a snapshot of the input", () => {
  resetChallengesForTests();
  assert.equal(startChallenge({ kind: "drawdown", sessions: 61, max_drawdown_cents: 30000 }).ok, false);
  assert.equal(startChallenge({ kind: "drawdown", sessions: 1, max_drawdown_cents: 0.4 }).ok, false);
  assert.equal(startChallenge({ kind: "clean_run", target_trades: 2, playbook_ids: [] }).ok, false);

  const playbooks = ["pb-1"];
  const result = startChallenge({ kind: "clean_run", target_trades: 3, playbook_ids: playbooks });
  assert.ok(result.ok);
  playbooks.push("pb-2");
  assert.deepEqual(getChallengesBackup()[0]?.rules, {
    kind: "clean_run", target_trades: 3, playbook_ids: ["pb-1"],
  });
});

test("R-09b: malformed result points cannot enter a restored attempt", () => {
  const ended = {
    id: "ended", user_id: "test-user", rules: { kind: "clean_run", target_trades: 3, playbook_ids: [] },
    started_at: "2026-11-17T14:00:00Z", ended_at: "2026-11-17T15:00:00Z", calc_version: 1,
  };
  assert.deepEqual(sanitizeChallenges([{
    ...ended,
    final: {
      state: "passed", provisional: false, issues: [], points: [null],
      decided_by: null, excluded_before_start: 0,
    },
  }]), [ended]);
});
