// SM-2: an unrecorded stop move is modelled as an "untimed" modify at the exit instant (SM-UT-1..3).
// Planned TP/SL boxes stay on the chart for every outcome (SM-2 addendum, D-TP).
import assert from "node:assert/strict";
import test from "node:test";
import { observeTrade } from "../trade-bar-validation.ts";
import { collectDataNotes } from "../data-notes.ts";
import { deriveTrade, fromLegacy, stopAtExit } from "../trade-document.ts";
import { buildMarks } from "../trade-marks.ts";
import type { DetailLevel, Mark } from "../trade-marks.ts";
import { PositionBoxPrimitive } from "../../components/PositionBoxPrimitive.ts";
import { demoTrades } from "../fixtures.ts";
import { normalizeTrade } from "../trades.ts";
import type { Candle, TradeRecord } from "../trades.ts";

const minute = 60_000;
const START = Date.parse("2026-11-23T13:55:00Z"); // 07:55 CT (CST)

// Trade A (05 §2.1, §5 row A): LONG 7137.00 at 07:55 CT, stop 7119.50 trailed to 7260.00 before the 08:30 CT exit.
function tradeA(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: "trade-a",
    symbol: "MES",
    direction: "LONG",
    quantity: 2,
    entry_time: "2026-11-23T13:55:00Z",
    exit_time: "2026-11-23T14:30:00Z",
    entry_price: 7137,
    exit_price: 7260,
    initial_stop_price: 7119.5,
    initial_stop_set_at: "2026-11-23T13:55:00Z",
    stop_loss_price: 7260,
    stop_moves: [],
    planned_target_price: 7300,
    ...overrides,
  });
}

// One complete 1m bar per minute from 07:55 to 08:30 CT. Hold bars trade 7150-7250, below the moved 7260.
function barsA(overrides: Record<number, [number, number]> = {}): Candle[] {
  const bars: Candle[] = [];
  for (let t = START; t <= START + 35 * minute; t += minute) {
    const minuteIndex = (t - START) / minute;
    const [low, high] = overrides[minuteIndex] ?? (minuteIndex === 0 ? [7130, 7140] : minuteIndex === 35 ? [7255, 7262] : [7150, 7250]);
    bars.push({ time: t, open: low, high, low, close: high, volume: 1 });
  }
  return bars;
}

function barTimes(bars: Candle[]) {
  return bars.map((bar) => bar.time);
}

const exitBar = START + 35 * minute; // 08:30 CT

test("Trade A untimed trail: the 7260 modify sits at the exit instant with basis untimed", () => {
  const doc = fromLegacy(tradeA());
  const modify = doc.events.find((event) => event.type === "modify");
  assert.equal(modify?.basis, "untimed");
  assert.equal(modify?.t, "2026-11-23T14:30:00Z");
  assert.equal(modify?.type === "modify" ? modify.price : null, 7260);
  // SM-UT-1: the first stop's time is never used as the move time.
  assert.notEqual(modify?.t, "2026-11-23T13:55:00Z");

  const derived = deriveTrade(doc);
  assert.equal(derived.stop_path.length, 2);
  assert.equal(derived.stop_path[0].price, 7119.5);
  assert.equal(derived.stop_path[0].to, "2026-11-23T14:30:00Z");
  assert.equal(derived.stop_path[1].price, 7260);
  assert.equal(derived.stop_path[1].basis, "untimed");
  // The exit fills at the working stop at the exit instant, so the exit reads as a stop, consistent with the move.
  assert.equal(stopAtExit(derived)?.price, 7260);
  assert.equal(derived.closed_lots[0]?.exit_reason, "stop");
});

test("open trade with an unrecorded move: the initial stop stays the working stop across the hold", () => {
  const open = normalizeTrade({
    id: "open-a", symbol: "MES", direction: "LONG", status: "open", quantity: 2,
    entry_time: "2026-11-23T13:55:00Z", exit_time: null, entry_price: 7137, exit_price: null,
    initial_stop_price: 7119.5, initial_stop_set_at: "2026-11-23T13:55:00Z", stop_loss_price: 7260,
  });
  const derived = deriveTrade(fromLegacy(open));
  assert.equal(derived.stop_path.length, 1);
  assert.equal(derived.stop_path[0].price, 7119.5);
  // The initial stop is still checked across the hold, so a dip under 7119.50 is a real finding.
  const facts = observeTrade(derived, barsA({ 10: [7118, 7135] }), 1);
  assert.equal(facts.findings.filter((finding) => finding.code === "stop_traded_through" && finding.price === 7119.5).length, 1);
});

