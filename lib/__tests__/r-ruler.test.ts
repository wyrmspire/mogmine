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

  // Verify R ruler labels (+1R, +2R)
  const labels = marks.filter((m) => m.kind === "label");
  assert.ok(labels.some((l) => l.text === "+1R"), "must include +1R label");
  assert.ok(labels.some((l) => l.text === "+2R"), "must include +2R label");

  // Verify playbook mark
  const pbMark = labels.find((l) => l.text.includes("VWAP Reclaim"));
  assert.ok(pbMark, "must include playbook mark");
});
