import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMarks } from "../trade-marks.ts";
import { deriveTrade, fromLegacy } from "../trade-document.ts";
import { normalizeTrade } from "../trades.ts";

test("buildMarks: adds R ruler marks and playbook label to plan box (M3, #42)", () => {
  // Long MES entry 6840 at 14:00, stop 6830 (10 pt risk = 1R), target 6860 (20 pts = +2.0R)
  const trade = normalizeTrade({
    id: "trade-ruler",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:00:00Z",
    exit_time: "2026-11-20T14:30:00Z",
    entry_price: 6840,
    exit_price: 6860,
    stop_loss_price: 6830,
    planned_target_price: 6860,
    quantity: 1,
  });

  const doc = fromLegacy(trade);
  const candleTimes = [
    Date.parse("2026-11-20T14:00:00Z"),
    Date.parse("2026-11-20T14:15:00Z"),
    Date.parse("2026-11-20T14:30:00Z"),
  ];

  const derived = deriveTrade(doc);
  const marks = buildMarks(derived, null, "1m", "high", false, {
    candleTimes,
    showRuler: true,
    playbookName: "VWAP Reclaim",
  });

  // Verify R ruler segments exist (+1R at 6850, +2R at 6860)
  const segments = marks.filter((m): m is Extract<typeof marks[number], { kind: "segment" }> => m.kind === "segment" && m.layer === "plan");
  assert.ok(segments.length >= 2, "must generate at least 2 ruler segments");
  assert.ok(segments.some((s) => s.p0 === 6850), "+1R segment at 6850");
  assert.ok(segments.some((s) => s.p0 === 6860), "+2R segment at 6860");

  // Verify R ruler labels (+1.0R, +2.0R: no accountRiskR, so 1 stop-width unit = 1R)
  const labels = marks.filter((m) => m.kind === "label");
  assert.ok(labels.some((l) => l.text === "+1.0R"), "must include +1.0R label");
  assert.ok(labels.some((l) => l.text === "+2.0R"), "must include +2.0R label");

  // Verify playbook mark
  const pbMark = labels.find((l) => l.text.includes("VWAP Reclaim"));
  assert.ok(pbMark, "must include playbook mark");
});

test("buildMarks: a 0.25R trade spaces its ruler at each stop width but labels it in account R (RS-3b, 04 §3.5)", () => {
  // $75 risk on a $300 R size is 0.25R. MES entry 6840, stop 6825 (15 pts), target 6885 (3× the stop width).
  const trade = normalizeTrade({
    id: "trade-ruler-025",
    symbol: "MES",
    direction: "LONG",
    entry_time: "2026-11-20T14:00:00Z",
    exit_time: "2026-11-20T14:30:00Z",
    entry_price: 6840,
    exit_price: 6850,
    stop_loss_price: 6825,
    planned_target_price: 6885,
    quantity: 1,
  });
  const candleTimes = [
    Date.parse("2026-11-20T14:00:00Z"),
    Date.parse("2026-11-20T14:15:00Z"),
    Date.parse("2026-11-20T14:30:00Z"),
  ];
  const marks = buildMarks(deriveTrade(fromLegacy(trade)), null, "1m", "high", false, {
    candleTimes,
    showRuler: true,
    accountRiskR: 0.25,
  });

  // Lines stay at 1×, 2×, 3× the 15-point stop width: 6855, 6870, 6885.
  const rulerPrices = marks
    .filter((m): m is Extract<typeof marks[number], { kind: "segment" }> => m.kind === "segment" && m.layer === "plan" && m.faint === true)
    .map((s) => s.p0);
  assert.deepEqual(rulerPrices.toSorted((a, b) => a - b), [6855, 6870, 6885]);

  // Labels are true account R: 1×, 2×, 3× of 0.25R.
  const labels = marks.filter((m) => m.kind === "label").map((m) => m.text);
  assert.ok(labels.includes("+0.25R"), "must include +0.25R");
  assert.ok(labels.includes("+0.5R"), "must include +0.5R");
  assert.ok(labels.includes("+0.75R"), "must include +0.75R");

  // Owner directive (W5-01): no floating TP label covering the target zone; R-ruler lines carry the R multiples.
  assert.equal(marks.some((m) => "label" in m && typeof m.label === "string" && m.label.startsWith("TP")), false);
});
