// Planning sessions integration tests for Today screen and PlanSheet/PlanCard (PS-2, docs/24 §2).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPlannedLevel,
  PLAN_PRESETS,
  type PlanningSession,
} from "../plans.ts";
import {
  addPlan,
  getPlan,
  getPlansForSession,
  resetPlansForTests,
  updatePlan,
} from "../plans-store.ts";

test("PS-2: create session plan with levels, bias, and watch setups", () => {
  resetPlansForTests();

  const lvl1 = createPlannedLevel({
    price: 6050.25,
    symbol: "MES",
    label: "PDH",
    kind: "level",
  });
  assert.ok(lvl1);
  assert.equal(lvl1.price, 6050.25);
  assert.equal(lvl1.price_ticks, 24201);
  assert.equal(lvl1.label, "PDH");

  const lvl2 = createPlannedLevel({
    price: 6000.0,
    symbol: "MES",
    label: "Demand Low",
    kind: "zone_low",
  });
  assert.ok(lvl2);
  assert.equal(lvl2.kind, "zone_low");

  const plan: PlanningSession = {
    id: "plan-test-1",
    user_id: "default-owner",
    session_date: "2026-11-22",
    name: "Pre-market (New York)",
    preset: "pre_market",
    anchor_time_utc: "2026-11-22T13:30:00Z",
    created_at: "2026-11-22T13:00:00Z",
    updated_at: "2026-11-22T13:00:00Z",
    observations: "Watch 6050 for breakout or rejection",
    bias: "bullish",
    watch_playbook_ids: ["pb-momentum", "pb-orb"],
    levels: [lvl1, lvl2],
    revisions: [],
  };

  addPlan(plan);

  const sessionPlans = getPlansForSession("2026-11-22");
  assert.equal(sessionPlans.length, 1);
  assert.equal(sessionPlans[0].id, "plan-test-1");
  assert.equal(sessionPlans[0].name, "Pre-market (New York)");
  assert.equal(sessionPlans[0].bias, "bullish");
  assert.equal(sessionPlans[0].levels.length, 2);
  assert.equal(sessionPlans[0].watch_playbook_ids.length, 2);
});

test("PS-2: update plan records revisions and handles after-the-fact edits", () => {
  resetPlansForTests();

  const plan: PlanningSession = {
    id: "plan-test-2",
    user_id: "default-owner",
    session_date: "2026-11-22",
    name: "Pre-power hour",
    preset: "pre_power_hour",
    anchor_time_utc: "2026-11-22T19:00:00Z",
    created_at: "2026-11-22T18:45:00Z",
    updated_at: "2026-11-22T18:45:00Z",
    observations: "Initial afternoon thoughts",
    bias: "neutral",
    watch_playbook_ids: [],
    levels: [],
    revisions: [],
  };

  addPlan(plan);

  updatePlan("plan-test-2", {
    observations: "Updated thesis as market pushes higher",
    bias: "bullish",
  });

  const updated = getPlan("plan-test-2");
  assert.ok(updated);
  assert.equal(updated.bias, "bullish");
  assert.equal(updated.observations, "Updated thesis as market pushes higher");
  assert.equal(updated.revisions.length, 1);
  assert.equal(updated.revisions[0].observations, "Initial afternoon thoughts");
  assert.equal(updated.revisions[0].bias, "neutral");
});

test("PS-2: presets define fast-entry checkpoints", () => {
  assert.ok(PLAN_PRESETS.length >= 5);
  const globex = PLAN_PRESETS.find((p) => p.preset === "pre_globex");
  assert.ok(globex);
  assert.equal(globex.beforeCt, "17:00");

  const preMarket = PLAN_PRESETS.find((p) => p.preset === "pre_market");
  assert.ok(preMarket);
  assert.equal(preMarket.beforeCt, "08:30");
});
