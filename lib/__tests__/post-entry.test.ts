// SM-1 (docs/design-2026-11-24/05 §1): stop touches and MAE/MFE are measured strictly after the entry bar.
// R-POST-1 the entry bar is never inside the hold; R-POST-2 MAE/MFE null with fewer than two inside bars;
// R-POST-3 stop checks use the same inside set; R-POST-4 the entry bar's pre-fill range is a quiet note only;
// R-POST-5 one helper (`insideBarTimes`) owns the rule. D-I: a matched (FB-1) entry bar is the entry bar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { collectDataNotes, hasUntrustedDataNote } from "../data-notes.ts";
import { deriveTrade } from "../trade-document.ts";
import type { TradeDocument } from "../trade-document.ts";
import { observeTrade } from "../trade-bar-validation.ts";
import { buildFindingMarks } from "../trade-marks.ts";
import { excursions } from "../trades.ts";
import type { Candle } from "../trades.ts";
import { expectedInsideBarTimes, insideBarTimes } from "../session.ts";

const MINUTE = 60_000;
const PASSED_NOTE = "The entry bar traded past the stop before your fill. That is not counted as a stop touch.";

function fixture(name: string): TradeDocument {
  return JSON.parse(readFileSync(new URL(`../../fixtures/trades/${name}.json`, import.meta.url), "utf8"));
}

/** One candle per minute from `startIso`. `overrides` maps a minute offset to its [low, high]. */
function series(startIso: string, count: number, base: [number, number], overrides: Record<number, [number, number]> = {}): Candle[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, offset) => {
    const [low, high] = overrides[offset] ?? base;
    const mid = (low + high) / 2;
    return { time: start + offset * MINUTE, open: mid, close: mid, low, high, volume: 1 };
  });
}

function tradeDoc(side: "long" | "short", stop: number, entry: { t: string; price: number }, exit: { t: string; price: number }): TradeDocument {
  const doc = fixture("ex-sl");
  doc.side = side;
  doc.events = [
    { seq: 1, t: "2026-11-23T13:00:00Z", type: "plan", basis: "stated", qty: 1, entry: { order: "market", price: entry.price }, stop, targets: [] },
    { seq: 2, t: entry.t, type: "fill", basis: "stated", role: "entry", qty: 1, price: entry.price },
    { seq: 3, t: exit.t, type: "fill", basis: "stated", role: "exit", qty: 1, price: exit.price },
  ];
  return doc;
}

const stopFindings = (findings: { code: string }[]) => findings.filter((finding) => finding.code === "stop_traded_through");

test("R-POST-1 helper: insideBarTimes never includes the entry bar, while expectedInsideBarTimes keeps it for coverage", () => {
  const entry = Date.parse("2026-11-23T13:55:00Z");
  const exit = Date.parse("2026-11-23T13:58:00Z");
  assert.deepEqual(insideBarTimes(entry, exit, MINUTE, "MES"), [entry + MINUTE, entry + 2 * MINUTE]);
  // `:30` seconds: the entry bar is 13:55 too.
  assert.deepEqual(insideBarTimes(entry + 30_000, exit, MINUTE, "MES"), [entry + MINUTE, entry + 2 * MINUTE]);
  // Coverage keeps its old meaning (market-data/coverage.ts relies on it).
  assert.deepEqual(expectedInsideBarTimes(entry, exit, MINUTE, "MES"), [entry, entry + MINUTE, entry + 2 * MINUTE]);
});

// Trade A (05 §1.1, §5 row A): LONG entry 7137.00 at 07:55 CT, stop 7119.50. The 07:55 bar's low (7083.75)
// is below the stop and was traded before the fill. Later bars hold >= 7125.00.
const tradeA = {
  candles: () => series("2026-11-23T13:55:00Z", 36, [7126, 7135], { 0: [7083.75, 7142], 15: [7125, 7135], 35: [7127, 7130] }),
  stop: 7119.5,
};

