// Golden tests for issue #50 (contracts, finite prices, quantity, stop side, ticks) and
// issue #51 (bar alignment). Money fails closed: an invalid trade prices as null, never as a plausible number.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney, formatPoints, formatR } from "../format.ts";
import { alignToBar, alignTradeToBars, canonicalSymbol, initialRiskUsd, isScratch, normalizeTrade, plannedR, rMultiple, snapToBar, snapToTick, specFor, toTicks, tradePnl, tradePoints, tradeTicks, validateTradeInput } from "../trades.ts";

const minute = 60_000;
const base = { id: "v", entry_time: "2026-11-10T15:43:00.000Z", exit_time: "2026-11-10T15:45:00.000Z" };

const noLevels = { planned_target_price: null, key_level_price: null } as const;

test("issue #50: lowercase known symbols canonicalize to one spec", () => {
  assert.equal(canonicalSymbol("mes"), "MES");
  assert.equal(canonicalSymbol(" Mnq "), "MNQ");
  assert.deepEqual(specFor("mes"), specFor("MES"));
  // Was $0.25 under the fallback spec. One tick of MES is 0.25 points at $5 per point.
  const lower = { ...base, symbol: "mes", direction: "LONG" as const, quantity: 1, entry_price: 6000, exit_price: 6000.25 };
  assert.equal(tradePnl(lower), 1.25);
  const saved = normalizeTrade(lower);
  assert.equal(saved.symbol, "MES");
  assert.equal(saved.yahoo_ticker, "MES=F");
});

test("issue #50: an unknown contract has no spec and no money", () => {
  assert.equal(canonicalSymbol("XYZ"), null);
  assert.equal(specFor("XYZ"), null);
  const trade = normalizeTrade({ ...base, symbol: "XYZ", direction: "LONG", quantity: 1, entry_price: 100, exit_price: 101, stop_loss_price: 99 });
  assert.equal(tradePnl(trade), null);
  assert.equal(tradeTicks(trade), null);
  assert.equal(tradePoints(trade), null);
  assert.equal(rMultiple(trade), null);
  assert.equal(formatMoney(tradePnl(trade)), "—");
  assert.equal(formatPoints(tradePoints(trade), "XYZ"), "—");
  assert.equal(snapToTick(100, "XYZ"), null);
  const errors = validateTradeInput({ symbol: "XYZ", direction: "LONG", quantity: 1, entry_price: 100, exit_price: 101, stop_loss_price: null, ...noLevels });
  assert.equal(errors.symbol, "XYZ is not a supported contract");
});

test("issue #50: a stop on the wrong side gives no R, never a positive R from distance", () => {
  // Long entered at 6000 with a stop above it.
  const longWrong = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 1, entry_price: 6000, exit_price: 6002, stop_loss_price: 6001, planned_target_price: 6004 });
  assert.equal(rMultiple(longWrong), null);
  assert.equal(plannedR(longWrong), null);
  assert.equal(initialRiskUsd(longWrong), null);
  // A stop at the entry is zero distance: invalid too.
  assert.equal(rMultiple({ ...longWrong, stop_loss_price: 6000 }), null);
  // The same prices with the stop below the entry are priced: 8 ticks won on 4 ticks of risk.
  assert.equal(formatR(rMultiple({ ...longWrong, stop_loss_price: 5999 })), "+2.0R");

  // Short entered at 6000 with a stop below it.
  const shortWrong = normalizeTrade({ ...base, symbol: "MES", direction: "SHORT", quantity: 1, entry_price: 6000, exit_price: 5998, stop_loss_price: 5999, planned_target_price: 5996 });
  assert.equal(rMultiple(shortWrong), null);
  assert.equal(plannedR(shortWrong), null);
  assert.equal(initialRiskUsd(shortWrong), null);
  assert.equal(formatR(rMultiple({ ...shortWrong, stop_loss_price: 6001 })), "+2.0R");

  assert.equal(validateTradeInput({ symbol: "MES", direction: "LONG", quantity: 1, entry_price: 6000, exit_price: 6002, stop_loss_price: 6001, ...noLevels }).stop_loss_price, "A long's stop sits below the entry");
  assert.equal(validateTradeInput({ symbol: "MES", direction: "SHORT", quantity: 1, entry_price: 6000, exit_price: 5998, stop_loss_price: 5999, ...noLevels }).stop_loss_price, "A short's stop sits above the entry");
});

