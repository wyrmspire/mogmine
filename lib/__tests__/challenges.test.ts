import test from "node:test";
import assert from "node:assert/strict";
import {
  CHALLENGE_CALC_VERSION,
  evaluateChallenge,
} from "../challenges.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import type { TradeRecord } from "../trades.ts";

function makeTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: "trade-" + Math.random().toString(36).slice(2, 8),
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
    exit_price: 6010.0, // +$50 for MES 1 contract
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
    ...overrides,
  };
}

test("an undated trade keeps both challenge paths provisional (OD-47)", () => {
  const undated = makeTrade({ id: "undated", exit_time: "invalid-time" });
  const rules: ChallengeDefinition["rules"][] = [
    { kind: "drawdown", sessions: 1, max_drawdown_cents: 5_000 },
    { kind: "clean_run", target_trades: 1, playbook_ids: ["pb-trend"] },
  ];
  for (const rule of rules) {
    const def: ChallengeDefinition = {
      id: "undated-case", user_id: "test-user", rules: rule,
      started_at: "2026-11-17T14:00:00Z", ended_at: null, calc_version: CHALLENGE_CALC_VERSION,
    };
    const known = makeTrade({ id: "dated", exit_price: 5990 });
    const now = Date.parse("2026-11-18T20:00:00Z");
    assert.equal(evaluateChallenge(def, [known], now).state, rule.kind === "drawdown" ? "failed" : "passed");
    const result = evaluateChallenge(def, [known, undated], now);
    assert.equal(result.state, "active");
    assert.equal(result.provisional, true);
    assert.deepEqual(result.points.map(({ trade_id }) => trade_id), ["dated"]);
    assert.deepEqual(result.issues, [{ trade_id: "undated", reason: "undated" }]);
  }
});

