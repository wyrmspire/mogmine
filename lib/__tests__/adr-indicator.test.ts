import assert from "node:assert/strict";
import test from "node:test";
import { adrRequiredSessionDates, buildAdrIndicator } from "../adr-indicator.ts";
import { createIndicatorInstance } from "../indicator-kit.ts";
import { equityIndexSessionBounds, previousRegularSessionDate } from "../session.ts";
import type { Candle } from "../trades.ts";

const minute = 60_000;
function day(sessionDate: string, range: number, open = 6000) {
  const bounds = equityIndexSessionBounds(sessionDate);
  const candles: Candle[] = Array.from({ length: (bounds.close - bounds.open) / minute }, (_, index) => ({
    time: bounds.open + index * minute, open, high: open, low: open, close: open, volume: 1,
  }));
  candles[1] = { ...candles[1], high: open + range / 2 };
  candles[2] = { ...candles[2], low: open - range / 2 };
  return { sessionDate, candles, timeframe: "1m" as const };
}
const datesBack = (date: string, count: number) => Array.from({ length: count }, (_, index) => {
  if (index > 0) date = previousRegularSessionDate(date);
  return date;
});

test("ADR instances calculate independent 7 and 14-session bands", () => {
  const current = "2026-11-12";
  const dates = datesBack(current, 16);
  const days = dates.map((date, index) => day(date, index === 0 ? 20 : 100 + index));
  const adr7 = createIndicatorInstance("adr", "adr-7");
  adr7.params.length = 7;
  const adr14 = createIndicatorInstance("adr", "adr-14");
  const seven = buildAdrIndicator(adr7, "MES", current, days);
  const fourteen = buildAdrIndicator(adr14, "MES", current, days);
  const high7 = seven.lines.find(({ names }) => names === "ADR High 7")!;
  const high14 = fourteen.lines.find(({ names }) => names === "ADR High 14")!;
  assert.equal(high7.price, 6052);
  assert.equal(high14.price, 6053.75);
  assert.notEqual(high7.price, high14.price);
});

test("ADR days back use one bounded span per session and band fill rectangles", () => {
  const current = "2026-11-02";
  const dates = datesBack(current, 10);
  const instance = createIndicatorInstance("adr", "adr-days");
  instance.params.length = 5;
  instance.params.daysBack = 3;
  instance.params.midLine = true;
  const result = buildAdrIndicator(instance, "MES", current, dates.map((date) => day(date, 100)));
  assert.equal(result.unavailableDates.length, 0);
  assert.equal(result.lines.length, 15);
  assert.equal(result.zones.length, 6);
  assert.equal(new Set(result.lines.map(({ startAt, endAt }) => `${startAt}:${endAt}`)).size, 3);
  assert.ok(result.lines.every(({ startAt, endAt }) => startAt != null && endAt != null && endAt - startAt === 23 * 60 * minute));
});

test("ADR loader requests enough completed history for the longest visible instance", () => {
  const seven = createIndicatorInstance("adr", "seven");
  seven.params.length = 7;
  seven.params.daysBack = 3;
  const fourteen = createIndicatorInstance("adr", "fourteen");
  fourteen.params.daysBack = 2;
  const dates = adrRequiredSessionDates("2026-11-12", [seven, fourteen]);
  assert.equal(dates.length, 16);
  assert.equal(dates[0], "2026-11-12");
  assert.equal(dates.at(-1), datesBack("2026-11-12", 16).at(-1));
});
