import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_PRESETS,
  planPresetSpec,
  createPlannedLevel,
  isAfterTheFact,
  type PlanningSession,
} from "../plans.ts";
import {
  addPlan,
  getPlan,
  getPlansForSession,
  getPlansState,
  hydratePlans,
  removePlan,
  replacePlans,
  resetPlansForTests,
  sanitizePlanRevision,
  sanitizePlannedLevel,
  sanitizePlanningSession,
  sanitizePlans,
  updatePlan,
} from "../plans-store.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import { demoTrades } from "../fixtures.ts";

describe("plans model (PS-1)", () => {
  it("defines the five expected presets and lookup", () => {
    assert.equal(PLAN_PRESETS.length, 5);
    const preGlobex = planPresetSpec("pre_globex");
    assert.ok(preGlobex);
    assert.equal(preGlobex.beforeCt, "17:00");
    assert.equal(preGlobex.anchorHourCt, 17);
    assert.equal(preGlobex.anchorMinuteCt, 0);

    const preMarket = planPresetSpec("pre_market");
    assert.ok(preMarket);
    assert.equal(preMarket.beforeCt, "08:30");

    const preGap = planPresetSpec("pre_gap_fill");
    assert.ok(preGap);
    assert.equal(preGap.beforeCt, null);
    assert.equal(preGap.anchorHourCt, null);

    assert.equal(planPresetSpec("unknown"), null);
  });

  it("creates a valid planned level with tick snapping", () => {
    const level = createPlannedLevel({
      price: 5925.25,
      symbol: "MES",
      label: "Key Resistance",
      kind: "level",
      note: "Prior day high confluence",
    });
    assert.ok(level);
    assert.equal(level.price, 5925.25);
    assert.equal(level.price_ticks, 23701);
    assert.equal(level.label, "Key Resistance");
    assert.equal(level.kind, "level");
    assert.equal(level.note, "Prior day high confluence");

    // Invalid / off-tick price
    const offTick = createPlannedLevel({
      price: 5925.123,
      symbol: "MES",
      label: "Bad tick",
    });
    assert.equal(offTick, null);

    // Empty label
    const noLabel = createPlannedLevel({
      price: 5925.25,
      symbol: "MES",
      label: "   ",
    });
    assert.equal(noLabel, null);
  });

  it("determines after-the-fact flag against anchor time", () => {
    const anchor = "2026-11-20T14:30:00.000Z";
    const before = "2026-11-20T14:29:00.000Z";
    const after = "2026-11-20T14:35:00.000Z";

    assert.equal(isAfterTheFact(before, anchor), false);
    assert.equal(isAfterTheFact(after, anchor), true);
    assert.equal(isAfterTheFact(after, null), false);
    assert.equal(isAfterTheFact(after, undefined), false);
  });
});

