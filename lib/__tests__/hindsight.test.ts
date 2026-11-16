// Issue #37: after-the-exit later touches and the held-to-plan hindsight fact. Never changes R.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildHindsight, hindsightCollapsedText, hindsightExpandedText, laterTouch, laterTouchLabel } from "../hindsight.ts";
import { rMultiple, tradePnl } from "../trades.ts";
import type { Candle, TradeRecord } from "../trades.ts";

const minute = 60_000;
// A Tuesday afternoon in ET so the session close is the same calendar day 17:00 ET.
const exit = Date.parse("2026-11-10T20:00:00.000Z"); // 14:00 ET

function bar(time: number, low: number, high: number): Candle {
  return { time, open: (low + high) / 2, high, low, close: (low + high) / 2, volume: 1 };
}

function after(offsets: Array<[number, number, number]>): Candle[] {
  return offsets.map(([minutes, low, high]) => bar(exit + minutes * minute, low, high));
}

const trade = {
  direction: "LONG" as const,
  exit_time: "2026-11-10T20:00:00.000Z",
  stop_loss_price: 5990,
  planned_target_price: 6010,
};

test("later touch: target reached first, 38 minutes after the exit", () => {
  const candles = after([
    [5, 5998, 6004],
    [38, 6008, 6012],
    [50, 5988, 6000],
  ]);
  const fact = buildHindsight(trade, candles);
  assert.equal(fact.hindsight, true);
  assert.equal(fact.outcome, "target_first");
  assert.equal(fact.first?.kind, "target");
  assert.equal(fact.first?.delayMs, 38 * minute);
  assert.match(fact.sentence, /Hindsight: the target would have been reached first, 38 min later/);
  assert.equal(laterTouchLabel(fact.target!), "TP +38m");
});

test("later touch: stop reached first, 12 minutes after the exit", () => {
  const candles = after([
    [12, 5988, 5995],
    [40, 6009, 6015],
  ]);
  const fact = buildHindsight(trade, candles);
  assert.equal(fact.outcome, "stop_first");
  assert.equal(fact.first?.kind, "stop");
  assert.equal(laterTouchLabel(fact.stop!), "SL +12m");
  assert.match(fact.sentence, /stop would have been reached first, 12 min later/);
});

test("later touch: neither by the session close", () => {
  // Bars run through 17:00 ET (22:00 UTC on 10 Nov 2026).
  const candles = [
    bar(exit + 10 * minute, 5996, 6004),
    bar(Date.parse("2026-11-10T22:00:00.000Z") - minute, 5997, 6003),
  ];
  const fact = buildHindsight(trade, candles);
  assert.equal(fact.outcome, "neither");
  assert.equal(fact.incomplete, false);
  assert.match(fact.sentence, /neither the target nor the stop was reached by the session close/);
});

test("a coarse final bar covers through the session close", () => {
  const candles = [bar(Date.parse("2026-11-10T21:55:00.000Z"), 5997, 6003)];
  const fact = buildHindsight(trade, candles, "5m");
  assert.equal(fact.incomplete, false);
});

test("later touch: neither in the bars on hand when the session close is not covered", () => {
  const candles = after([[5, 5996, 6004]]);
  const fact = buildHindsight(trade, candles);
  assert.equal(fact.outcome, "neither");
  assert.equal(fact.incomplete, true);
  assert.match(fact.sentence, /neither the target nor the stop was reached in the bars on hand/);
});

test("a short reaches the target on a later low and the stop on a later high", () => {
  const short = { direction: "SHORT" as const, exit_time: trade.exit_time, stop_loss_price: 6010, planned_target_price: 5990 };
  const targetFirst = buildHindsight(short, after([[20, 5988, 5996]]));
  assert.equal(targetFirst.outcome, "target_first");
  const stopFirst = buildHindsight(short, after([[8, 6008, 6012]]));
  assert.equal(stopFirst.outcome, "stop_first");
});

test("the same later bar reaching both does not claim a first fill", () => {
  const fact = buildHindsight(trade, after([[15, 5988, 6012]]));
  assert.equal(fact.outcome, "same_bar");
  assert.match(fact.sentence, /both reached in the same later bar/);
});

test("a bar at or before the exit is not a later touch", () => {
  const candles = [bar(exit, 5988, 6012), bar(exit - minute, 5988, 6012)];
  assert.equal(laterTouch(candles, exit, 6010, "target", "LONG"), null);
  assert.equal(buildHindsight(trade, candles).outcome, "neither");
});

test("hindsight never changes R or P&L", () => {
  const record = {
    id: "h",
    symbol: "MES",
    direction: "LONG" as const,
    entry_time: "2026-11-10T19:50:00.000Z",
    exit_time: trade.exit_time,
    entry_price: 6000,
    exit_price: 6002,
    stop_loss_price: 5990,
    planned_target_price: 6010,
    quantity: 1,
  } satisfies Partial<TradeRecord> as TradeRecord;
  const before = { r: rMultiple(record), pnl: tradePnl(record) };
  buildHindsight(record, after([[38, 6008, 6012]]));
  assert.equal(rMultiple(record), before.r);
  assert.equal(tradePnl(record), before.pnl);
  assert.equal(before.r, 0.2);
});

test("low detail: collapsed copy is the one-line sentence, medium keeps the one-tap helper", () => {
  const fact = buildHindsight(trade, after([[38, 6008, 6012]]));
  assert.equal(hindsightCollapsedText(fact, "low"), fact.sentence);
  assert.equal(hindsightCollapsedText(fact, "medium"), "Hindsight is one tap away and never changes R or the grade of the decision.");
});

test("expanded text is sentence plus later-touch labels, identical at both detail levels", () => {
  const fact = buildHindsight(trade, after([[5, 5998, 6004], [38, 6008, 6012], [50, 5988, 6000]]));
  assert.equal(hindsightExpandedText(fact), `${fact.sentence} TP +38m. SL +50m.`);
  const none = buildHindsight({ ...trade, stop_loss_price: null, planned_target_price: null }, []);
  assert.equal(hindsightExpandedText(none), none.sentence);
});
