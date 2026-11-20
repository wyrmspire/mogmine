// docs/20 §2.2, OD-41 (5): find the entry and exit bars from the typed prices.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dayCandlesUsable, loadDayCandles } from "../candles.ts";
import { dayWindow, suggestionPatch } from "../entry-form.ts";
import { finderMessage } from "../infer-message.ts";
import { barTrades, inferTradeTimes, isRegularHours } from "../infer-times.ts";
import type { Candle } from "../trades.ts";

// 2026-11-19 (Thu), 1m bars from 09:30 ET = 14:30Z = 08:30 CST.
const T0 = Date.parse("2026-11-19T14:30:00.000Z");
const MIN = 60_000;
/** Bars from [low, high] pairs, one minute apart from `start`. */
const bars = (ranges: Array<[number, number]>, start = T0): Candle[] =>
  ranges.map(([low, high], i) => ({ time: start + i * MIN, open: low, high, low, close: high, volume: 1 }));
const base = { timeframe: "1m" as const, symbol: "MES", direction: "LONG" as const };

test("single touch: exact entry, exit is the first later bar that trades the exit", () => {
  const candles = bars([[6800, 6802], [6803, 6806], [6806, 6809], [6808, 6812], [6812, 6815]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6804.25, exitPrice: 6810 });
  assert.equal(result.confidence, "exact");
  assert.equal(result.reason, "only-touch");
  assert.equal(result.entryTime, T0 + MIN);
  assert.equal(result.exitTime, T0 + 3 * MIN);
  assert.equal(result.exitStatus, "matched");
  assert.equal(result.entryCandidates, 1);
  assert.equal(result.approximate, false);
  assert.equal(result.hitFirst, null);
});

test("a run of consecutive touching bars counts once, at its first bar", () => {
  const candles = bars([[6800, 6802], [6801, 6803], [6801, 6803], [6805, 6807]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6801.5, exitPrice: 6806 });
  assert.equal(result.entryCandidates, 1);
  assert.equal(result.entryTime, T0);
  assert.equal(result.confidence, "exact");
});

test("multiple touches + hint: picks the touch nearest the hint, and is ambiguous", () => {
  const candles = bars([[6800, 6802], [6805, 6808], [6800, 6802], [6805, 6808], [6800, 6802], [6805, 6808]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6801, exitPrice: null, hint: T0 + 4 * MIN + 10_000 });
  assert.equal(result.confidence, "ambiguous");
  assert.equal(result.reason, "nearest-hint");
  assert.equal(result.entryCandidates, 3);
  assert.deepEqual(result.candidateTimes, [T0, T0 + 2 * MIN, T0 + 4 * MIN]);
  assert.equal(result.entryTime, T0 + 4 * MIN);
  assert.equal(result.exitStatus, "open");
});

test("multiple touches, no hint: the first touch in regular hours wins over an overnight one", () => {
  const overnight = bars([[6800, 6802]], Date.parse("2026-11-19T08:00:00.000Z")); // 03:00 ET
  const rth = bars([[6805, 6808], [6800, 6802], [6805, 6808]]);
  const result = inferTradeTimes({ ...base, candles: [...overnight, ...rth], entryPrice: 6801 });
  assert.equal(result.reason, "first-rth");
  assert.equal(result.entryTime, T0 + MIN);
  assert.equal(result.entryCandidates, 2);
});

test("multiple touches: the only one with the exit after it is preferred over the hint", () => {
  // Touch at 0 and 2; the exit 6810 trades only after bar 2.
  const candles = bars([[6800, 6802], [6795, 6799], [6800, 6802], [6809, 6811]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6801, exitPrice: 6810, hint: T0 });
  // Both touches see 6810 later (bar 3), so both are consistent: the hint decides.
  assert.equal(result.entryTime, T0);
  const withStop = inferTradeTimes({ ...base, candles, entryPrice: 6801, exitPrice: 6810, stopPrice: 6796, hint: T0 });
  // From bar 0 the stop (6796) trades at bar 1 before the exit; from bar 2 it does not.
  assert.equal(withStop.reason, "only-consistent");
  assert.equal(withStop.entryTime, T0 + 2 * MIN);
  assert.equal(withStop.hitFirst, null);
});

