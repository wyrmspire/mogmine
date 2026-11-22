// Unit tests for Discretionary Review Prompts Engine (DP-1, docs/playbook-design/04).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscretionCall, PromptDismissal } from "../calls.ts";
import {
  detectDeviations,
  pendingAsks,
  seedPromptLibrary,
  PROMPT_LIBRARY_SCHEMA,
  SEED_PROMPTS_VERSION,
} from "../discretionary-prompts.ts";
import type { ReviewPrompt } from "../discretionary-prompts.ts";
import type { TradeRecord } from "../trades.ts";

function createTrade(patch: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: "trade-001",
    user_id: "demo-owner",
    account_id: "acct-001",
    symbol: "MES",
    yahoo_ticker: "MES=F",
    direction: "LONG",
    trade_style: "scalp",
    status: "closed",
    entry_time: "2026-11-20T14:30:00.000Z",
    exit_time: "2026-11-20T14:45:00.000Z",
    entry_price: 6000.0,
    exit_price: 6010.0,
    stop_loss_price: 5990.0,
    initial_stop_price: 5990.0,
    initial_stop_set_at: "2026-11-20T14:30:00.000Z",
    planned_target_price: 6020.0,
    key_level_price: null,
    quantity: 1,
    note: "",
    review_status: "new",
    playbook_id: "pb-orb",
    quick_tags: [],
    checklist_state: [],
    pre_trade_thesis: "",
    management_notes: "",
    post_exit_notes: "",
    flagged: false,
    take_again: null,
    take_again_at: null,
    is_sample: false,
    sparkline: [],
    ...patch,
  };
}

function createCall(patch: Partial<DiscretionCall> = {}): DiscretionCall {
  return {
    id: "call-001",
    user_id: "demo-owner",
    kind: "cut",
    made_at: "2026-11-20T14:45:00.000Z",
    recorded_at: "2026-11-20T14:46:00.000Z",
    trade_id: "trade-001",
    plan_session_id: null,
    playbook_id: null,
    price: 5995,
    price_ticks: null,
    signal_direction: null,
    reasons: [],
    note: "",
    conviction: 2,
    prompt_id: "seed:cut",
    prompt_question: "Why out before stop or target?",
    origin: "close_sheet",
    trigger: null,
    rule: null,
    made_at_basis: "exact",
    ...patch,
  };
}

describe("seedPromptLibrary", () => {
  it("populates library with stable schema, version and user_id (Invariant 7)", () => {
    const userId = "trader-42";
    const lib = seedPromptLibrary(userId);

    assert.equal(lib.schema, PROMPT_LIBRARY_SCHEMA);
    assert.equal(lib.seeds_version, SEED_PROMPTS_VERSION);
    assert.equal(lib.user_id, userId);

    // All prompts have user_id set
    for (const prompt of lib.prompts) {
      assert.equal(prompt.user_id, userId);
      assert.ok(prompt.id.startsWith("seed:"), `Prompt id should start with seed: ${prompt.id}`);
      assert.ok(prompt.seed_id?.startsWith("seed:"), `Seed id should start with seed: ${prompt.seed_id}`);
      assert.equal(prompt.retired, false);
      assert.equal(prompt.primary, true);
      assert.equal(prompt.answer_shape, "call");
    }

    // Shared reasons have stable ids
    assert.equal(lib.shared_reasons.length, 4);
    for (const chip of lib.shared_reasons) {
      assert.ok(chip.id.startsWith("seed:shared:"), `Shared chip id: ${chip.id}`);
    }
  });

  it("seeds prompts for all 7 CallKinds with appropriate triggers", () => {
    const lib = seedPromptLibrary("owner");
    assert.equal(lib.prompts.length, 7);

    const kinds = lib.prompts.map((p) => p.kind);
    assert.deepEqual(kinds, ["skip", "flip", "cut", "early_take", "stop_here", "hold", "size"]);

    const cutPrompt = lib.prompts.find((p) => p.kind === "cut")!;
    assert.equal(cutPrompt.trigger.on, "deviation");
    if (cutPrompt.trigger.on === "deviation") {
      assert.deepEqual(cutPrompt.trigger.deviations, ["exit_before_target_loss"]);
    }

    const earlyTakePrompt = lib.prompts.find((p) => p.kind === "early_take")!;
    assert.equal(earlyTakePrompt.trigger.on, "deviation");
    if (earlyTakePrompt.trigger.on === "deviation") {
      assert.deepEqual(earlyTakePrompt.trigger.deviations, ["exit_before_target_profit"]);
    }

    const stopHerePrompt = lib.prompts.find((p) => p.kind === "stop_here")!;
    assert.equal(stopHerePrompt.trigger.on, "always");
    if (stopHerePrompt.trigger.on === "always") {
      assert.equal(stopHerePrompt.trigger.when, "stop_set");
    }

    const holdPrompt = lib.prompts.find((p) => p.kind === "hold")!;
    assert.equal(holdPrompt.trigger.on, "deviation");
    if (holdPrompt.trigger.on === "deviation") {
      assert.deepEqual(holdPrompt.trigger.deviations, ["exit_beyond_target"]);
    }
  });
});

