import assert from "node:assert/strict";
import { test } from "node:test";
import { isRegularTradingBarInterval } from "../session.ts";
import { validateTradeAgainstBars } from "../trade-bar-validation.ts";
import { excursions, expectedInsideBarTimes, isClosed, normalizeTrade } from "../trades.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;

function bar(time: number, high = 101, low = 99): Candle {
  return { time, open: 100, high, low, close: 100, volume: 1 };
}

function trade(entry: number, exit: number, symbol = "MES") {
  const record = normalizeTrade({
    id: "session-coverage",
    symbol,
    direction: "LONG",
    entry_time: new Date(entry).toISOString(),
    exit_time: new Date(exit).toISOString(),
    entry_price: 100,
    exit_price: 100.25,
  });
  assert.ok(isClosed(record));
  return record;
}

test("weekday intra-session expected bars and excursions are unchanged", () => {
  const start = Date.parse("2026-11-10T15:00:00Z"); // Tuesday 10:00 EST
  const entry = start + 30_000;
  const exit = start + 4 * minute + 20_000;
  const expected = [start + minute, start + 2 * minute, start + 3 * minute];

  assert.deepEqual(expectedInsideBarTimes(entry, exit, minute), expected);
  assert.deepEqual(expectedInsideBarTimes(entry, exit, minute, "MES"), expected);
  assert.deepEqual(expectedInsideBarTimes(entry, exit, minute, "MNQ"), expected);

  const candles = [bar(start), ...expected.map((time) => bar(time)), bar(start + 4 * minute)];
  const held = trade(entry, exit);
  assert.equal(validateTradeAgainstBars(held, candles).coverage, "complete");
  assert.equal(excursions(held, candles)?.coverage, "complete");
});

test("regular MES hours follow New York across both DST offsets", () => {
  // March 8 is EDT (UTC-4): Sunday regular trading opens at 22:00Z.
  assert.equal(isRegularTradingBarInterval("MES", Date.parse("2026-03-08T21:59:00Z"), minute), false);
  assert.equal(isRegularTradingBarInterval("MES", Date.parse("2026-03-08T22:00:00Z"), minute), true);
  // November 1 is EST (UTC-5): the same 18:00 ET open is 23:00Z.
  assert.equal(isRegularTradingBarInterval("MES", Date.parse("2026-11-01T22:59:00Z"), minute), false);
  assert.equal(isRegularTradingBarInterval("MES", Date.parse("2026-11-01T23:00:00Z"), minute), true);
});

test("a Friday-to-Sunday hold does not expect weekend bars", () => {
  const entryBar = Date.parse("2026-11-13T21:58:00Z"); // Friday 16:58 EST
  const sundayOpen = Date.parse("2026-11-15T23:00:00Z"); // Sunday 18:00 EST, Monday session
  const exitBar = sundayOpen + 3 * minute;
  const held = trade(entryBar + 30_000, exitBar + 20_000);
  const expected = [entryBar + minute, sundayOpen, sundayOpen + minute, sundayOpen + 2 * minute];

  assert.deepEqual(
    expectedInsideBarTimes(Date.parse(held.entry_time), Date.parse(held.exit_time), minute, held.symbol),
    expected,
  );
  assert.equal(isRegularTradingBarInterval("MES", Date.parse("2026-11-14T15:00:00Z"), minute), false);

  const candles = [bar(entryBar), ...expected.map((time) => bar(time)), bar(exitBar)];
  assert.equal(validateTradeAgainstBars(held, candles).coverage, "complete");
  assert.equal(excursions(held, candles)?.coverage, "complete");

  const missingTradingBar = candles.filter((candle) => candle.time !== sundayOpen + minute);
  assert.equal(validateTradeAgainstBars(held, missingTradingBar).coverage, "partial");
  assert.equal(excursions(held, missingTradingBar)?.coverage, "partial");
});

test("a hold across the daily maintenance halt does not expect halt bars", () => {
  const entryBar = Date.parse("2026-11-10T21:58:00Z"); // Tuesday 16:58 EST
  const reopen = Date.parse("2026-11-10T23:00:00Z"); // Tuesday 18:00 EST
  const exitBar = reopen + 3 * minute;
  const held = trade(entryBar + 30_000, exitBar + 20_000, "MNQ");
  const expected = [entryBar + minute, reopen, reopen + minute, reopen + 2 * minute];

  assert.deepEqual(
    expectedInsideBarTimes(Date.parse(held.entry_time), Date.parse(held.exit_time), minute, held.symbol),
    expected,
  );
  assert.equal(isRegularTradingBarInterval("MNQ", Date.parse("2026-11-10T22:00:00Z"), minute), false);
  assert.equal(isRegularTradingBarInterval("MNQ", Date.parse("2026-11-10T22:59:00Z"), minute), false);
  assert.equal(isRegularTradingBarInterval("MNQ", reopen, minute), true);

  const candles = [bar(entryBar), ...expected.map((time) => bar(time)), bar(exitBar)];
  assert.equal(validateTradeAgainstBars(held, candles).coverage, "complete");
  assert.equal(excursions(held, candles)?.coverage, "complete");
});

test("a same-bar hold remains complete when its one session bar is present", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const held = trade(start + 10_000, start + 30_000);
  const validation = validateTradeAgainstBars(held, [bar(start)]);

  assert.equal(validation.coverage, "complete");
  assert.equal(validation.chronology, "unresolved");
  assert.equal(excursions(held, [bar(start)]), null);
});
