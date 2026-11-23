import assert from "node:assert/strict";
import { test } from "node:test";
import { tradeLevelReport, withheldText } from "../chart-levels.ts";
import { levelsStatusText, levelsTitle, withheldReasons } from "../level-withheld.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
const flat = (from: string, to: string, price: number): Candle[] => Array.from(
  { length: (Date.parse(to) - Date.parse(from)) / minute },
  (_, i) => ({ time: Date.parse(from) + i * minute, open: price, high: price, low: price, close: price, volume: 1 }),
);
const without = (bars: Candle[], ...isoTimes: string[]) => bars.filter((bar) => !isoTimes.map(Date.parse).includes(bar.time));

// Thu Nov 19 2026, entry 09:50 CT (15:50Z). Prior session: Wed Nov 18 (Tue 23:00Z → Wed 22:00Z, EST).
const trade = { symbol: "MES", entry_time: "2026-11-19T15:50:00Z" };
const priorBars = [
  ...flat("2026-11-17T23:00:00Z", "2026-11-18T14:30:00Z", 7380),
  ...flat("2026-11-18T14:30:00Z", "2026-11-18T21:00:00Z", 7350),
  ...flat("2026-11-18T21:00:00Z", "2026-11-18T22:00:00Z", 7340),
];
const todayBars = flat("2026-11-18T23:00:00Z", "2026-11-19T15:50:00Z", 7400);

test("the sim Thursday: Yahoo 1m gaps overnight withhold PDH, PDL, ONH, ONL; the week was never loaded", () => {
  // Yahoo leaves overnight minutes out (OD-55): three in the prior session's evening, two this morning.
  const prior = without(priorBars, "2026-11-18T02:13:00Z", "2026-11-18T02:14:00Z", "2026-11-18T07:41:00Z");
  const today = without(todayBars, "2026-11-19T03:02:00Z", "2026-11-19T09:30:00Z");
  const report = tradeLevelReport(trade, { candles: prior, baseTimeframe: "1m" }, { candles: today, baseTimeframe: "1m" })!;
  const drawn = report.levels.map((level) => level.key).sort();
  assert.deepEqual(drawn, ["globex_open", "rth_close", "rth_high", "rth_low", "rth_open"]);
  assert.deepEqual(report.withheld.map((level) => [level.key, level.reason, level.missingBars]), [
    ["pdh", "gaps", 3], ["pdl", "gaps", 3], ["onh", "gaps", 2], ["onl", "gaps", 2],
    ["week_high", "not-loaded", report.withheld[4].missingBars], ["week_low", "not-loaded", report.withheld[5].missingBars],
  ]);
  assert.equal(withheldText(report.withheld),
    "PDH, PDL: Yahoo skipped 3 bars (prior session) · ONH, ONL: Yahoo skipped 2 bars (overnight) · Wk high, Wk low: earlier sessions this week not loaded");
});

test("whole windows still draw every candle level except the unloaded week", () => {
  const report = tradeLevelReport(trade, { candles: priorBars, baseTimeframe: "1m" }, { candles: todayBars, baseTimeframe: "1m" })!;
  assert.deepEqual(report.withheld.map((level) => level.key), ["week_high", "week_low"]);
});

test("a Tuesday trade has the whole week loaded (Monday is the prior session)", () => {
  const tuesday = { symbol: "MES", entry_time: "2026-11-17T15:50:00Z" };
  const prior = flat("2026-11-15T23:00:00Z", "2026-11-16T22:00:00Z", 7380);
  const today = flat("2026-11-16T23:00:00Z", "2026-11-17T15:50:00Z", 7400);
  const report = tradeLevelReport(tuesday, { candles: prior, baseTimeframe: "1m" }, { candles: today, baseTimeframe: "1m" })!;
  assert.deepEqual(report.withheld, []);
});

test("5m day bars cannot give the 3 PM close: it needs the final 1m bar", () => {
  const coverage = { expectedBars: 10, presentBars: 10, complete: true };
  const [close] = withheldReasons(["rth_close"], { previous: coverage, rth: coverage, overnight: coverage, week: [] }, "5m");
  assert.equal(close.reason, "needs-1m");
  assert.equal(withheldText([close]), "3 PM close: needs 1m bars");
});

test("an entry at the Globex open has no overnight yet: not formed, not missing", () => {
  const none = { expectedBars: 0, presentBars: 0, complete: true };
  const full = { expectedBars: 10, presentBars: 10, complete: true };
  const [onh] = withheldReasons(["onh"], { previous: full, rth: full, overnight: none, week: [] }, "1m");
  assert.equal(onh.reason, "not-yet");
});

test("the View row counts withheld levels and its tooltip says which and why", () => {
  const withheld = [{ key: "onh" as const, reason: "gaps" as const, window: "overnight" as const, missingBars: 2 }];
  const state = { status: "ready" as const, lines: new Array(18), withheld, planned: 6, summary: "7400.00 Round" };
  assert.equal(levelsStatusText(state), "18 shown · 1 withheld");
  assert.equal(levelsTitle(state),
    "Prior-day, overnight and planned levels as of the entry. 6 from planning sessions. Withheld, never guessed: ONH: Yahoo skipped 2 bars (overnight). Levels: 7400.00 Round");
  assert.equal(levelsStatusText({ ...state, status: "none", lines: [], withheld: [] }), "Unavailable");
  assert.equal(levelsStatusText({ ...state, status: "loading" }), "Loading…");
});