test("Trade A untimed trail: no false stop_traded_through while the bars trade above the initial stop", () => {
  const derived = deriveTrade(fromLegacy(tradeA()));
  const bars = barsA();
  const facts = observeTrade(derived, bars, 1);
  assert.equal(facts.findings.filter((finding) => finding.code === "stop_traded_through").length, 0);
});

test("Trade A untimed trail: a dip below the initial stop still flags the initial stop at 7119.50", () => {
  const derived = deriveTrade(fromLegacy(tradeA()));
  const bars = barsA({ 10: [7118, 7135] }); // 08:05 CT
  const facts = observeTrade(derived, bars, 1);
  const hits = facts.findings.filter((finding) => finding.code === "stop_traded_through");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].price, 7119.5);
  assert.equal(hits[0].barTime, START + 10 * minute);
});

test("Trade A untimed trail: medium detail draws a dashed step to 7260 with 'moved · time?'; low detail omits the label", () => {
  const derived = deriveTrade(fromLegacy(tradeA()));
  const bars = barsA();
  const facts = observeTrade(derived, bars, 1);
  const options = { candleTimes: barTimes(bars) };
  const build = (detail: DetailLevel) => buildMarks(derived, facts, "1m", detail, false, options);

  const medium = build("medium");
  const step = medium.find((mark) => mark.kind === "segment" && mark.t0 === exitBar && mark.t1 === exitBar && mark.p0 === 7119.5 && mark.p1 === 7260);
  assert.ok(step?.kind === "segment");
  assert.equal(step.dash, "dashed");
  const label = medium.find((mark): mark is Extract<Mark, { kind: "flag" }> => mark.kind === "flag" && mark.text === "moved · time?");
  assert.ok(label, "medium detail labels the untimed move");
  assert.equal(label.t, exitBar);
  assert.equal(label.price, 7260);

  const low = build("low");
  assert.equal(low.some((mark) => mark.kind === "flag" && mark.text.includes("moved · time?")), false);
  assert.ok(low.some((mark) => mark.kind === "segment" && mark.t0 === exitBar && mark.p0 === 7119.5 && mark.p1 === 7260),
    "the dashed step is still drawn at low detail");
});

test("Trade A untimed trail: the quiet data note offers to add the time", () => {
  const derived = deriveTrade(fromLegacy(tradeA()));
  const bars = barsA();
  const facts = observeTrade(derived, bars, 1);
  const notes = collectDataNotes({
    noCandles: false, base: "1m", misaligned: false, ticker: "MES=F", coverage: facts.coverage,
    chronologyUnresolved: false, findings: facts.findings, symbol: "MES", zone: "America/Chicago",
    untimedStopMovePrice: 7260,
  });
  const note = notes.find((item) => item.id === "untimed_stop_move");
  assert.equal(note?.text, "Your stop moved to 7260.00 at a time you did not record. Add the time to check it against the bars.");
  assert.equal(note?.tone, "quiet");
  assert.deepEqual(note?.action, { kind: "edit_untimed_stop", price: 7260 });
  assert.equal(notes.some((item) => item.tone === "untrusted"), false);
});

