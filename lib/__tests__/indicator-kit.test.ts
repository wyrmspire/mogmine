import assert from "node:assert/strict";
import test from "node:test";
import { INDICATOR_REGISTRY, createIndicatorInstance, migrateLegacyIndicators, resetIndicatorInstance, sanitizeIndicatorInstances } from "../indicator-kit.ts";

test("IK-2 registry describes typed params and line/fill style slots", () => {
  assert.deepEqual(INDICATOR_REGISTRY.map(({ id }) => id), ["vwap", "ema", "volume", "session-levels"]);
  const vwap = INDICATOR_REGISTRY[0];
  assert.equal(vwap.params.anchor.type, "select");
  assert.equal(vwap.params.bandMultiples.type, "number-list");
  assert.equal(vwap.style.main.kind, "line");
  assert.equal(vwap.style.bandFill.kind, "fill");
  assert.equal(INDICATOR_REGISTRY.some(({ category }) => category === "Levels"), true, "registry categories support future ADR/zones");
});

test("instances are independent and reset preserves identity", () => {
  const first = createIndicatorInstance("ema", "ema-a");
  const second = createIndicatorInstance("ema", "ema-b");
  first.params.length = 20;
  first.style.main.color = "#ff00aa";
  assert.equal(second.params.length, 200);
  assert.equal(resetIndicatorInstance(first).instanceId, "ema-a");
  assert.equal(resetIndicatorInstance(first).params.length, 200);
});

test("sanitizer clamps inputs and styles and drops invalid or duplicate instances", () => {
  const raw = createIndicatorInstance("ema", "ema-a");
  raw.params.length = 900;
  raw.params.source = "median";
  raw.style.main = { kind: "line", title: "wrong", color: "javascript:no", width: 9, style: "dashdot", visible: true } as never;
  const clean = sanitizeIndicatorInstances([raw, raw, { indicatorId: "adr" }]);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].params.length, 500);
  assert.equal(clean[0].params.source, "close");
  assert.equal(clean[0].style.main.kind, "line");
  assert.equal(clean[0].style.main.width, 4);
  assert.equal(clean[0].style.main.color, "theme:ema");
});

test("legacy chart choices migrate without losing visibility, anchor, bands, fill or labels", () => {
  const migrated = migrateLegacyIndicators({ vwapAnchor: "rth", vwapBands: true, vwapBandMultiples: [0.5, 2], vwapBandFill: true, weeklyVwap: true, ema200: true, showVolume: false, levelLabels: "always", showLevels: false });
  assert.deepEqual(migrated.map(({ instanceId }) => instanceId), ["session-levels-default", "vwap-session", "vwap-week", "ema-200", "volume-default"]);
  assert.equal(migrated[0].visible, false);
  assert.equal(migrated[0].params.labelMode, "always");
  assert.equal(migrated[1].params.anchor, "rth");
  assert.deepEqual(migrated[1].params.bandMultiples, [0.5, 2]);
  assert.equal(migrated[1].style.bandFill.visible, true);
  assert.equal(migrated[2].params.anchor, "week");
  assert.equal(migrated[3].visible, true);
  assert.equal(migrated[4].visible, false);
});
