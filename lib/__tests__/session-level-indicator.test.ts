import assert from "node:assert/strict";
import test from "node:test";
import { createIndicatorInstance } from "../indicator-kit.ts";
import { buildSessionLevelIndicator } from "../session-level-indicator.ts";
import { computeLevelsFromInputs } from "../levels.ts";
import fixture from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };

const levels = computeLevelsFromInputs({ symbol: fixture.symbol, sessionDate: fixture.session_date, inputs: fixture.inputs });

test("session-level group toggles and per-group styles filter one bounded day", () => {
  const instance = createIndicatorInstance("session-levels", "levels");
  instance.params.overnight = false;
  instance.params.week = false;
  instance.params.mergeTolerance = 0;
  instance.style.priorDay.color = "#123456";
  const result = buildSessionLevelIndicator(instance, [{ sessionDate: fixture.session_date, from: 100, to: 200, levels }], 7600, "MES");
  assert.equal(result.lines.some(({ keys }) => keys.includes("onh") || keys.includes("onl")), false);
  assert.equal(result.lines.some(({ keys }) => keys.includes("week_high") || keys.includes("week_low")), false);
  const pdh = result.lines.find(({ keys }) => keys.includes("pdh"))!;
  assert.equal(pdh.color, "#123456");
  assert.deepEqual({ from: pdh.startAt, to: pdh.endAt }, { from: 100, to: 200 });
});

test("session-level mid lines and tolerance produce role-coloured rectangles", () => {
  const instance = createIndicatorInstance("session-levels", "levels");
  instance.params.midLines = true;
  instance.params.mergeTolerance = 5;
  const result = buildSessionLevelIndicator(instance, [{ sessionDate: fixture.session_date, from: 100, to: 200, levels }], 7594, "MES");
  assert.ok([...result.lines, ...result.zones.flatMap(({ lines: members }) => members ?? [])].some(({ names }) => names === "Prior-day mid"));
  const zone = result.zones.find(({ label }) => label.includes("Globex open") && label.includes("PP"))!;
  assert.equal(zone.label, "Prior-day mid / Globex open / RTH open / PP");
  assert.equal(zone.role, "neutral");
  assert.equal(zone.fillOpacity, 0.14);
});
