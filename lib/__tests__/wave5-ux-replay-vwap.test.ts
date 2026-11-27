// Wave 5 convergence tests covering Lanes 1-8:
// - Lane 1: zero floating TP/SL/MAE/MFE labels or bracket marks across low/medium/high detail
// - Lane 2: volume-weighted Welford Session VWAP ±1σ/±2σ bands math & preference sanitization
// - Lane 3: Replay/Pretend AccountMode isolation from runningStats & challenges + pretend_session workflow
// - Lane 5: Review queue & pending counts exclude demo/sample trades; shouldShowSamples hides demos once real trades exist
import test from "node:test";
import assert from "node:assert/strict";
import { makeAccount, accountMode, isReplayAccount } from "../accounts.ts";
import { filterByAccountScope, isReplayTrade, runningStats } from "../selectors.ts";
import { evaluateChallenge } from "../challenges.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import { computeSessionIndicators } from "../session-indicators.ts";
import { vwapBandsOnBars } from "../chart-indicators.ts";
import { DEFAULT_PREFS, sanitizePrefs } from "../prefs-sanitize.ts";
import { shouldShowSamples } from "../prefs.ts";
import { pendingReviewCount, pendingReviewTrades } from "../day-counts.ts";
import { AGENT_WORKFLOWS } from "../agent/house-rules.ts";
import { deriveTrade, fromLegacy } from "../trade-document.ts";
import { buildMarks } from "../trade-marks.ts";
import { normalizeTrade } from "../trades.ts";
import type { Candle } from "../trades.ts";

test("W5-01: buildMarks never emits TP/SL zone labels or MAE/MFE bracket marks", () => {
  const trade = normalizeTrade({
    id: "w5-clean",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-23T14:30:00Z",
    exit_time: "2026-11-23T14:40:00Z",
    entry_price: 7100,
    exit_price: 7110,
    stop_loss_price: 7090,
    initial_stop_price: 7090,
    planned_target_price: 7110,
    exit_reason: "target",
  });
  const derived = deriveTrade(fromLegacy(trade));
  const candleTimes = [Date.parse("2026-11-23T14:30:00Z"), Date.parse("2026-11-23T14:40:00Z")];
  for (const detail of ["low", "medium", "high"] as const) {
    const marks = buildMarks(derived, null, "1m", detail, false, { candleTimes });
    assert.equal(marks.some((m) => m.kind === "bracket"), false, `${detail}: no MAE/MFE bracket`);
    assert.equal(
      marks.some((m) => m.kind === "zone" && typeof m.label === "string" && m.label.length > 0),
      false,
      `${detail}: no TP/SL plan zone label`,
    );
  }
});

test("W5-02: Session VWAP computes numerically stable volume-weighted ±1σ and ±2σ bands", () => {
  // 2026-11-23 RTH opens at 14:30 UTC (09:30 EST).
  const t0 = Date.parse("2026-11-23T14:30:00Z");
  const bars: Candle[] = [
    { time: t0, open: 7000, high: 7000, low: 7000, close: 7000, volume: 100 }, // hlc3 = 7000
    { time: t0 + 60_000, open: 7010, high: 7010, low: 7010, close: 7010, volume: 100 }, // hlc3 = 7010 -> vwap 7005, stdev 5
  ];
  const result = computeSessionIndicators(bars, {
    symbol: "MES",
    timeframe: "1m",
    asOf: t0 + 2 * 60_000,
    anchor: "rth",
    gapPolicy: "complete",
  });
  assert.ok(result);
  assert.equal(result.vwapBands.length, 2);
  const second = result.vwapBands[1];
  assert.ok(Math.abs(second.value - 7005) < 1e-9);
  assert.ok(Math.abs(second.upper1 - 7010) < 1e-9);
  assert.ok(Math.abs(second.lower1 - 7000) < 1e-9);
  assert.ok(Math.abs(second.upper2 - 7015) < 1e-9);
  assert.ok(Math.abs(second.lower2 - 6995) < 1e-9);

  const aligned = vwapBandsOnBars(result.vwapBands, bars, "1m");
  assert.equal(aligned.length, 2);
  assert.equal(DEFAULT_PREFS.vwapBands, "1sd");
  assert.equal(sanitizePrefs({ vwapBands: "2sd" }).vwapBands, "2sd");
  assert.equal(sanitizePrefs({ vwapBands: "bogus" }).vwapBands, "1sd");
});

