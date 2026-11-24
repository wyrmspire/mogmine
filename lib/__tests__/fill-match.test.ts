// FB-1: ±5-minute fill-to-bar matching (docs/design-2026-11-24/05 §4.4 and §5 row C).
// Times are UTC. Nov 24 2026 is Central Standard Time, so 14:14 CT is 20:14Z.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { matchFill, matchTradeFills } from "../fill-match.ts";
import { collectDataNotes } from "../data-notes.ts";
import { observeTrade } from "../trade-bar-validation.ts";
import { deriveTrade } from "../trade-document.ts";
import type { TradeDocument } from "../trade-document.ts";
import { buildMarks } from "../trade-marks.ts";
import type { FlagMark } from "../trade-marks.ts";
import type { Candle } from "../trades.ts";

const DAY = "2026-11-24";
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00Z`);
const iso = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

function bars(rows: Array<[hhmm: string, low: number, high: number]>): Candle[] {
  return rows.map(([hhmm, low, high]) => ({ time: at(hhmm), low, high, open: low, close: high, volume: 1 }));
}

const SYMBOL = "MES";

// Trade C pattern (§5): 7263 logged at 14:14 CT, printed only in the 14:13 CT bar.
const tradeC = (): Candle[] => bars([
  ["20:13", 7261, 7265.5],
  ["20:14", 7256, 7260],
  ["20:15", 7255, 7262],
]);

function openLongEntry(hhmm: string, price: number): TradeDocument {
  const doc: TradeDocument = JSON.parse(readFileSync(new URL("../../fixtures/trades/ex-sl.json", import.meta.url), "utf8"));
  doc.events = [{ seq: 1, t: iso(hhmm), type: "fill", role: "entry", qty: 1, price, basis: "stated" }];
  doc.mood_records = [];
  return doc;
}

test("the stated minute bar holds the price exactly: stated, no shift", () => {
  const candles = bars([["10:00", 7300, 7301], ["10:01", 7290, 7310]]);
  assert.deepEqual(matchFill(candles, iso("10:00"), 7300.5, SYMBOL), { kind: "stated", barTime: at("10:00") });
});

test("trade C: 7263 logged at 14:14 CT is shifted -1 to the 14:13 bar, with no outside finding", () => {
  const candles = tradeC();
  assert.deepEqual(matchFill(candles, iso("20:14"), 7263, SYMBOL), {
    kind: "shifted", barTime: at("20:13"), statedBarTime: at("20:14"), offsetMin: -1,
  });

  const derived = deriveTrade(openLongEntry("20:14", 7263));
  const facts = observeTrade(derived, candles);
  assert.deepEqual(facts.findings, [{
    code: "fill_time_shifted", barTime: at("20:13"), price: 7263, basis: "inferred", segment: 1,
    statedBarTime: at("20:14"), offsetMin: -1, role: "entry",
  }]);
  assert.equal(facts.fillMatches?.get(1)?.barTime, at("20:13"));
});

test("trade C marks: the entry flag anchors on the 14:13 bar, approximate, and the note says so in CT", () => {
  const derived = deriveTrade(openLongEntry("20:14", 7263));
  const facts = observeTrade(derived, tradeC());
  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes: tradeC().map((bar) => bar.time) });
  const entryFlag = marks.find((mark): mark is FlagMark => mark.kind === "flag" && mark.shape === "arrow_up");
  assert.ok(entryFlag);
  assert.equal(entryFlag.t, at("20:13"));
  assert.equal(entryFlag.approximate, true);
  assert.ok(!marks.some((mark) => mark.kind === "flag" && mark.finding?.code === "fill_time_shifted"));
  assert.ok(!marks.some((mark) => mark.kind === "flag" && mark.finding?.code === "fill_outside_bar"));

  const notes = collectDataNotes({
    noCandles: false, base: "1m", misaligned: false, ticker: "MES=F", coverage: "complete",
    chronologyUnresolved: false, findings: facts.findings, symbol: SYMBOL, zone: "America/Chicago",
  });
  const shifted = notes.filter((note) => note.id.startsWith("fill_time_shifted"));
  assert.equal(shifted.length, 1);
  assert.equal(shifted[0].text, "Entry drawn on the 14:13 bar; you logged 14:14.");
  assert.equal(shifted[0].tone, "quiet");
  assert.deepEqual(shifted[0].action, {
    kind: "use_matched_fill", role: "entry", matchedBarTime: at("20:13"), label: "Use 14:13",
  });
});

test("matching never changes the stored entry time or the logged fill", () => {
  const derived = deriveTrade(openLongEntry("20:14", 7263));
  const storedEntry = derived.entry_time;
  const storedFill = JSON.stringify(derived.position_timeline);
  observeTrade(derived, tradeC());
  assert.equal(derived.entry_time, iso("20:14"));
  assert.equal(storedEntry, iso("20:14"));
  assert.equal(JSON.stringify(derived.position_timeline), storedFill);
});

test("an open trade never shifts a fill onto the newest potentially forming bar", () => {
  const derived = deriveTrade(openLongEntry("15:34", 7600));
  const forming = bars([["15:34", 7597, 7598], ["15:35", 7599, 7601]]);
  assert.deepEqual(observeTrade(derived, forming).findings, [{
    code: "fill_outside_bar", barTime: at("15:34"), price: 7600, basis: "inferred", segment: 1,
  }]);

  const completed = [...forming, ...bars([["15:36", 7600, 7602]])];
  assert.deepEqual(observeTrade(derived, completed).findings, [{
    code: "fill_time_shifted", barTime: at("15:35"), price: 7600, basis: "inferred", segment: 1,
    statedBarTime: at("15:34"), offsetMin: 1, role: "entry",
  }]);
});

test("tie at -2 and +2 minutes: an entry takes the earlier bar, an exit takes the later one", () => {
  const candles = bars([
    ["09:58", 7305, 7310], ["10:00", 7300, 7301], ["10:02", 7304, 7305.5],
  ]);
  assert.deepEqual(matchFill(candles, iso("10:00"), 7305, SYMBOL, { role: "entry" }), {
    kind: "shifted", barTime: at("09:58"), statedBarTime: at("10:00"), offsetMin: -2,
  });
  assert.deepEqual(matchFill(candles, iso("10:00"), 7305, SYMBOL, { role: "exit" }), {
    kind: "shifted", barTime: at("10:02"), statedBarTime: at("10:00"), offsetMin: 2,
  });
});

test("a price within 4 ticks of the stated bar, found in no bar within 5 minutes, stays stated", () => {
  const candles = bars([["10:00", 7300, 7301], ["10:03", 7320, 7330]]);
  // 7301.75 is 3 ticks above the 10:00 high (0.25 tick): inside the existing 4-tick tolerance.
  assert.deepEqual(matchFill(candles, iso("10:00"), 7301.75, SYMBOL), { kind: "stated", barTime: at("10:00") });
});

test("a price outside every bar within 5 minutes and beyond 4 ticks is outside, and fill_outside_bar still fires", () => {
  const candles = bars([["10:00", 7300, 7301], ["10:01", 7300, 7301]]);
  assert.deepEqual(matchFill(candles, iso("10:00"), 7320, SYMBOL), { kind: "outside", barTime: at("10:00") });

  const derived = deriveTrade(openLongEntry("10:00", 7320));
  const facts = observeTrade(derived, candles);
  assert.deepEqual(facts.findings, [{
    code: "fill_outside_bar", barTime: at("10:00"), price: 7320, basis: "inferred", segment: 1,
  }]);
});

test("a missing stated bar is aligned first, then an unmatched fill is judged against that nearby base bar", () => {
  // 10:00 has no bar. OD-28 aligns to 10:03 before the exact-window and four-tick checks run.
  const candles = bars([["10:03", 7320, 7330], ["10:04", 7320, 7330]]);
  const facts = observeTrade(deriveTrade(openLongEntry("10:00", 7300)), candles);
  assert.deepEqual(facts.findings, [{
    code: "fill_outside_bar", barTime: at("10:03"), price: 7300, basis: "inferred", segment: 1,
  }]);
});

test("an entry shifted past the exit's stated bar is constrained, so entry never sits after exit", () => {
  // 7263 would shift the entry to 14:13 CT, but the exit is stated at 14:12 CT. The entry must not land after it.
  const candles = bars([["20:12", 7288, 7291], ["20:13", 7261, 7265.5], ["20:14", 7256, 7260]]);
  const result = matchTradeFills(candles, iso("20:14"), 7263, iso("20:12"), 7290, SYMBOL);
  assert.equal(result.exit?.kind, "stated");
  assert.equal(result.exit?.barTime, at("20:12"));
  assert.deepEqual(result.entry, { kind: "outside", barTime: at("20:14") });
});

test("a shifted entry before a later stated exit keeps both matches", () => {
  const candles = bars([["20:13", 7261, 7265.5], ["20:14", 7256, 7260], ["20:15", 7288, 7291]]);
  const result = matchTradeFills(candles, iso("20:14"), 7263, iso("20:15"), 7290, SYMBOL);
  assert.equal(result.entry.kind, "shifted");
  assert.equal(result.entry.barTime, at("20:13"));
  assert.deepEqual(result.exit, { kind: "stated", barTime: at("20:15") });
});

test("no bars, or a time with no bar in tolerance, is no-bars: today's behaviour, no finding", () => {
  assert.deepEqual(matchFill([], iso("10:00"), 7300, SYMBOL), { kind: "no-bars" });
  assert.deepEqual(matchFill(bars([["10:00", 7300, 7301]]), "not a time", 7300, SYMBOL), { kind: "no-bars" });
  assert.deepEqual(matchFill(bars([["10:00", 7300, 7301]]), iso("12:00"), 7300, SYMBOL), { kind: "no-bars" });
  assert.deepEqual(matchFill(bars([["10:00", 7300, 7301]]), iso("10:00"), Number.NaN, SYMBOL), { kind: "no-bars" });
  const facts = observeTrade(deriveTrade(openLongEntry("10:00", 7320)), []);
  assert.deepEqual(facts.findings, []);
});

test("5m charts: the window is one bar each side, and the 1m match is bucketed onto the 5m bar", () => {
  const fiveMinute = bars([["14:10", 7261, 7265.5], ["14:15", 7256, 7260]]);
  // The entry is logged in the 14:15 5m bar but prints in the 14:10 bar, one bar back.
  assert.deepEqual(matchFill(fiveMinute, iso("14:16"), 7263, SYMBOL, { barMinutes: 5 }), {
    kind: "shifted", barTime: at("14:10"), statedBarTime: at("14:15"), offsetMin: -5,
  });

  // A 1m match at 14:13 lands in the 14:10 5m bucket and draws approximate there.
  const derived = deriveTrade(openLongEntry("14:14", 7263));
  const facts = observeTrade(derived, bars([["14:13", 7261, 7265.5], ["14:14", 7256, 7260], ["14:15", 7255, 7262]]));
  const fiveMinuteFacts = { ...facts, fillMatches: new Map([[1, { barTime: at("14:13"), shifted: true }]]) };
  const marks = buildMarks(derived, fiveMinuteFacts, "5m", "medium", false, { candleTimes: fiveMinute.map((bar) => bar.time) });
  const entryFlag = marks.find((mark): mark is FlagMark => mark.kind === "flag" && mark.shape === "arrow_up");
  assert.equal(entryFlag?.t, at("14:10"));
  assert.equal(entryFlag?.approximate, true);
});
