import assert from "node:assert/strict";
import { test } from "node:test";
import fixture from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { computeLevelsFromInputs } from "../levels.ts";
import { levelRole, SessionLevelsPrimitive } from "../../components/SessionLevelsPrimitive.ts";
import type { ChartTheme } from "../theme.ts";

test("levelRole categorizes all computed level types correctly per docs/12 §4, §5", () => {
  assert.equal(levelRole("adr_high"), "adr");
  assert.equal(levelRole("adr_low"), "adr");
  assert.equal(levelRole("adr_inner_high"), "adr");
  assert.equal(levelRole("adr_inner_low"), "adr");

  assert.equal(levelRole("pdh"), "resistance");
  assert.equal(levelRole("rth_high"), "resistance");
  assert.equal(levelRole("onh"), "resistance");
  assert.equal(levelRole("r1"), "resistance");
  assert.equal(levelRole("r2"), "resistance");
  assert.equal(levelRole("week_high"), "resistance");

  assert.equal(levelRole("pdl"), "support");
  assert.equal(levelRole("rth_low"), "support");
  assert.equal(levelRole("onl"), "support");
  assert.equal(levelRole("s1"), "support");
  assert.equal(levelRole("s2"), "support");
  assert.equal(levelRole("week_low"), "support");

  assert.equal(levelRole("pp"), "neutral");
  assert.equal(levelRole("globex_open"), "neutral");
  assert.equal(levelRole("rth_open"), "neutral");
  assert.equal(levelRole("rth_close"), "neutral");
  assert.equal(levelRole("pdc"), "neutral");
});

test("SessionLevelsPrimitive lifecycle and autoscaleInfo", () => {
  const primitive = new SessionLevelsPrimitive();
  assert.equal(primitive.autoscaleInfo(), null);

  const levels = computeLevelsFromInputs({
    symbol: fixture.symbol,
    sessionDate: fixture.session_date,
    inputs: fixture.inputs,
  });

  const mockTheme: ChartTheme = {
    chartBg: "#000",
    chartGrid: "#111",
    chartAxis: "#222",
    chartBorder: "#333",
    crosshair: "#444",
    candleUp: "#555",
    candleDown: "#666",
    profit: "#777",
    risk: "#888",
    profitText: "#999",
    lossText: "#aaa",
    boxActual: "#bbb",
    boxPlanned: "#ccc",
    goldMid: "#ddd",
    goldLight: "#eee",
    textPrimary: "#fff",
    textMuted: "#888",
    surface: "#111",
    elevated: "#222",
    boxOpacity: 0.28,
    levelResistance: "#ef4444",
    levelSupport: "#10b981",
    levelAdr: "#f5b544",
    levelNeutral: "#9ca3af",
    levelLabelText: "#ffffff",
  };

  primitive.update(levels, true, mockTheme);
  const autoscale = primitive.autoscaleInfo();
  assert.ok(autoscale);
  assert.equal(autoscale?.priceRange?.minValue, 7495.75); // S2
  assert.equal(autoscale?.priceRange?.maxValue, 7743.75); // R2

  assert.equal(primitive.paneViews().length, 1);
  const view = primitive.paneViews()[0];
  assert.equal(typeof view.zOrder === "function" ? view.zOrder() : undefined, "bottom");
});