test("W5-03: Replay account trades stay isolated from live runningStats and all-account challenges", () => {
  const liveAcct = makeAccount({ id: "acct-eval", name: "Eval 50K", starting_balance_cents: 5_000_000, now: "2026-11-20T00:00:00Z", mode: "eval", r_size_cents: 30_000 });
  const replayAcct = makeAccount({ id: "acct-replay", name: "Pretend Replay", starting_balance_cents: 0, now: "2026-11-20T00:00:00Z", mode: "replay", r_size_cents: 30_000 });
  assert.equal(accountMode(liveAcct), "eval");
  assert.equal(isReplayAccount(liveAcct), false);
  assert.equal(isReplayAccount(replayAcct), true);

  const realTrade = normalizeTrade({
    id: "t-real", symbol: "MES", direction: "LONG", quantity: 1,
    entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T14:40:00Z",
    entry_price: 7100, exit_price: 7112, stop_loss_price: 7090, account_id: liveAcct.id,
  });
  const replayTrade = normalizeTrade({
    id: "t-replay", symbol: "MES", direction: "LONG", quantity: 2,
    entry_time: "2026-11-23T15:00:00Z", exit_time: "2026-11-23T15:10:00Z",
    entry_price: 7100, exit_price: 7050, stop_loss_price: 7050, account_id: replayAcct.id,
  });
  const accounts = [liveAcct, replayAcct];
  assert.equal(isReplayTrade(replayTrade, accounts), true);
  assert.deepEqual(filterByAccountScope([realTrade, replayTrade], accounts, "real").map((t) => t.id), ["t-real"]);
  assert.deepEqual(filterByAccountScope([realTrade, replayTrade], accounts, "replay").map((t) => t.id), ["t-replay"]);
  assert.equal(filterByAccountScope([realTrade, replayTrade], accounts, "all").length, 2);

  const stats = runningStats([realTrade, replayTrade], Date.parse("2026-11-24T00:00:00Z"), { accounts });
  assert.equal(stats.overall.tradeCount, 1);
  assert.equal(stats.overall.grossPnl, 60);

  const challenge: ChallengeDefinition = {
    id: "ch-1", user_id: "u", account_id: null, calc_version: 1,
    started_at: "2026-11-20T00:00:00Z", ended_at: null,
    rules: { kind: "drawdown", max_drawdown_cents: 40_000, sessions: 5 },
  };
  const evalAll = evaluateChallenge(challenge, [realTrade, replayTrade], Date.parse("2026-11-24T00:00:00Z"), { accounts });
  assert.equal(evalAll.state, "active", "replay loss (-$500) must not breach live all-accounts Drawdown Defender");
  assert.ok(AGENT_WORKFLOWS.some((w) => w.id === "pretend_session"));
});

test("W5-05: Review queue counts exclude demo samples and shouldShowSamples hides demos once real trades exist", () => {
  const sample = normalizeTrade({
    id: "demo-1", symbol: "MES", direction: "LONG", quantity: 1, is_sample: true,
    entry_time: "2026-11-20T14:30:00Z", exit_time: "2026-11-20T14:40:00Z",
    entry_price: 7100, exit_price: 7105, stop_loss_price: 7095, review_status: "new",
  });
  const realTagged = normalizeTrade({
    id: "real-1", symbol: "MES", direction: "LONG", quantity: 1, is_sample: false,
    entry_time: "2026-11-23T14:30:00Z", exit_time: "2026-11-23T14:40:00Z",
    entry_price: 7100, exit_price: 7105, stop_loss_price: 7095, review_status: "tagged",
  });
  assert.deepEqual(pendingReviewTrades([sample, realTagged]).map((t) => t.id), ["real-1"]);
  assert.equal(pendingReviewCount([sample]), 0);
  assert.equal(shouldShowSamples(true, true), false);
  assert.equal(shouldShowSamples(true, false), true);
  assert.equal(shouldShowSamples(true, true, true), true);
});