for (const [label, entryIso] of [["stated :00 seconds", "2026-11-23T13:55:00Z"], ["stated :30 seconds", "2026-11-23T13:55:30Z"]] as const) {
  test(`Trade A (${label}): the entry bar's range past the stop is not a stop touch and not an MAE`, () => {
    const doc = tradeDoc("long", tradeA.stop, { t: entryIso, price: 7137 }, { t: "2026-11-23T14:30:00Z", price: 7128 });
    const derived = deriveTrade(doc);
    const candles = tradeA.candles();
    const observed = observeTrade(derived, candles);

    assert.deepEqual(stopFindings(observed.findings), []);
    assert.deepEqual(observed.findings, []);
    assert.equal(observed.entryBarPassedStop, true);
    assert.equal(observed.excursions?.maePrice, 7125);
    assert.equal(observed.excursions?.mfePrice, 7137);

    const direct = excursions({ direction: "LONG", entry_time: entryIso, exit_time: "2026-11-23T14:30:00Z", entry_price: 7137, exit_price: 7128, symbol: "MES" }, candles);
    assert.equal(direct?.maePrice, 7125);

    // The chart draws zero flags for the entry bar's range (no finding is pushed).
    assert.equal(buildFindingMarks(observed.findings, new Set(candles.map((bar) => bar.time))).length, 0);

    const notes = collectDataNotes({
      noCandles: false, base: "1m", misaligned: false, ticker: "MES=F", coverage: observed.coverage,
      chronologyUnresolved: false, findings: observed.findings, symbol: "MES", entryBarPassedStop: observed.entryBarPassedStop,
    });
    const passed = notes.find((note) => note.id === "entry_bar_passed_stop");
    assert.deepEqual(passed, { id: "entry_bar_passed_stop", text: PASSED_NOTE, tone: "quiet" });
    assert.equal(hasUntrustedDataNote(notes), false);
  });
}

test("SHORT mirror: the entry bar's high past the stop is not a stop touch; MAE is the highest inside high", () => {
  const candles = series("2026-11-23T15:30:00Z", 31, [7396, 7402], { 0: [7390, 7418], 10: [7396, 7404], 30: [7398, 7406] });
  const doc = tradeDoc("short", 7410, { t: "2026-11-23T15:30:00Z", price: 7400 }, { t: "2026-11-23T16:00:00Z", price: 7402 });
  const observed = observeTrade(deriveTrade(doc), candles);
  assert.deepEqual(stopFindings(observed.findings), []);
  assert.equal(observed.entryBarPassedStop, true);
  assert.equal(observed.excursions?.maePrice, 7404);
  assert.equal(observed.excursions?.mfePrice, 7396);
});

test("a hold with fewer than two inside bars after excluding the entry bar has null excursions and no stop touch", () => {
  const candles = series("2026-11-23T15:30:00Z", 31, [7396, 7402], { 0: [7390, 7418], 10: [7396, 7404], 30: [7398, 7406] });
  // Exit at 15:31:30: no bar fully inside the hold.
  const none = observeTrade(deriveTrade(tradeDoc("short", 7410, { t: "2026-11-23T15:30:00Z", price: 7400 }, { t: "2026-11-23T15:31:30Z", price: 7401 })), candles);
  assert.equal(none.excursions, null);
  assert.deepEqual(stopFindings(none.findings), []);
  assert.equal(none.entryBarPassedStop, true);

  // Exit at 15:32:00: only the 15:31 bar is inside, so one bar is not enough (R-POST-2).
  const one = observeTrade(deriveTrade(tradeDoc("short", 7410, { t: "2026-11-23T15:30:00Z", price: 7400 }, { t: "2026-11-23T15:32:00Z", price: 7401 })), candles);
  assert.equal(one.excursions, null);
  assert.deepEqual(stopFindings(one.findings), []);
  assert.equal(excursions({ direction: "SHORT", entry_time: "2026-11-23T15:30:00Z", exit_time: "2026-11-23T15:32:00Z", entry_price: 7400, exit_price: 7401, symbol: "MES" }, candles), null);
});

test("FB-1 + SM-1: a shifted entry's matched bar is excluded, and the stated minute's bar is an inside bar and checked", () => {
  // Logged 14:14:00 at 7137; the price traded in the 14:13 bar (range crossed the stop 7119.50), not the 14:14 bar.
  // The 14:14 bar's low (7118) is inside the hold, so it is a real stop touch.
  const candles = series("2026-11-23T14:13:00Z", 28, [7126, 7135], { 0: [7100, 7140], 1: [7118, 7131], 27: [7127, 7130] });
  const doc = tradeDoc("long", 7119.5, { t: "2026-11-23T14:14:00Z", price: 7137 }, { t: "2026-11-23T14:40:00Z", price: 7128 });
  const observed = observeTrade(deriveTrade(doc), candles);

  assert.deepEqual(observed.findings.filter((finding) => finding.code === "fill_time_shifted"), [{
    code: "fill_time_shifted", barTime: Date.parse("2026-11-23T14:13:00Z"), price: 7137, basis: "inferred",
    segment: 2, statedBarTime: Date.parse("2026-11-23T14:14:00Z"), offsetMin: -1, role: "entry",
  }]);
  assert.deepEqual(stopFindings(observed.findings), [{
    code: "stop_traded_through", barTime: Date.parse("2026-11-23T14:14:00Z"), price: 7119.5, basis: "inferred", segment: 0,
  }]);
  assert.equal(observed.entryBarPassedStop, true);
  assert.equal(observed.excursions?.maePrice, 7118);
});