describe("plans store & persistence (PS-1)", () => {
  beforeEach(() => {
    resetPlansForTests();
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("sanitizes planning sessions and enforces Invariant 7 (user_id)", () => {
    const raw = {
      id: "plan-1",
      session_date: "2026-11-20",
      name: "Pre-market markup",
      preset: "pre_market",
      anchor_time_utc: "2026-11-20T14:30:00.000Z",
      observations: "Watching 5920 pivot",
      bias: "bullish",
      watch_playbook_ids: ["pb-scalp-gap"],
      levels: [
        {
          id: "lvl-1",
          price_ticks: 23680,
          price: 5920.0,
          label: "Pivot Support",
          kind: "level",
        },
      ],
      revisions: [],
    };

    const session = sanitizePlanningSession(raw);
    assert.ok(session);
    assert.equal(session.id, "plan-1");
    assert.equal(session.user_id, DEFAULT_OWNER_USER_ID);
    assert.equal(session.session_date, "2026-11-20");
    assert.equal(session.preset, "pre_market");
    assert.equal(session.levels.length, 1);
    assert.equal(session.levels[0].label, "Pivot Support");

    assert.equal(sanitizePlanningSession(null), null);
    assert.equal(sanitizePlannedLevel(null), null);
    assert.equal(sanitizePlanRevision(null), null);
    assert.deepEqual(sanitizePlans(null), []);
  });

  it("records revisions on edit and flags after the fact", () => {
    const initialSession: PlanningSession = {
      id: "plan-2",
      user_id: DEFAULT_OWNER_USER_ID,
      session_date: "2026-11-20",
      name: "Pre-MOC",
      preset: "pre_moc",
      // Set anchor time in the past so any update is after-the-fact
      anchor_time_utc: "2020-01-01T20:50:00.000Z",
      created_at: "2020-01-01T20:00:00.000Z",
      updated_at: "2020-01-01T20:00:00.000Z",
      observations: "Watching closing imbalances",
      bias: "neutral",
      watch_playbook_ids: [],
      levels: [],
      revisions: [],
    };

    addPlan(initialSession);
    let plan = getPlan("plan-2");
    assert.ok(plan);
    assert.equal(plan.revisions.length, 0);

    // Update plan
    updatePlan("plan-2", {
      observations: "Imbalance $1.2B to sell",
      bias: "bearish",
    });

    plan = getPlan("plan-2");
    assert.ok(plan);
    assert.equal(plan.observations, "Imbalance $1.2B to sell");
    assert.equal(plan.bias, "bearish");
    assert.equal(plan.revisions.length, 1);
    assert.equal(plan.revisions[0].observations, "Imbalance $1.2B to sell");
    assert.equal(plan.revisions[0].bias, "bearish");
    assert.equal(plan.revisions[0].after_the_fact, true);
  });

  it("filters plans by session date", () => {
    const p1: PlanningSession = {
      id: "p1",
      user_id: DEFAULT_OWNER_USER_ID,
      session_date: "2026-11-20",
      name: "Plan A",
      preset: "pre_globex",
      anchor_time_utc: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      observations: "",
      watch_playbook_ids: [],
      levels: [],
      revisions: [],
    };
    const p2: PlanningSession = {
      ...p1,
      id: "p2",
      session_date: "2026-11-21",
      name: "Plan B",
    };
    addPlan(p1);
    addPlan(p2);

    const for20 = getPlansForSession("2026-11-20");
    assert.equal(for20.length, 1);
    assert.equal(for20[0].id, "p1");

    const for21 = getPlansForSession("2026-11-21");
    assert.equal(for21.length, 1);
    assert.equal(for21[0].id, "p2");

    removePlan("p1");
    assert.equal(getPlan("p1"), undefined);
    assert.equal(getPlansState().plans.length, 1);

    replacePlans([p1]);
    assert.equal(getPlansState().plans.length, 1);
    assert.equal(getPlan("p1")?.id, "p1");

    hydratePlans(); // safe no-op
  });

  it("round-trips in journal backup/restore", () => {
    const session: PlanningSession = {
      id: "plan-roundtrip",
      user_id: DEFAULT_OWNER_USER_ID,
      session_date: "2026-11-20",
      name: "Pre-market Plan",
      preset: "pre_market",
      anchor_time_utc: "2026-11-20T14:30:00.000Z",
      created_at: "2026-11-20T14:00:00.000Z",
      updated_at: "2026-11-20T14:00:00.000Z",
      observations: "Levels markup",
      bias: "bullish",
      watch_playbook_ids: ["pb-test"],
      levels: [
        {
          id: "lvl-test",
          price_ticks: 23700,
          price: 5925.0,
          label: "Resistance",
          kind: "level",
          note: "Top of range",
        },
      ],
      revisions: [],
    };

    const backup = buildBackup([], undefined, undefined, undefined, undefined, undefined, [session]);
    assert.ok(backup.plans);
    assert.equal(backup.plans.length, 1);
    assert.equal(backup.plans[0].id, "plan-roundtrip");

    const parsed = parseBackupFile(JSON.stringify(backup));
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.ok(parsed.plans);
      assert.equal(parsed.plans.length, 1);
      assert.equal(parsed.plans[0].name, "Pre-market Plan");
      assert.equal(parsed.plans[0].levels[0].price, 5925.0);
    }
  });

  it("keeps an explicit empty plans list so restore can clear stale device plans", () => {
    const backup = buildBackup([demoTrades[0]], undefined, undefined, undefined, undefined, undefined, []);
    const parsed = parseBackupFile(JSON.stringify(backup));
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.plans, []);
  });
});
