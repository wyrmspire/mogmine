// docs/15 §3, issue #36 (G1): "How did it end?" one-tap exit reason
import assert from "node:assert/strict";
import { test } from "node:test";
import { freshEntryDraft, upgradeDraft } from "../entry-form.ts";
import { deriveTrade, fromLegacy } from "../trade-document.ts";
import type { FillEvent, TradeDocument, TradeEvent } from "../trade-document.ts";
import { buildMarks } from "../trade-marks.ts";
import type { FlagMark, Mark } from "../trade-marks.ts";
import { closeTradePatch, EXIT_REASONS, isExitReason, normalizeTrade } from "../trades.ts";
import type { TradeExitReason, TradeRecord } from "../trades.ts";

function exitFillOf(doc: TradeDocument): FillEvent {
  const fill = doc.events.find((e: TradeEvent): e is FillEvent => e.type === "fill" && e.role === "exit");
  assert.ok(fill, "expected an exit fill");
  return fill;
}

function closedTrade(patch: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "t-closed",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: "2026-11-20T14:30:00.000Z",
    exit_time: "2026-11-20T15:00:00.000Z",
    entry_price: 6000,
    exit_price: 6010,
    stop_loss_price: 5990,
    planned_target_price: 6020,
    ...patch,
  });
}

test("EXIT_REASONS exports five canonical exit reasons and flags (G1)", () => {
  assert.equal(EXIT_REASONS.length, 5);
  const reasons = EXIT_REASONS.map((r) => r.value);
  assert.deepEqual(reasons, ["target", "stop", "trail", "breakeven", "manual"]);
  const labels = EXIT_REASONS.map((r) => r.label);
  assert.deepEqual(labels, ["Target", "Stop", "Trailed", "Breakeven", "Market"]);
  const flags = EXIT_REASONS.map((r) => r.flag);
  assert.deepEqual(flags, ["TP", "SL", "TRAIL", "BE", "MKT"]);

  assert.equal(isExitReason("target"), true);
  assert.equal(isExitReason("stop"), true);
  assert.equal(isExitReason("trail"), true);
  assert.equal(isExitReason("breakeven"), true);
  assert.equal(isExitReason("manual"), true);
  assert.equal(isExitReason("other"), false);
  assert.equal(isExitReason(null), false);
});

test("normalizeTrade preserves valid exit_reason on closed trades and forces null on open trades", () => {
  const t = closedTrade({ exit_reason: "target" });
  assert.equal(t.exit_reason, "target");

  const invalid = closedTrade({ exit_reason: "bad" as unknown as TradeExitReason });
  assert.equal(invalid.exit_reason, null);

  const open = normalizeTrade({
    id: "t-open",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "open",
    entry_time: "2026-11-20T14:30:00.000Z",
    exit_time: null,
    entry_price: 6000,
    exit_price: null,
    exit_reason: "target",
  });
  assert.equal(open.exit_reason, null, "open trade cannot have an exit reason");
});

test("closeTradePatch sets exit fields and exit_reason", () => {
  const patch = closeTradePatch(
    { entry_time: "2026-11-20T14:30:00.000Z" },
    "2026-11-20T15:00:00.000Z",
    6010,
    "trail",
  );
  assert.equal(patch.status, "closed");
  assert.equal(patch.exit_time, "2026-11-20T15:00:00.000Z");
  assert.equal(patch.exit_price, 6010);
  assert.equal(patch.exit_reason, "trail");
});

test("fromLegacy and deriveTrade assign stated basis and map to outcomes", () => {
  // Stated target
  const tpTrade = closedTrade({ exit_reason: "target" });
  const tpDoc = fromLegacy(tpTrade);
  const tpExitFill = exitFillOf(tpDoc);
  assert.equal(tpExitFill.reason, "target");
  assert.equal(tpExitFill.reason_basis, "stated");
  const tpDerived = deriveTrade(tpDoc);
  assert.equal(tpDerived.outcome, "target");

  // Stated stop
  const slTrade = closedTrade({ exit_reason: "stop" });
  const slDoc = fromLegacy(slTrade);
  const slExitFill = exitFillOf(slDoc);
  assert.equal(slExitFill.reason, "stop");
  assert.equal(slExitFill.reason_basis, "stated");
  const slDerived = deriveTrade(slDoc);
  assert.equal(slDerived.outcome, "stop");

  // Stated trail
  const trailTrade = closedTrade({ exit_reason: "trail" });
  const trailDoc = fromLegacy(trailTrade);
  const trailExitFill = exitFillOf(trailDoc);
  assert.equal(trailExitFill.reason, "trail");
  assert.equal(trailExitFill.reason_basis, "stated");
  const trailDerived = deriveTrade(trailDoc);
  assert.equal(trailDerived.outcome, "trail");

  // Stated breakeven
  const beTrade = closedTrade({ exit_reason: "breakeven" });
  const beDoc = fromLegacy(beTrade);
  const beExitFill = exitFillOf(beDoc);
  assert.equal(beExitFill.reason, "breakeven");
  assert.equal(beExitFill.reason_basis, "stated");
  const beDerived = deriveTrade(beDoc);
  assert.equal(beDerived.outcome, "scratch");
  assert.equal(beDerived.is_scratch, true);

  // Stated manual / market
  const mktTrade = closedTrade({ exit_reason: "manual" });
  const mktDoc = fromLegacy(mktTrade);
  const mktExitFill = exitFillOf(mktDoc);
  assert.equal(mktExitFill.reason, "manual");
  assert.equal(mktExitFill.reason_basis, "stated");
  const mktDerived = deriveTrade(mktDoc);
  assert.equal(mktDerived.outcome, "manual");
});

test("buildMarks displays corresponding exit flag text: TP, SL, TRAIL, BE, MKT", () => {
  const times = [Date.parse("2026-11-20T14:30:00.000Z"), Date.parse("2026-11-20T15:00:00.000Z")];
  const flagsFor = (reason: TradeExitReason) => {
    const t = closedTrade({ exit_reason: reason });
    const doc = fromLegacy(t);
    const derived = deriveTrade(doc);
    const marks = buildMarks(derived, null, "1m", "medium", false, { candleTimes: times });
    const flags = marks.filter((m: Mark): m is FlagMark => m.kind === "flag");
    // The exit flag sits at the exit bar and exit price (the entry arrow sits at entry).
    const exitMs = Date.parse(t.exit_time ?? "");
    const exitFlag = flags.find((f) => f.t === exitMs && f.price === t.exit_price);
    return exitFlag?.text;
  };

  // Owner directive (W5-01): no floating TP or SL labels covering candlesticks.
  assert.equal(flagsFor("target"), "");
  assert.equal(flagsFor("stop"), "");
  assert.equal(flagsFor("trail"), "TRAIL");
  assert.equal(flagsFor("breakeven"), "BE");
  assert.equal(flagsFor("manual"), "MKT");
});

test("freshEntryDraft and upgradeDraft roundtrip exitReason", () => {
  const fresh = freshEntryDraft(new Date("2026-11-20T15:00:00.000Z"), "America/Chicago");
  assert.equal(fresh.exitReason, null);

  const upgraded = upgradeDraft({ exitReason: "trail" }, new Date("2026-11-20T15:00:00.000Z"), "America/Chicago");
  assert.equal(upgraded.exitReason, "trail");

  const nullUpgraded = upgradeDraft({ exitReason: "invalid" }, new Date("2026-11-20T15:00:00.000Z"), "America/Chicago");
  assert.equal(nullUpgraded.exitReason, null);
});