test("Drawdown Defender golden cases (docs/17 §3)", () => {
  const startedAt = "2026-11-17T14:00:00Z";
  const def: ChallengeDefinition = {
    id: "dd-test",
    user_id: "test-user",
    rules: {
      kind: "drawdown",
      sessions: 20,
      max_drawdown_cents: 30000, // $300.00
    },
    started_at: startedAt,
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };

  // MES point value is $5, tick is 0.25 pt ($1.25).
  // Golden Case 1: +200, +200, -100, -150 -> equity +150, peak 400, drawdown 250, max DD 250, Active, $50 left
  const t1 = makeTrade({ id: "t1", entry_time: "2026-11-17T14:05:00Z", exit_time: "2026-11-17T14:10:00Z", entry_price: 6000, exit_price: 6040 }); // +40 pts = +$200
  const t2 = makeTrade({ id: "t2", entry_time: "2026-11-17T14:15:00Z", exit_time: "2026-11-17T14:20:00Z", entry_price: 6000, exit_price: 6040 }); // +$200
  const t3 = makeTrade({ id: "t3", entry_time: "2026-11-17T14:25:00Z", exit_time: "2026-11-17T14:30:00Z", entry_price: 6000, exit_price: 5980 }); // -$100
  const t4 = makeTrade({ id: "t4", entry_time: "2026-11-17T14:35:00Z", exit_time: "2026-11-17T14:40:00Z", entry_price: 6000, exit_price: 5970 }); // -$150

  const res1 = evaluateChallenge(def, [t1, t2, t3, t4], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(res1.equity_cents, 15000);
  assert.equal(res1.peak_cents, 40000);
  assert.equal(res1.drawdown_cents, 25000);
  assert.equal(res1.max_drawdown_cents, 25000);
  assert.equal(res1.remaining_cents, 5000);
  assert.equal(res1.state, "active");

  // Golden Case 2: case 1, then -50 -> equity +100, peak 400, drawdown 300, max DD 300 -> Failed at -50 trade
  const t5 = makeTrade({ id: "t5", entry_time: "2026-11-17T14:45:00Z", exit_time: "2026-11-17T14:50:00Z", entry_price: 6000, exit_price: 5990 }); // -$50
  const res2 = evaluateChallenge(def, [t1, t2, t3, t4, t5], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(res2.equity_cents, 10000);
  assert.equal(res2.peak_cents, 40000);
  assert.equal(res2.drawdown_cents, 30000);
  assert.equal(res2.max_drawdown_cents, 30000);
  assert.equal(res2.remaining_cents, 0);
  assert.equal(res2.state, "failed");
  assert.equal(res2.decided_by, "t5");

  // Golden Case 3: -100, -100, -98.75 -> equity -298.75, peak 0, drawdown 298.75, max DD 298.75, Active, $1.25 left
  // -98.75 = 19.75 pts * $5
  const t3_1 = makeTrade({ id: "t3_1", entry_time: "2026-11-17T14:05:00Z", exit_time: "2026-11-17T14:10:00Z", entry_price: 6000, exit_price: 5980 }); // -$100
  const t3_2 = makeTrade({ id: "t3_2", entry_time: "2026-11-17T14:15:00Z", exit_time: "2026-11-17T14:20:00Z", entry_price: 6000, exit_price: 5980 }); // -$100
  const t3_3 = makeTrade({ id: "t3_3", entry_time: "2026-11-17T14:25:00Z", exit_time: "2026-11-17T14:30:00Z", entry_price: 6000, exit_price: 5980.25 }); // -19.75 pts = -$98.75
  const res3 = evaluateChallenge(def, [t3_1, t3_2, t3_3], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(res3.equity_cents, -29875);
  assert.equal(res3.peak_cents, 0);
  assert.equal(res3.drawdown_cents, 29875);
  assert.equal(res3.max_drawdown_cents, 29875);
  assert.equal(res3.remaining_cents, 125);
  assert.equal(res3.state, "active");

  // Golden Case 4: -300 -> Failed at first trade
  const t4_1 = makeTrade({ id: "t4_1", entry_time: "2026-11-17T14:05:00Z", exit_time: "2026-11-17T14:10:00Z", entry_price: 6000, exit_price: 5940 }); // -60 pts = -$300
  const res4 = evaluateChallenge(def, [t4_1], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(res4.equity_cents, -30000);
  assert.equal(res4.peak_cents, 0);
  assert.equal(res4.drawdown_cents, 30000);
  assert.equal(res4.max_drawdown_cents, 30000);
  assert.equal(res4.remaining_cents, 0);
  assert.equal(res4.state, "failed");
  assert.equal(res4.decided_by, "t4_1");

  // Golden Case 5: +500, -298.75, +400, -298.75 -> peak 601.25, second loss measured from 601.25
  const t5_1 = makeTrade({ id: "t5_1", entry_time: "2026-11-17T14:05:00Z", exit_time: "2026-11-17T14:10:00Z", entry_price: 6000, exit_price: 6100 }); // +$500
  const t5_2 = makeTrade({ id: "t5_2", entry_time: "2026-11-17T14:15:00Z", exit_time: "2026-11-17T14:20:00Z", entry_price: 6000, exit_price: 5940.25 }); // -$298.75
  const t5_3 = makeTrade({ id: "t5_3", entry_time: "2026-11-17T14:25:00Z", exit_time: "2026-11-17T14:30:00Z", entry_price: 6000, exit_price: 6080 }); // +$400
  const t5_4 = makeTrade({ id: "t5_4", entry_time: "2026-11-17T14:35:00Z", exit_time: "2026-11-17T14:40:00Z", entry_price: 6000, exit_price: 5940.25 }); // -$298.75
  const res5 = evaluateChallenge(def, [t5_1, t5_2, t5_3, t5_4], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(res5.equity_cents, 30250);
  assert.equal(res5.peak_cents, 60125);
  assert.equal(res5.drawdown_cents, 29875);
  assert.equal(res5.max_drawdown_cents, 29875);
  assert.equal(res5.remaining_cents, 125);
  assert.equal(res5.state, "active");

  // Golden Case 6: case 2, then +1000 -> Still Failed at t5
  const t6_more = makeTrade({ id: "t6", entry_time: "2026-11-17T14:55:00Z", exit_time: "2026-11-17T15:00:00Z", entry_price: 6000, exit_price: 6200 }); // +$1000
  const res6 = evaluateChallenge(def, [t1, t2, t3, t4, t5, t6_more], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(res6.state, "failed");
  assert.equal(res6.decided_by, "t5");
  assert.equal(res6.max_drawdown_cents, 30000);
  assert.equal(res6.equity_cents, 10000);
  assert.equal(res6.remaining_cents, 0);
  assert.deepEqual(res6.points, res2.points);

  const laterLoss = { ...t6_more, exit_price: 5800 };
  const resLaterLoss = evaluateChallenge(def, [t1, t2, t3, t4, t5, laterLoss], Date.parse("2026-11-17T20:00:00Z"));
  assert.equal(resLaterLoss.max_drawdown_cents, 30000);
  assert.equal(resLaterLoss.decided_by, "t5");
});

test("Clean Run golden cases (docs/17 §4)", () => {
  const startedAt = "2026-11-17T14:00:00Z";
  const def: ChallengeDefinition = {
    id: "cr-test",
    user_id: "test-user",
    rules: {
      kind: "clean_run",
      target_trades: 5,
      playbook_ids: ["pb-a", "pb-b"],
    },
    started_at: startedAt,
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };

  const cleanTrade = (id: string, time: string, pb = "pb-a") =>
    makeTrade({
      id,
      entry_time: time,
      exit_time: time,
      playbook_id: pb,
      quick_tags: [],
      checklist_state: [{ id: "r1", label: "Rule", checked: true }],
    });

  const brokenTrade = (id: string, time: string) =>
    makeTrade({
      id,
      entry_time: time,
      exit_time: time,
      playbook_id: "pb-a",
      quick_tags: ["Revenge"],
      checklist_state: [{ id: "r1", label: "Rule", checked: true }],
    });

  const offPlanTrade = (id: string, time: string) =>
    makeTrade({
      id,
      entry_time: time,
      exit_time: time,
      playbook_id: "pb-other",
      quick_tags: [],
      checklist_state: [{ id: "r1", label: "Rule", checked: true }],
    });

  const ungradedTrade = (id: string, time: string) =>
    makeTrade({
      id,
      entry_time: time,
      exit_time: time,
      playbook_id: "pb-a",
      quick_tags: [],
      checklist_state: [], // empty checklist -> processRead returns null
    });

  // Case 1: C C C -> Run 3, Best 3, Active
  const res1 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      cleanTrade("t3", "2026-11-17T14:15:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res1.run, 3);
  assert.equal(res1.best_run, 3);
  assert.equal(res1.state, "active");

  // Case 2: C C B C -> Run 1, Best 2, Active
  const res2 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      brokenTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res2.run, 1);
  assert.equal(res2.best_run, 2);
  assert.equal(res2.state, "active");

  // Case 3: C C C C C -> Run 5, Best 5, Passed
  const res3 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      cleanTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
      cleanTrade("t5", "2026-11-17T14:25:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res3.run, 5);
  assert.equal(res3.best_run, 5);
  assert.equal(res3.state, "passed");
  assert.equal(res3.decided_by, "t5");

  // Case 4: C C U C C C -> Run 5, Best 5, Active, 1 needs grading (not passed)
  const res4 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      ungradedTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
      cleanTrade("t5", "2026-11-17T14:25:00Z"),
      cleanTrade("t6", "2026-11-17T14:30:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res4.run, 5);
  assert.equal(res4.best_run, 5);
  assert.equal(res4.state, "active");
  assert.equal(res4.provisional, true);
  assert.equal(res4.issues.length, 1);
  assert.equal(res4.issues[0].trade_id, "t3");
  assert.equal(res4.issues[0].reason, "ungraded");

  // Case 5: case 4 after U trade is graded clean -> 6 / 6 Passed
  const res5 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      cleanTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
      cleanTrade("t5", "2026-11-17T14:25:00Z"),
      cleanTrade("t6", "2026-11-17T14:30:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res5.run, 6);
  assert.equal(res5.best_run, 6);
  assert.equal(res5.state, "passed");
  assert.equal(res5.decided_by, "t5");

  // Case 6: case 4 after U trade is graded broken -> 3 / 3 Active
  const res6 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      brokenTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
      cleanTrade("t5", "2026-11-17T14:25:00Z"),
      cleanTrade("t6", "2026-11-17T14:30:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res6.run, 3);
  assert.equal(res6.best_run, 3);
  assert.equal(res6.state, "active");

  // Case 7: C C O C -> Run 1, Best 2, Active
  const res7 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      offPlanTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
    ],
    Date.now(),
  );
  assert.equal(res7.run, 1);
  assert.equal(res7.best_run, 2);
  assert.equal(res7.state, "active");

  // Case 8: C C C C + a no-setup trade -> Run 0, Best 4, Active
  const res8 = evaluateChallenge(
    def,
    [
      cleanTrade("t1", "2026-11-17T14:05:00Z"),
      cleanTrade("t2", "2026-11-17T14:10:00Z"),
      cleanTrade("t3", "2026-11-17T14:15:00Z"),
      cleanTrade("t4", "2026-11-17T14:20:00Z"),
      makeTrade({
        id: "t5",
        entry_time: "2026-11-17T14:25:00Z",
        exit_time: "2026-11-17T14:30:00Z",
        playbook_id: "no-setup",
      }),
    ],
    Date.now(),
  );
  assert.equal(res8.run, 0);
  assert.equal(res8.best_run, 4);
  assert.equal(res8.state, "active");
});

test("R-09a acceptance criteria edge cases (docs/17 §7)", () => {
  const startedAt = "2026-11-17T14:00:00Z";
  const def: ChallengeDefinition = {
    id: "dd-edge",
    user_id: "test-user",
    rules: {
      kind: "drawdown",
      sessions: 2,
      max_drawdown_cents: 20000,
    },
    started_at: startedAt,
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };

  // 1. Sample trade is ignored
  const sample = makeTrade({
    id: "s1",
    is_sample: true,
    entry_time: "2026-11-17T14:05:00Z",
    exit_time: "2026-11-17T14:10:00Z",
    entry_price: 6000,
    exit_price: 5900, // huge loss if counted
  });
  const resSample = evaluateChallenge(def, [sample], Date.now());
  assert.equal(resSample.points.length, 0);
  assert.equal(resSample.equity_cents, 0);

  // 2. Open trade makes it provisional
  const openTrade = makeTrade({
    id: "open1",
    status: "open",
    exit_time: null,
    exit_price: null,
    entry_time: "2026-11-17T14:05:00Z",
  });
  const resOpen = evaluateChallenge(def, [openTrade], Date.now());
  assert.equal(resOpen.provisional, true);
  assert.equal(resOpen.issues.some((i) => i.trade_id === "open1" && i.reason === "open"), true);

  // 3. Unpriceable trade blocks a pass and sets provisional
  const unpriceable = makeTrade({
    id: "unp1",
    entry_time: "2026-11-17T14:05:00Z",
    exit_time: "2026-11-17T14:10:00Z",
    entry_price: NaN,
  });
  const resUnp = evaluateChallenge(def, [unpriceable], Date.now());
  assert.equal(resUnp.provisional, true);
  assert.equal(resUnp.issues.some((i) => i.trade_id === "unp1" && i.reason === "unpriceable"), true);

  // 4. Trade entered before started_at is excluded and counted
  const preStart = makeTrade({
    id: "pre1",
    entry_time: "2026-11-17T13:59:59Z",
    exit_time: "2026-11-17T14:10:00Z",
  });
  const historical = { ...preStart, id: "historical", exit_time: "2026-11-17T13:59:59Z" };
  const resPre = evaluateChallenge(def, [preStart, historical], Date.now());
  assert.equal(resPre.excluded_before_start, 1);
  assert.equal(resPre.points.length, 0);

  // 5. Trade closing after 18:00 New York lands on the next session
  // 18:05 ET = 23:05 UTC (during standard time in November, ET = UTC-5)
  const eveningTrade = makeTrade({
    id: "eve1",
    entry_time: "2026-11-17T23:00:00Z",
    exit_time: "2026-11-17T23:05:00Z", // 18:05 New York on 2026-11-17 -> session 2026-11-18
  });
  const resEve = evaluateChallenge(def, [eveningTrade], Date.now());
  assert.equal(resEve.points[0].session, "2026-11-18");

  // 6. Two trades with the same exit time order by id
  const tA = makeTrade({
    id: "trade-b",
    entry_time: "2026-11-17T14:05:00Z",
    exit_time: "2026-11-17T14:15:00Z",
  });
  const tB = makeTrade({
    id: "trade-a",
    entry_time: "2026-11-17T14:05:00Z",
    exit_time: "2026-11-17T14:15:00Z",
  });
  const resTies = evaluateChallenge(def, [tA, tB], Date.now());
  assert.equal(resTies.points[0].trade_id, "trade-a");
  assert.equal(resTies.points[1].trade_id, "trade-b");

  // 7. Clean Run evaluator gives the same answer when every P&L is flipped
  const crDef: ChallengeDefinition = {
    id: "cr-pnl-flip",
    user_id: "test-user",
    rules: {
      kind: "clean_run",
      target_trades: 3,
      playbook_ids: ["pb-a"],
    },
    started_at: startedAt,
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };
  const winTrades = [
    makeTrade({ id: "w1", entry_time: "2026-11-17T14:05:00Z", exit_time: "2026-11-17T14:10:00Z", entry_price: 6000, exit_price: 6020, playbook_id: "pb-a" }),
    makeTrade({ id: "w2", entry_time: "2026-11-17T14:15:00Z", exit_time: "2026-11-17T14:20:00Z", entry_price: 6000, exit_price: 6020, playbook_id: "pb-a" }),
  ];
  const lossTrades = [
    makeTrade({ id: "w1", entry_time: "2026-11-17T14:05:00Z", exit_time: "2026-11-17T14:10:00Z", entry_price: 6000, exit_price: 5980, playbook_id: "pb-a" }),
    makeTrade({ id: "w2", entry_time: "2026-11-17T14:15:00Z", exit_time: "2026-11-17T14:20:00Z", entry_price: 6000, exit_price: 5980, playbook_id: "pb-a" }),
  ];
  const crWin = evaluateChallenge(crDef, winTrades, Date.now());
  const crLoss = evaluateChallenge(crDef, lossTrades, Date.now());
  assert.equal(crWin.run, crLoss.run);
  assert.equal(crWin.best_run, crLoss.best_run);
  assert.equal(crWin.state, crLoss.state);
});

test("Drawdown Defender passed conditions (active sessions and sessionCloseUtc)", () => {
  const startedAt = "2026-11-16T14:00:00Z";
  const def: ChallengeDefinition = {
    id: "dd-pass",
    user_id: "test-user",
    rules: {
      kind: "drawdown",
      sessions: 2,
      max_drawdown_cents: 20000,
    },
    started_at: startedAt,
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };

  // Trade 1 on session 2026-11-16 (14:30 UTC = 09:30 ET)
  const t1 = makeTrade({
    id: "t1",
    entry_time: "2026-11-16T14:30:00Z",
    exit_time: "2026-11-16T14:45:00Z",
    entry_price: 6000,
    exit_price: 6010,
  });
  // Trade 2 on session 2026-11-17 (14:30 UTC = 09:30 ET)
  const t2 = makeTrade({
    id: "t2",
    entry_time: "2026-11-17T14:30:00Z",
    exit_time: "2026-11-17T14:45:00Z",
    entry_price: 6000,
    exit_price: 6010,
  });

  // Session close for 2026-11-17 is 17:00 ET = 22:00 UTC
  const closeTimeUtc = Date.parse("2026-11-17T22:00:00Z");

  // Before session close: still active
  const resBefore = evaluateChallenge(def, [t1, t2], closeTimeUtc - 1000);
  assert.equal(resBefore.sessions_done, 2);
  assert.equal(resBefore.state, "active");

  assert.equal(evaluateChallenge(def, [t1, t2], closeTimeUtc).state, "active");

  // After session close: passed
  const resAfter = evaluateChallenge(def, [t1, t2], closeTimeUtc + 1000);
  assert.equal(resAfter.sessions_done, 2);
  assert.equal(resAfter.state, "passed");
  assert.equal(resAfter.decided_by, "t2");
});

test("Drawdown Defender keeps a breach provisional while any closed trade needs pricing", () => {
  const now = Date.parse("2026-11-17T22:00:01Z");
  const def: ChallengeDefinition = {
    id: "estimate",
    user_id: "test-user",
    rules: { kind: "drawdown", sessions: 1, max_drawdown_cents: 30000 },
    started_at: "2026-11-17T14:00:00Z",
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };
  const breach = makeTrade({ id: "breach", exit_price: 5940 });
  const missing = makeTrade({ id: "missing", exit_time: "2026-11-17T15:00:00Z", exit_price: null });
  const estimate = evaluateChallenge(def, [missing, breach], now);
  assert.equal(estimate.state, "active");
  assert.equal(estimate.provisional, true);
  assert.equal(estimate.decided_by, null);
  assert.equal(estimate.drawdown_cents, 30000);
  assert.deepEqual(estimate.issues, [{ trade_id: "missing", reason: "unpriceable" }]);

  const corrected = { ...missing, exit_price: 6000 };
  assert.equal(evaluateChallenge(def, [breach, corrected], now).state, "failed");
  const winner = { ...breach, exit_price: 6010 };
  assert.equal(evaluateChallenge(def, [winner, missing], now).state, "active");
  assert.equal(evaluateChallenge(def, [winner, corrected], now).state, "passed");
});

test("Clean Run credits the qualifying trade in the current run after a reset", () => {
  const def: ChallengeDefinition = {
    id: "reset",
    user_id: "test-user",
    rules: { kind: "clean_run", target_trades: 3, playbook_ids: ["pb-trend"] },
    started_at: "2026-11-17T14:00:00Z",
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };
  const trades = Array.from({ length: 8 }, (_, index) => makeTrade({
    id: `t${index + 1}`,
    exit_time: `2026-11-17T14:4${index}:00Z`,
    playbook_id: index === 3 ? "no-setup" : "pb-trend",
    exit_price: index === 6 ? null : 6010,
  }));
  const result = evaluateChallenge(def, trades, Date.parse("2026-11-17T22:00:01Z"));
  assert.equal(result.state, "passed");
  assert.equal(result.run, 4);
  assert.equal(result.decided_by, "t7");
});

test("Drawdown Defender waits for the Monday close after the DST change", () => {
  const def: ChallengeDefinition = {
    id: "dst",
    user_id: "test-user",
    rules: { kind: "drawdown", sessions: 2, max_drawdown_cents: 30000 },
    started_at: "2026-10-30T13:00:00Z",
    ended_at: null,
    calc_version: CHALLENGE_CALC_VERSION,
  };
  const friday = makeTrade({ id: "fri", entry_time: "2026-10-30T13:30:00Z", exit_time: "2026-10-30T14:00:00Z" });
  const sunday = makeTrade({ id: "sun", entry_time: "2026-11-01T23:00:00Z", exit_time: "2026-11-01T23:05:00Z" });
  const close = Date.parse("2026-11-02T22:00:00Z");
  const atClose = evaluateChallenge(def, [sunday, friday], close);
  assert.deepEqual(atClose.points.map((point) => point.session), ["2026-10-30", "2026-11-02"]);
  assert.equal(atClose.state, "active");
  assert.equal(evaluateChallenge(def, [sunday, friday], close + 1).state, "passed");
});
