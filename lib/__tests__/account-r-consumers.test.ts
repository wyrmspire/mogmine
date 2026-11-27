// RS-3a: every library consumer reports account R (`resultR` = gross P&L ÷ R size, 04 §3.5, D-A),
// while stop-width ratios are `riskMultiple` and are never labelled "R". Fixtures use the 04 §1 worked
// examples at a $300 R size (r_size_cents: 30000). Trade A: +$615 = +2.05R. B: −$75 = −0.25R. C: −$40 = −0.13R.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDayCardData } from "../day-card.ts";
import { formatR } from "../format.ts";
import { resolveRSize, resultR } from "../r-size.ts";
import { describeTrade } from "../describe.ts";
import { calculateExitEfficiency } from "../exit-efficiency.ts";
import { derivePlanVsActual } from "../plan-vs-actual.ts";
import { DEFAULT_MOOD_REGISTRY, similarTrades } from "../mood.ts";
import type { MoodRecord } from "../mood.ts";
import { takeVsPass } from "../drills.ts";
import type { DrillRecord } from "../drills.ts";
import { dayStats, runningStats } from "../selectors.ts";
import { shareCardContent } from "../shareCard.ts";
import { isScratch, normalizeTrade, riskMultiple } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const NOW = "2026-11-26T18:00:00Z";
const DAY = "2026-11-16";
const near = (actual: number | null | undefined, expected: number, eps = 1e-9) => {
  assert.ok(actual != null && Math.abs(actual - expected) < eps, `expected ${expected}, got ${actual}`);
};

const trade = (id: string, patch: Partial<TradeRecord> = {}): TradeRecord =>
  normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: `${DAY}T15:00:00.000Z`,
    exit_time: `${DAY}T15:30:00.000Z`,
    entry_price: 6000,
    exit_price: 6005,
    stop_loss_price: 5995,
    initial_stop_price: 5995,
    status: "closed",
    is_sample: false,
    r_size_cents: 30000,
    ...patch,
  });

// 04 §1 worked examples, 1 MES ($5 a point). Stops give the stated risk: A 17.5 pt ($87.50), B 15 pt ($75), C 12 pt ($60).
const A = trade("A", { exit_price: 6123, stop_loss_price: 5982.5, initial_stop_price: 5982.5, planned_target_price: 6150 });
const B = trade("B", { exit_price: 5985, stop_loss_price: 5985, initial_stop_price: 5985 });
const C = trade("C", { exit_price: 5992, stop_loss_price: 5988, initial_stop_price: 5988 });
const SET = [A, B, C];
const C_R = -40 / 300; // −0.1333…, shown as −0.13R

test("riskMultiple is the stop-width ratio on sample fixtures, distinct from account R", () => {
  near(riskMultiple(A), 123 / 17.5);
  assert.equal(riskMultiple(B), -1);
  near(riskMultiple(C), -8 / 12);
  // Stop-width ratio, unchanged: the old "2.0R" fixture is now 2.0× risk, not account R.
  const twoX = trade("twox", { exit_price: 6010, stop_loss_price: 5995, initial_stop_price: 5995 });
  assert.equal(riskMultiple(twoX), 2);
  near(resultR(twoX, resolveRSize(twoX)), 50 / 300); // +$50 at $300 is +0.17R, not 2R
});

test("A/B/C at a $300 R size: +2.05R, −0.25R, −0.13R through resultR", () => {
  near(resultR(A, resolveRSize(A)), 2.05);
  near(resultR(B, resolveRSize(B)), -0.25);
  near(resultR(C, resolveRSize(C)), C_R, 1e-9);
});

test("A/B/C through dayStats and runningStats", () => {
  const stats = dayStats(SET);
  assert.equal(stats.withR, 3);
  near(stats.netR, 2.05 - 0.25 + C_R);
  const overall = runningStats(SET, NOW).overall;
  assert.equal(overall.withR, 3);
  near(overall.totalR, 2.05 - 0.25 + C_R);
  near(overall.avgR, (2.05 - 0.25 + C_R) / 3);
});

test("A/B/C through buildDayCardData", () => {
  const data = buildDayCardData(DAY, SET, false);
  near(data.trades.find((t) => t.id === "A")!.resultR, 2.05);
  near(data.trades.find((t) => t.id === "B")!.resultR, -0.25);
  near(data.trades.find((t) => t.id === "C")!.resultR, C_R);
  assert.equal(data.trades.find((t) => t.id === "A")!.formattedR, formatR(2.05));
  near(data.netR, 2.05 - 0.25 + C_R);
});

test("A/B/C through shareCardContent: hero R is account R (stop-width would read ×7.0)", () => {
  assert.equal(shareCardContent(A, "America/Chicago", false).heroResult, formatR(2.05));
  assert.equal(shareCardContent(B, "America/Chicago", false).heroResult, formatR(-0.25));
  assert.equal(shareCardContent(C, "America/Chicago", false).heroResult, formatR(C_R));
});