test("no touch: confidence none, no times", () => {
  const candles = bars([[6800, 6802], [6803, 6805]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6850, exitPrice: 6855 });
  assert.equal(result.confidence, "none");
  assert.equal(result.reason, "no-touch");
  assert.equal(result.entryTime, null);
  assert.equal(result.exitTime, null);
  assert.equal(result.entryCandidates, 0);
  assert.equal(inferTradeTimes({ ...base, candles: [], entryPrice: 6800 }).confidence, "none");
});

test("exit only before the entry: the exit is not after entry, and the result is ambiguous", () => {
  const candles = bars([[6809, 6811], [6804, 6806], [6800, 6802]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6801, exitPrice: 6810 });
  assert.equal(result.entryTime, T0 + 2 * MIN);
  assert.equal(result.exitTime, null);
  assert.equal(result.exitStatus, "not-after-entry");
  assert.equal(result.confidence, "ambiguous");
  assert.equal(result.exitMayBeInEntryBar, false);
});

test("exit inside the entry bar only: flagged as maybe the same bar", () => {
  const candles = bars([[6798, 6806], [6790, 6795]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6800, exitPrice: 6805 });
  assert.equal(result.exitStatus, "not-after-entry");
  assert.equal(result.exitMayBeInEntryBar, true);
});

test("stop hit before the exit: flagged (long)", () => {
  const candles = bars([[6800, 6802], [6795, 6799], [6802.5, 6806], [6809, 6811]]);
  const result = inferTradeTimes({ ...base, candles, entryPrice: 6801, exitPrice: 6810, stopPrice: 6796 });
  // The only entry touch has the stop before the exit: still the pick, with the flag.
  assert.equal(result.confidence, "exact");
  assert.equal(result.entryTime, T0);
  assert.equal(result.exitTime, T0 + 3 * MIN);
  assert.deepEqual(result.hitFirst, { time: T0 + MIN, kind: "stop" });
  // A stop equal to the exit is a stop-out, not a stop "before" the exit.
  const stopped = inferTradeTimes({ ...base, candles, entryPrice: 6801, exitPrice: 6796, stopPrice: 6796 });
  assert.equal(stopped.exitTime, T0 + MIN);
  assert.equal(stopped.hitFirst, null);
});

test("short: target traded before the exit is flagged; times follow the bars", () => {
  const candles = bars([[6810, 6812], [6800, 6805], [6806, 6809], [6814, 6816]]);
  const result = inferTradeTimes({ ...base, direction: "SHORT", candles, entryPrice: 6811, exitPrice: 6815, stopPrice: 6815, targetPrice: 6801 });
  assert.equal(result.entryTime, T0);
  assert.equal(result.exitTime, T0 + 3 * MIN);
  assert.deepEqual(result.hitFirst, { time: T0 + MIN, kind: "target" });
  assert.equal(result.confidence, "exact");
});

test("coarser bars are approximate (OD-28 style)", () => {
  const candles = bars([[6800, 6802]]);
  assert.equal(inferTradeTimes({ ...base, timeframe: "5m", candles, entryPrice: 6801 }).approximate, true);
});

test("helpers: regular hours and bar touch", () => {
  assert.equal(isRegularHours(T0), true); // 09:30 ET
  assert.equal(isRegularHours(T0 - MIN), false); // 09:29 ET
  assert.equal(isRegularHours(Date.parse("2026-11-21T15:00:00.000Z")), false); // Saturday
  assert.equal(barTrades({ low: 6800, high: 6802 }, 6802, 0.00025), true);
  assert.equal(barTrades({ low: 6800, high: 6802 }, 6802.25, 0.00025), false);
});

test("dayWindow: midnight to midnight in the display zone", () => {
  assert.deepEqual(dayWindow("2026-11-19", "America/Chicago"), { from: Date.parse("2026-11-19T06:00:00.000Z"), to: Date.parse("2026-11-20T06:00:00.000Z") });
  assert.equal(dayWindow("", "America/Chicago"), null);
});