describe("detectDeviations", () => {
  it("detects exit_before_target_loss (cut) on long trade exited at a loss before stop", () => {
    // Long MES 6000, target 6020, stop 5990. Exit at 5995 (loss of 20 ticks, well above stop).
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      initial_stop_price: 5990.0,
      exit_price: 5995.0,
    });

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("exit_before_target_loss"));
    assert.ok(!devs.includes("exit_before_target_profit"));
    assert.ok(devs.includes("stop_set"));
  });

  it("detects exit_before_target_loss (cut) on short trade exited at a loss before stop", () => {
    // Short MES 6000, target 5980, stop 6010. Exit at 6005 (loss of 20 ticks for short, well below stop).
    const trade = createTrade({
      direction: "SHORT",
      entry_price: 6000.0,
      planned_target_price: 5980.0,
      stop_loss_price: 6010.0,
      initial_stop_price: 6010.0,
      exit_price: 6005.0,
    });

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("exit_before_target_loss"));
    assert.ok(!devs.includes("exit_before_target_profit"));
  });

  it("counts a scratch (0 ticks PnL) as exit_before_target_loss (cut per OD-DP-07)", () => {
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      initial_stop_price: 5990.0,
      exit_price: 6000.0, // 0 ticks PnL
    });

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("exit_before_target_loss"));
    assert.ok(!devs.includes("exit_before_target_profit"));
  });

  it("detects exit_before_target_profit (early take) on long trade", () => {
    // Long MES 6000, target 6020, stop 5990. Exit at 6010 (+40 ticks profit, before target).
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      initial_stop_price: 5990.0,
      exit_price: 6010.0,
    });

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("exit_before_target_profit"));
    assert.ok(!devs.includes("exit_before_target_loss"));
  });

  it("detects exit_before_target_profit (early take) on short trade", () => {
    // Short MES 6000, target 5980, stop 6010. Exit at 5990 (+40 ticks profit, before target).
    const trade = createTrade({
      direction: "SHORT",
      entry_price: 6000.0,
      planned_target_price: 5980.0,
      stop_loss_price: 6010.0,
      initial_stop_price: 6010.0,
      exit_price: 5990.0,
    });

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("exit_before_target_profit"));
    assert.ok(!devs.includes("exit_before_target_loss"));
  });

  it("detects exit_beyond_target (hold) for long and short", () => {
    // Long exited beyond target 6020 at 6025
    const longTrade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      exit_price: 6025.0,
    });
    assert.ok(detectDeviations(longTrade).includes("exit_beyond_target"));

    // Short exited beyond target 5980 at 5975
    const shortTrade = createTrade({
      direction: "SHORT",
      entry_price: 6000.0,
      planned_target_price: 5980.0,
      exit_price: 5975.0,
    });
    assert.ok(detectDeviations(shortTrade).includes("exit_beyond_target"));
  });

  it("respects tolerance edges (1 tick slippage)", () => {
    // MES tickSize = 0.25. Target = 6020.00
    // Exit at 6019.75 (1 tick before target) -> within tolerance, NOT early exit
    const atTargetTolerance = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 6019.75,
    });
    assert.ok(!detectDeviations(atTargetTolerance).includes("exit_before_target_profit"));

    // Exit at 6019.50 (2 ticks before target) -> strictly inside, early take
    const strictlyInsideTarget = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 6019.50,
    });
    assert.ok(detectDeviations(strictlyInsideTarget).includes("exit_before_target_profit"));

    // Exit at 5990.00 (exactly at stop) -> stopped out, NOT cut
    const atStop = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 5990.0,
    });
    assert.ok(!detectDeviations(atStop).includes("exit_before_target_loss"));

    // Exit at 5989.75 (past stop in slippage) -> stopped out, NOT cut
    const pastStop = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 5989.75,
    });
    assert.ok(!detectDeviations(pastStop).includes("exit_before_target_loss"));
  });

  it("does not fire early exit when only stop is known and trade is in profit", () => {
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: null,
      stop_loss_price: 5990.0,
      exit_price: 6010.0, // in profit
    });

    const devs = detectDeviations(trade);
    assert.ok(!devs.includes("exit_before_target_profit"));
    assert.ok(!devs.includes("exit_before_target_loss"));
    assert.ok(devs.includes("stop_set"));
  });

  it("fires cut when only stop is known and trade is cut at a loss above stop", () => {
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: null,
      stop_loss_price: 5990.0,
      exit_price: 5995.0, // in loss, above stop
    });

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("exit_before_target_loss"));
  });

  it("does not fire early exit or hold when neither target nor stop is known", () => {
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: null,
      stop_loss_price: null,
      initial_stop_price: null,
      exit_price: 6010.0,
    });

    const devs = detectDeviations(trade);
    assert.ok(!devs.includes("exit_before_target_profit"));
    assert.ok(!devs.includes("exit_before_target_loss"));
    assert.ok(!devs.includes("exit_beyond_target"));
    assert.ok(devs.includes("no_stop"));
  });

  it("suppresses early exit when stated exit_reason is target, stop, or trail", () => {
    const tradeTarget = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 6015.0,
      exit_reason: "target",
    });
    assert.ok(!detectDeviations(tradeTarget).includes("exit_before_target_profit"));

    const tradeStop = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 5995.0,
      exit_reason: "stop",
    });
    assert.ok(!detectDeviations(tradeStop).includes("exit_before_target_loss"));

    const tradeTrail = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 6015.0,
      exit_reason: "trail",
    });
    assert.ok(!detectDeviations(tradeTrail).includes("exit_before_target_profit"));
  });

  it("detects stop_widened when initial stop is moved further away", () => {
    // Long initial stop 5990, moved to 5980 (widened)
    const longWidened = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      initial_stop_price: 5990.0,
      stop_loss_price: 5980.0,
    });
    const devs = detectDeviations(longWidened);
    assert.ok(devs.includes("stop_widened"));
    assert.ok(!devs.includes("stop_tightened"));

    // Short initial stop 6010, moved to 6020 (widened)
    const shortWidened = createTrade({
      direction: "SHORT",
      entry_price: 6000.0,
      initial_stop_price: 6010.0,
      stop_loss_price: 6020.0,
    });
    assert.ok(detectDeviations(shortWidened).includes("stop_widened"));
  });

  it("detects stop_tightened when initial stop is moved closer to entry", () => {
    // Long initial stop 5990, moved to 5995 (tightened)
    const longTightened = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      initial_stop_price: 5990.0,
      stop_loss_price: 5995.0,
    });
    const devs = detectDeviations(longTightened);
    assert.ok(devs.includes("stop_tightened"));
    assert.ok(!devs.includes("stop_widened"));
  });

  it("does not fire stop_widened or stop_tightened when initial_stop_price is null (pre-R-10)", () => {
    const preR10Trade = createTrade({
      direction: "LONG",
      initial_stop_price: null,
      stop_loss_price: 5980.0,
    });
    const devs = detectDeviations(preR10Trade);
    assert.ok(!devs.includes("stop_widened"));
    assert.ok(!devs.includes("stop_tightened"));
    assert.ok(devs.includes("stop_set"));
  });

  it("evaluates stated stop_moves array correctly", () => {
    // Started at 5990, tightened to 5995, then widened to 5985
    const mixedMoves = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      initial_stop_price: 5990.0,
      stop_loss_price: 5985.0,
      stop_moves: [
        { price: 5995.0, time: "2026-11-20T14:35:00.000Z" },
        { price: 5985.0, time: "2026-11-20T14:40:00.000Z" },
      ],
    });

    const devs = detectDeviations(mixedMoves);
    assert.ok(devs.includes("stop_widened"));
    assert.ok(devs.includes("stop_tightened"));
  });

  it("detects size_off_normal and against_signal", () => {
    const trade = createTrade({
      quantity: 3,
      direction: "LONG",
    });
    (trade as unknown as Record<string, unknown>).normal_quantity_at_selection = 1;
    (trade as unknown as Record<string, unknown>).signal_direction = "short";

    const devs = detectDeviations(trade);
    assert.ok(devs.includes("size_off_normal"));
    assert.ok(devs.includes("against_signal"));
  });
});

