import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { computeLevelsFromInputs } from "../levels.ts";
import { levelLines } from "../chart-levels.ts";
import { SessionLevelsPrimitive } from "../../components/SessionLevelsPrimitive.ts";
import type { ChartTheme } from "../theme.ts";

const theme = {
  surface: "#111", levelResistance: "#ef4444", levelSupport: "#10b981", levelAdr: "#f5b544",
  levelNeutral: "#9ca3af", levelLabelText: "#ffffff",
} as ChartTheme;

test("levels never widen the price scale, so S2/R2 do not compress the trade (regression for #154)", () => {
  const primitive = new SessionLevelsPrimitive();
  const levels = computeLevelsFromInputs({ symbol: fixture.symbol, sessionDate: fixture.session_date, inputs: fixture.inputs });
  primitive.update(levelLines(levels, 7600, "MES"), theme, 60_000);
  assert.equal(primitive.autoscaleInfo(), null);
});

test("rays paint under the Position Box and pills on top", () => {
  const views = new SessionLevelsPrimitive().paneViews();
  assert.deepEqual(views.map((view) => view.zOrder?.()), ["bottom", "top"]);
});

test("a settlement proxy is carried to the line so its ray is dashed", () => {
  const levels = computeLevelsFromInputs({
    symbol: "MES", sessionDate: "2026-11-12",
    inputs: { prior_session: { session_date: "2026-11-11", high: 7671.5, low: 7547.5, settle: 7640.5, settle_provenance: { source: "Yahoo daily close", isProxy: true } } },
  });
  const pdc = levelLines(levels, 7600, "MES").find((line) => line.keys.includes("pdc"));
  assert.equal(pdc?.label, "7640.50 PDC (proxy)");
  assert.equal(pdc?.proxy, true);
  assert.equal(levelLines(levels, 7600, "MES").find((line) => line.keys.includes("pdh"))?.proxy, false);
});