test("A/B/C through drills: take vs pass averages account R", () => {
  const answer = (trade_id: string, a: DrillRecord["answer"]): DrillRecord => ({
    id: `${trade_id}-a`, user_id: "u", trade_id, kind: "take_it", answer: a, answered_at: `${DAY}T20:00:00.000Z`, hidden: [],
  });
  const score = takeVsPass([answer("A", "take"), answer("B", "take"), answer("C", "pass")], SET);
  assert.equal(score.take.n, 2);
  near(score.take.avgR, (2.05 - 0.25) / 2);
  near(score.pass.avgR, C_R);
});

test("A/B/C through mood similarTrades: each match carries account R", () => {
  // Identical scores on three spokes (the minimum overlap), so every other trade is a close match.
  const scores = { calm: 0.5, fomo: 0.5, fear: 0.5 };
  const record = (trade_id: string): MoodRecord => ({
    id: `${trade_id}-m`, trade_id, spoke_set_version: 1, scores, evidence: {}, source: "user", model: null,
    captured_at: NOW, created_at: NOW,
  });
  const result = similarTrades(C, SET, SET.map((t) => record(t.id)), DEFAULT_MOOD_REGISTRY);
  const byId = new Map(result.matches.map((m) => [m.trade.id, m.r]));
  near(byId.get("A") ?? null, 2.05);
  near(byId.get("B") ?? null, -0.25);
});

test("A/B/C through describeTrade, calculateExitEfficiency and derivePlanVsActual", () => {
  assert.match(describeTrade(A, "America/Chicago"), /plus 2\.05 R\.$/);
  assert.match(describeTrade(B, "America/Chicago"), /minus 0\.25 R\.$/);

  // Efficiency ratio is unit-free (123 ÷ 130 = 95%); the R figures are account R.
  const eff = calculateExitEfficiency(A, 130)!;
  near(eff.realizedR, 2.05);
  assert.equal(eff.efficiencyPercent, 95);
  assert.equal(eff.summary, "captured +2.05R of +2.17R available (95%)"); // MFE 130 pt = $650 = +2.1667R

  const pva = derivePlanVsActual(A, { accounts: [], prefs: null });
  assert.equal(pva.rows.find((r) => r.label === "Result (R)")!.actual, "+2.05R");
});

test("a closed trade with no stop (+$75 at $300) reports +0.25R in dayStats, runningStats and shareCard", () => {
  const noStop = trade("nostop", {
    entry_price: 7000, exit_price: 7015, stop_loss_price: null, initial_stop_price: null, r_size_cents: 30000,
  });
  assert.equal(riskMultiple(noStop), null); // no stop, so no stop-width ratio
  near(resultR(noStop, resolveRSize(noStop)), 0.25);
  near(dayStats([noStop]).netR, 0.25);
  near(runningStats([noStop], NOW).overall.totalR, 0.25);
  assert.equal(shareCardContent(noStop, "America/Chicago", false).heroResult, formatR(0.25));
});

test("isScratch stays on the trade's own stop risk, not account R (D-C)", () => {
  // Stop 10 pts (40 ticks) away: the scratch band is max(0.1 × 40, 2) = 4 ticks. Exit +1.5 pts = 6 ticks.
  // On account R at $300 the band would be 0.1R = $30 = 24 ticks, and this trade would wrongly be a scratch.
  const t = trade("dc", { entry_price: 6000, exit_price: 6001.5, stop_loss_price: 5990, initial_stop_price: 5990, r_size_cents: 30000 });
  assert.equal(isScratch(t), false);
  // A move inside the band (+0.75 pt = 3 ticks ≤ 4) is a scratch on the trade's own risk.
  const small = trade("dc2", { entry_price: 6000, exit_price: 6000.75, stop_loss_price: 5990, initial_stop_price: 5990, r_size_cents: 30000 });
  assert.equal(isScratch(small), true);
});

test("resolveRSize: the trade snapshot wins, then the account's R size, then the default risk budget", () => {
  const accounts = [{ id: "acc-1", r_size_cents: 50000 }];
  const withAccount = trade("acct", { account_id: "acc-1", r_size_cents: null });
  assert.deepEqual(resolveRSize(withAccount, accounts, { riskBudgetUsd: 250 }), { cents: 50000, source: "account", account_id: "acc-1" });
  assert.deepEqual(resolveRSize({ ...withAccount, r_size_cents: 30000 }, accounts, { riskBudgetUsd: 250 }), { cents: 30000, source: "trade", account_id: "acc-1" });
  assert.deepEqual(resolveRSize({ ...withAccount, account_id: null }, accounts, { riskBudgetUsd: 400 }), { cents: 40000, source: "prefs", account_id: null });
  // Options passed to a consumer are honoured: an account R size applies when the trade has no snapshot.
  const noSnapshot = trade("nosnap", { account_id: "acc-1", r_size_cents: null, exit_price: 6123 });
  near(dayStats([noSnapshot], { accounts }).netR, 615 / 500);
  near(dayStats([noSnapshot]).netR, 615 / 300); // default $300 when no options are given
});
