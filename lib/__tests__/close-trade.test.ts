// R-03b (docs/16): closing an open trade. OD-38: the result exists only after the close.
import assert from "node:assert/strict";
import { test } from "node:test";
import { closeTradePatch, isClosed, normalizeTrade, tradePnl, validateClose } from "../trades.ts";

const entryTime = "2026-11-10T15:00:00.000Z";
const open = normalizeTrade({
  id: "open-1",
  status: "open",
  symbol: "MES",
  direction: "LONG",
  entry_time: entryTime,
  exit_time: null,
  entry_price: 6000,
  exit_price: null,
  quantity: 2,
});

test("R-03b: a valid exit after the entry has no errors", () => {
  assert.deepEqual(validateClose(open, new Date("2026-11-10T15:05:00.000Z"), 6004.25), {});
});

test("R-03b: an empty, zero or off-tick exit price is an error", () => {
  const exit = new Date("2026-11-10T15:05:00.000Z");
  assert.equal(validateClose(open, exit, null).exit_price, "Enter the exit price");
  assert.equal(validateClose(open, exit, 0).exit_price, "Enter the exit price");
  assert.match(validateClose(open, exit, 6004.1).exit_price ?? "", /tick/);
});

test("R-03b: an exit at or before the entry, or an invalid time, is an error", () => {
  assert.equal(validateClose(open, new Date(entryTime), 6004).exit_time, "The exit must be after the entry");
  assert.equal(validateClose(open, new Date("2026-11-10T14:59:00.000Z"), 6004).exit_time, "The exit must be after the entry");
  assert.equal(validateClose(open, new Date(Number.NaN), 6004).exit_time, "Enter the exit time");
});

test("R-03b: closing sets status, both exits and the style; the result then exists", () => {
  assert.equal(tradePnl(open), null);
  const patch = closeTradePatch(open, "2026-11-10T15:05:00.000Z", 6004);
  assert.deepEqual(patch, { status: "closed", exit_time: "2026-11-10T15:05:00.000Z", exit_price: 6004, trade_style: "scalp" });
  const closed = normalizeTrade({ ...open, ...patch });
  assert.equal(isClosed(closed), true);
  assert.equal(tradePnl(closed), 40);
  assert.equal(closeTradePatch(open, "2026-11-10T18:00:00.000Z", 6004).trade_style, "investment");
});