describe("pendingAsks", () => {
  it("returns matching unanswered asks in priority order (deviation asks before always asks)", () => {
    const lib = seedPromptLibrary("demo-owner");
    // Long trade that took early profit: deviations include exit_before_target_profit and stop_set
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      initial_stop_price: 5990.0,
      exit_price: 6010.0,
    });

    const asks = pendingAsks(trade, lib);

    // Should include early_take (deviation) and stop_here (always when stop_set)
    assert.equal(asks.length, 2);
    assert.equal(asks[0].prompt.kind, "early_take");
    assert.equal(asks[0].deviation, "exit_before_target_profit");

    assert.equal(asks[1].prompt.kind, "stop_here");
    assert.equal(asks[1].deviation, "stop_set");
  });

  it("excludes already answered kinds and prompt IDs", () => {
    const lib = seedPromptLibrary("demo-owner");
    const trade = createTrade({
      id: "t123",
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 5995.0, // Cut
    });

    // Trade already has an answered cut call
    const answeredCall = createCall({
      trade_id: "t123",
      kind: "cut",
      prompt_id: "seed:cut",
    });

    const asks = pendingAsks(trade, lib, [answeredCall]);
    // Cut should be excluded; stop_here remains
    const kinds = asks.map((a) => a.prompt.kind);
    assert.ok(!kinds.includes("cut"));
    assert.ok(kinds.includes("stop_here"));
  });

  it("excludes permanently dismissed prompts (reason: not_a_call)", () => {
    const lib = seedPromptLibrary("demo-owner");
    const trade = createTrade({
      id: "t123",
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 6010.0,
    });

    const dismissal: PromptDismissal = {
      id: "d1",
      user_id: "demo-owner",
      trade_id: "t123",
      prompt_id: "seed:early_take",
      deviation: "exit_before_target_profit",
      reason: "not_a_call",
      recorded_at: "2026-11-20T15:00:00.000Z",
    };

    const asks = pendingAsks(trade, lib, { calls: [], dismissals: [dismissal] });
    const kinds = asks.map((a) => a.prompt.kind);
    assert.ok(!kinds.includes("early_take"));
    assert.ok(kinds.includes("stop_here"));
  });

  it("excludes retired prompts", () => {
    const lib = seedPromptLibrary("demo-owner");
    const cutPrompt = lib.prompts.find((p) => p.kind === "cut")!;
    cutPrompt.retired = true;

    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 5995.0,
    });

    const asks = pendingAsks(trade, lib);
    const kinds = asks.map((a) => a.prompt.kind);
    assert.ok(!kinds.includes("cut"));
  });

  it("respects maxAsks budget option", () => {
    const lib = seedPromptLibrary("demo-owner");
    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 6010.0,
    });

    const asks = pendingAsks(trade, lib, undefined, { maxAsks: 1 });
    assert.equal(asks.length, 1);
    assert.equal(asks[0].prompt.kind, "early_take");
  });

  it("enforces at most one ask per kind", () => {
    const lib = seedPromptLibrary("demo-owner");
    // Duplicate cut prompt with different wording
    const customCut: ReviewPrompt = {
      ...lib.prompts.find((p) => p.kind === "cut")!,
      id: "custom:cut:second",
      primary: false,
      question: "Second cut question",
    };
    lib.prompts.push(customCut);

    const trade = createTrade({
      direction: "LONG",
      entry_price: 6000.0,
      planned_target_price: 6020.0,
      stop_loss_price: 5990.0,
      exit_price: 5995.0,
    });

    const asks = pendingAsks(trade, lib);
    const cutAsks = asks.filter((a) => a.prompt.kind === "cut");
    assert.equal(cutAsks.length, 1);
    assert.equal(cutAsks[0].prompt.id, "seed:cut");
  });
});