test("issue #50: nonfinite prices give null, never NaN", () => {
  const nanExit = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 1, entry_price: 6000, exit_price: Number.NaN, stop_loss_price: 5999 });
  assert.equal(tradePnl(nanExit), null);
  assert.equal(tradePoints(nanExit), null);
  assert.equal(rMultiple(nanExit), null);
  const infEntry = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 1, entry_price: Infinity, exit_price: 6001 });
  assert.equal(tradePnl(infEntry), null);
  assert.equal(toTicks(Number.NaN, "MES"), null);
  assert.equal(rMultiple({ ...nanExit, exit_price: 6001, stop_loss_price: Number.NaN }), null);
  const errors = validateTradeInput({ symbol: "MES", direction: "LONG", quantity: 1, entry_price: Number.NaN, exit_price: 6001, stop_loss_price: null, ...noLevels });
  assert.equal(errors.entry_price, "Enter the entry price");
});

test("issue #50: quantity must be a whole number of 1 or more", () => {
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    const trade = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity, entry_price: 6000, exit_price: 6001, stop_loss_price: 5999 });
    assert.equal(tradePnl(trade), null, `pnl for quantity ${quantity}`);
    assert.equal(rMultiple(trade), null, `R for quantity ${quantity}`);
    assert.equal(initialRiskUsd(trade), null, `risk for quantity ${quantity}`);
    const errors = validateTradeInput({ symbol: "MES", direction: "LONG", quantity, entry_price: 6000, exit_price: 6001, stop_loss_price: 5999, ...noLevels });
    assert.ok(errors.quantity, `quantity ${quantity} is rejected`);
  }
  // A stored zero stays visible, not quietly rewritten to 1 contract.
  assert.equal(normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 0, entry_price: 6000, exit_price: 6001 }).quantity, 0);
});

test("issue #50: an off-tick MES price is rejected, never rounded into money", () => {
  const offTick = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 1, entry_price: 6844.3, exit_price: 6849, stop_loss_price: 6841.25 });
  assert.equal(offTick.entry_price, 6844.3, "the imported price is kept exactly");
  assert.equal(toTicks(6844.3, "MES"), null);
  assert.equal(tradePnl(offTick), null);
  assert.equal(rMultiple(offTick), null);
  // Snapping is still available, but only when a caller asks for it.
  assert.equal(snapToTick(6844.3, "MES"), 6844.25);
  const errors = validateTradeInput({ symbol: "MES", direction: "LONG", quantity: 1, entry_price: 6844.3, exit_price: 6849, stop_loss_price: 6841.25, ...noLevels });
  assert.match(errors.entry_price ?? "", /tick/);
  assert.equal(errors.exit_price, undefined);
  // A valid on-tick trade, typed in lowercase, has no errors at all.
  assert.deepEqual(validateTradeInput({ symbol: "mes", direction: "LONG", quantity: 1, entry_price: 6844.25, exit_price: 6849, stop_loss_price: 6841.25, ...noLevels }), {});
});

test("issue #51: a timestamp four days from any bar is unresolved, not snapped", () => {
  // Bars only on Nov 12 12:00–12:01 UTC; the fill is Nov 16 12:00 UTC.
  const bars = [Date.parse("2026-11-12T12:00:00Z"), Date.parse("2026-11-12T12:01:00Z")];
  const fill = Date.parse("2026-11-16T12:00:00Z");
  assert.deepEqual(alignToBar(bars, fill, "1m"), { kind: "unresolved" });
  assert.equal(snapToBar(bars, fill, "1m"), null);
  assert.equal(snapToBar([], fill, "1m"), null);
});

test("issue #51: a timestamp inside a bar is containing", () => {
  const start = Date.parse("2026-11-10T15:40:00Z");
  const bars = Array.from({ length: 20 }, (_, i) => start + i * minute);
  const fill = Date.parse("2026-11-10T15:48:37Z");
  assert.deepEqual(alignToBar(bars, fill, "1m"), { kind: "containing", barTime: start + 8 * minute });
  assert.equal(snapToBar(bars, fill, "1m"), start + 8 * minute);
});

test("issue #51: a missing bar is nearby within three bars, and unresolved beyond", () => {
  // Five-minute bars at 15:00, 15:05 and 15:10. The 15:20 bar is missing.
  const five = [Date.parse("2026-11-10T15:00:00Z"), Date.parse("2026-11-10T15:05:00Z"), Date.parse("2026-11-10T15:10:00Z")];
  // 15:22 is ten minutes past the last bar: within 15 minutes (three 5m bars), so it is nearby.
  assert.deepEqual(alignToBar(five, Date.parse("2026-11-10T15:22:00Z"), "5m"), { kind: "nearby", barTime: Date.parse("2026-11-10T15:10:00Z"), gapMs: 10 * minute });
  // 15:35 is 25 minutes past the last bar: beyond the tolerance, so no marker.
  assert.equal(snapToBar(five, Date.parse("2026-11-10T15:35:00Z"), "5m"), null);
  // A one-hour bar never snaps more than 30 minutes of clock time, even though three bars would be 3 hours.
  assert.equal(snapToBar([Date.parse("2026-11-10T14:00:00Z")], Date.parse("2026-11-10T15:45:00Z"), "1h"), null);
});