test("suggestionPatch never overwrites a hand-set time unless the trader taps Use", () => {
  const draft = { status: "closed" as const, entryEdited: false, exitEdited: true, entryClock: "08:00", exitClock: "08:30" };
  const suggestion = { entryTime: T0 + 12 * MIN, exitTime: T0 + 35 * MIN };
  assert.deepEqual(suggestionPatch(draft, suggestion, "America/Chicago"), { entryClock: "08:42" });
  assert.deepEqual(suggestionPatch(draft, suggestion, "America/Chicago", true), { entryClock: "08:42", entryEdited: false, exitClock: "09:05", exitEdited: false });
  assert.deepEqual(suggestionPatch({ ...draft, status: "open", exitEdited: false }, suggestion, "America/Chicago"), { entryClock: "08:42" });
});

test("finderMessage: exact, ambiguous, none, stop first", () => {
  const zone = "America/Chicago";
  const input = { symbol: "MES", entryPrice: 6801, exitPrice: 6810, dateLabel: "Nov 19" };
  const exact = inferTradeTimes({ ...base, candles: bars([[6800, 6802], [6809, 6811]]), entryPrice: 6801, exitPrice: 6810 });
  assert.equal(finderMessage(exact, input, zone), "Matched 08:30 entry, 08:31 exit CST from 1m bars.");
  const many = inferTradeTimes({ ...base, candles: bars([[6800, 6802], [6805, 6806], [6800, 6802], [6809, 6811]]), entryPrice: 6801, exitPrice: 6810 });
  assert.match(finderMessage(many, input, zone), /^Entry price traded 2 times\. Picked 08:30 CST \(first in regular hours\), from 1m bars\. Tap to change\. Exit 08:33\.$/);
  const none = inferTradeTimes({ ...base, candles: bars([[6800, 6802]]), entryPrice: 6850 });
  assert.equal(finderMessage(none, { ...input, entryPrice: 6850 }, zone), "6850.00 did not trade in any 1m bar on Nov 19. Set the times yourself.");
  const stopFirst = inferTradeTimes({ ...base, candles: bars([[6800, 6802], [6795, 6799], [6809, 6811]]), entryPrice: 6801, exitPrice: 6810, stopPrice: 6796 });
  assert.match(finderMessage(stopFirst, input, zone), /Your stop traded at 08:31, before this exit\.$/);
});

test("day bars: a finished window is final; a fresh one is asked again after a minute", () => {
  const end = Date.parse("2026-11-20T06:00:00.000Z");
  const candles = bars([[1, 2]]);
  assert.equal(dayCandlesUsable(undefined, end, end), false);
  assert.equal(dayCandlesUsable({ candles, baseTimeframe: "1m", fetchedAt: end + 61 * MIN }, end, end + 999 * MIN), true);
  assert.equal(dayCandlesUsable({ candles, baseTimeframe: "1m", fetchedAt: end - 10 * MIN }, end, end - 10 * MIN + 30_000), true);
  assert.equal(dayCandlesUsable({ candles, baseTimeframe: "1m", fetchedAt: end - 10 * MIN }, end, end - 8 * MIN), false);
  assert.equal(dayCandlesUsable({ candles: [], baseTimeframe: "1m", fetchedAt: end + 999 * MIN }, end, end), false);
});

test("day bars: network failure falls back to a stale cache, else throws", async () => {
  const stale = { candles: bars([[1, 2]]), baseTimeframe: "1m" as const, fetchedAt: 0 };
  const deps = (cached: typeof stale | undefined) => ({
    read: async () => cached, write: async () => undefined,
    request: async () => { throw new Error("offline"); }, now: () => 10 * MIN,
  });
  assert.equal(await loadDayCandles("MES", 0, 5 * MIN, deps(stale)), stale);
  await assert.rejects(loadDayCandles("MES", 0, 5 * MIN, deps(undefined)));
  let written = 0;
  const fresh = await loadDayCandles("MES", 0, 5 * MIN, { read: async () => undefined, write: async () => { written += 1; }, request: async () => ({ candles: bars([[1, 2], [2, 3]]), baseTimeframe: "1m" }), now: () => 10 * MIN });
  assert.equal(fresh.candles.length, 2);
  assert.equal(written, 1);
});