test("Trade A WITH a timed move: stated basis, stepped at 08:25 CT, checked from 08:25 on, no 'moved · time?' label", () => {
  const timed = tradeA({ stop_moves: [{ price: 7260, time: "2026-11-23T14:25:00Z" }] });
  const derived = deriveTrade(fromLegacy(timed));
  const moved = derived.stop_path.find((stop) => stop.price === 7260);
  assert.equal(moved?.basis, "stated");
  assert.equal(moved?.from, "2026-11-23T14:25:00Z");

  // 08:25 to 08:29 CT trade above 7260 unless a test bar says otherwise, so only the bars under test can touch it.
  const above = Object.fromEntries([30, 31, 32, 33, 34].map((minuteIndex) => [minuteIndex, [7265, 7270]]));
  // Before 08:25 CT the moved stop is not live: a 08:15 dip to 7250 is not a touch of 7260.
  const early = barsA({ ...above, 20: [7200, 7250] });
  assert.equal(observeTrade(derived, early, 1).findings.filter((finding) => finding.code === "stop_traded_through").length, 0);
  // From 08:25 CT on, a bar under 7260 (08:27 CT) is checked against the moved stop.
  const late = barsA({ ...above, 32: [7250, 7258] });
  const lateHits = observeTrade(derived, late, 1).findings.filter((finding) => finding.code === "stop_traded_through");
  assert.deepEqual(lateHits.map((hit) => [hit.price, hit.barTime]), [[7260, START + 32 * minute]]);

  const marks = buildMarks(derived, observeTrade(derived, barsA(), 1), "1m", "medium", false, { candleTimes: barTimes(barsA()) });
  assert.equal(marks.some((mark) => mark.kind === "flag" && mark.text.includes("moved · time?")), false);
  assert.equal(marks.some((mark) => mark.kind === "flag" && mark.text.includes("time?")), false);
});

// --- SM-2 addendum: planned TP/SL boxes stay drawn for every outcome ---

function demo(id: string): TradeRecord {
  const found = demoTrades.find((trade) => trade.id === id);
  assert.ok(found, `missing demo trade ${id}`);
  return found;
}

// Candle times on each minute around the hold, enough for anchoring marks (no bar values are needed).
function timesAround(record: TradeRecord): number[] {
  const from = Date.parse(record.entry_time) - 5 * minute;
  const to = Date.parse(record.exit_time ?? record.entry_time) + 5 * minute;
  const times: number[] = [];
  for (let t = from; t <= to; t += minute) times.push(t);
  return times;
}

function plannedPlanZones(marks: readonly Mark[]) {
  return marks.filter((mark): mark is Extract<Mark, { kind: "zone" }> => mark.kind === "zone" && mark.layer === "plan");
}

test("addendum: mes-failed-reclaim (exit = SL) keeps the planned TP zone and includes 7560.75 in autoscale", () => {
  const record = demo("mes-failed-reclaim");
  const derived = deriveTrade(fromLegacy(record));
  assert.equal(derived.status, "closed");
  assert.equal(derived.planned_targets[0]?.price, 7560.75);
  const marks = buildMarks(derived, null, "1m", "medium", false, { candleTimes: timesAround(record) });

  const tp = plannedPlanZones(marks).find((zone) => zone.tone === "profit");
  assert.ok(tp, "planned TP zone is drawn after the SL hit");
  assert.deepEqual([Math.min(tp.p0, tp.p1), Math.max(tp.p0, tp.p1)], [7550.75, 7560.75]);

  const box = new PositionBoxPrimitive();
  box.update(marks, {} as never);
  const range = box.autoscaleInfo()?.priceRange;
  assert.ok(range && range.minValue <= 7560.75 && range.maxValue >= 7560.75, "autoscale includes the planned target");
});

test("addendum: early/manual exit (mes-opening-scalp) keeps planned SL and TP zones plus a distinct actual-exit mark", () => {
  const record = demo("mes-opening-scalp");
  const derived = deriveTrade(fromLegacy(record));
  // Exit 7517.50 is neither the SL 7511.50 nor the TP 7529.50: an early/manual exit.
  const marks = buildMarks(derived, null, "1m", "medium", false, { candleTimes: timesAround(record) });
  const plan = plannedPlanZones(marks);
  assert.ok(plan.some((zone) => zone.tone === "risk"), "planned SL zone stays");
  assert.ok(plan.some((zone) => zone.tone === "profit"), "planned TP zone stays");
  // The exit fill is a flag at its own price (snapped to its bar), separate from the plan boxes.
  const exitFlag = marks.find((mark) => mark.kind === "flag" && mark.shape === "triangle_down" && mark.price === record.exit_price);
  assert.ok(exitFlag, "the actual exit is marked at its own price, over the plan");
});