test("issue #63: plannedR rejects a target on the wrong side or at the entry", () => {
  // Long entered at 6000 with a valid stop at 5999 (4 ticks risk).
  const longBase = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 1, entry_price: 6000, exit_price: 6002, stop_loss_price: 5999 });
  // Target below entry: wrong side yields null.
  assert.equal(plannedR({ ...longBase, planned_target_price: 5998 }), null);
  // Target at entry: zero reward yields null.
  assert.equal(plannedR({ ...longBase, planned_target_price: 6000 }), null);
  // Valid target above entry: 8 ticks reward on 4 ticks risk = 2.0R.
  assert.equal(plannedR({ ...longBase, planned_target_price: 6002 }), 2);
  assert.equal(formatR(plannedR({ ...longBase, planned_target_price: 6002 })!), "+2.0R");

  // Short entered at 6000 with a valid stop at 6001 (4 ticks risk).
  const shortBase = normalizeTrade({ ...base, symbol: "MES", direction: "SHORT", quantity: 1, entry_price: 6000, exit_price: 5998, stop_loss_price: 6001 });
  // Target above entry: wrong side yields null.
  assert.equal(plannedR({ ...shortBase, planned_target_price: 6002 }), null);
  // Target at entry: zero reward yields null.
  assert.equal(plannedR({ ...shortBase, planned_target_price: 6000 }), null);
  // Valid target below entry: 8 ticks reward on 4 ticks risk = 2.0R.
  assert.equal(plannedR({ ...shortBase, planned_target_price: 5998 }), 2);
  assert.equal(formatR(plannedR({ ...shortBase, planned_target_price: 5998 })!), "+2.0R");
});

test("issue #63: tradeTicks and isScratch fail closed on invalid quantity or unpriceable trade", () => {
  for (const quantity of [0, -1, 1.5, Number.NaN]) {
    // 0-tick move (same entry and exit), which would otherwise be inside the scratch threshold
    const flat = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity, entry_price: 6000, exit_price: 6000, stop_loss_price: 5995 });
    assert.equal(tradeTicks(flat), null, `tradeTicks null for flat quantity ${quantity}`);
    assert.equal(isScratch(flat), false, `isScratch false for flat quantity ${quantity}`);

    // 1-tick move (inside the 2-tick scratch threshold)
    const near = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity, entry_price: 6000, exit_price: 6000.25, stop_loss_price: 5995 });
    assert.equal(tradeTicks(near), null, `tradeTicks null for near quantity ${quantity}`);
    assert.equal(isScratch(near), false, `isScratch false for near quantity ${quantity}`);
  }

  // Unpriceable trade (unknown symbol or invalid price) is never a scratch
  const unpriceable = normalizeTrade({ ...base, symbol: "XYZ", direction: "LONG", quantity: 1, entry_price: 100, exit_price: 100, stop_loss_price: 95 });
  assert.equal(tradeTicks(unpriceable), null);
  assert.equal(isScratch(unpriceable), false);
});

test("issue #64: alignTradeToBars marks nearby alignment as approximate and hides unresolved", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const bars = Array.from({ length: 6 }, (_, i) => start + i * minute);

  // Containing entry and exit: approximate is false
  const containing = alignTradeToBars(bars, start + 1 * minute + 15_000, start + 3 * minute + 40_000, "1m");
  assert.deepEqual(containing, {
    entryBar: start + 1 * minute,
    exitBar: start + 3 * minute,
    approximate: false,
  });

  // Containing entry, nearby exit (exit is 15:07, 2m past last bar at 15:05): approximate is true
  const nearbyExit = alignTradeToBars(bars, start + 1 * minute + 15_000, start + 7 * minute + 20_000, "1m");
  assert.deepEqual(nearbyExit, {
    entryBar: start + 1 * minute,
    exitBar: start + 5 * minute,
    approximate: true,
  });

  // Nearby entry (entry is 14:58, 2m before first bar at 15:00), containing exit: approximate is true
  const nearbyEntry = alignTradeToBars(bars, start - 2 * minute + 30_000, start + 3 * minute + 40_000, "1m");
  assert.deepEqual(nearbyEntry, {
    entryBar: start,
    exitBar: start + 3 * minute,
    approximate: true,
  });

  // Unresolved entry (more than 30m / 3 bars away): returns null
  const unresolvedEntry = alignTradeToBars(bars, start - 45 * minute, start + 3 * minute, "1m");
  assert.equal(unresolvedEntry, null);

  // Unresolved exit (more than 30m / 3 bars away): returns null
  const unresolvedExit = alignTradeToBars(bars, start + 1 * minute, start + 45 * minute, "1m");
  assert.equal(unresolvedExit, null);
});
