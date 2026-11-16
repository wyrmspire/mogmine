// Golden tests for what is expensive to get wrong: money, then time (CONTRIBUTING §7).
// Run with `npm test` (Node's built-in runner; no extra dependencies).
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTrade } from "../describe.ts";
import { approx, formatDuration, formatMoney, formatPoints, formatPrice, formatR, formatTicks } from "../format.ts";
import { formatSessionDate, sessionDate } from "../session.ts";
import { applyFilters, dayStats, filtersToQuery, parseFilters } from "../selectors.ts";
import { demoTrades } from "../fixtures.ts";
import { validateTradeAgainstBars } from "../trade-bar-validation.ts";
import { shareCardContent, shareCardFileName, shouldBuildShareCard } from "../shareCard.ts";

import { formatDetailTime, formatListTime, fromZonedInput, toZonedInput } from "../time.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import { processRead } from "../trades.ts";
import { FUTURES_SPECS, MIN_FITTED_BARS, adherence, aggregateCandles, candleCacheKey, candleSignature, classifyTrade, defaultTimeframe, defaultVisibleRange, deriveReviewStatus, fillInsideBar, fitWindow, includeInPriceRange, normalizeTrade, rMultiple, snapToBar, snapToTick, tradePnl, tradePoints, tradeTicks, visibleLogicalBars } from "../trades.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
import { isIosDevice, shouldShowHomeScreenHint } from "../install.ts";
import type { Candle } from "../trades.ts";

const base = { id: "t", entry_time: "2026-11-10T15:43:00.000Z", exit_time: "2026-11-10T15:45:00.000Z" };

test("P&L uses the contract's own multiplier, micro versus mini", () => {
  const mes = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 2, entry_price: 6844.25, exit_price: 6849 });
  assert.equal(tradePnl(mes), 47.5);
  assert.equal(tradePnl({ ...mes, symbol: "ES" }), 475);
  assert.equal(tradeTicks(mes), 19);
  assert.equal(tradePoints(mes), 4.75);
  const mnqShort = normalizeTrade({ ...base, symbol: "MNQ", direction: "SHORT", quantity: 1, entry_price: 25784, exit_price: 25714 });
  assert.equal(tradePnl(mnqShort), 140);
});

test("tick sizes that are not exact in binary still give exact dollars", () => {
  const m2k = normalizeTrade({ ...base, symbol: "M2K", direction: "LONG", quantity: 3, entry_price: 2051.3, exit_price: 2051.6 });
  assert.equal(tradeTicks(m2k), 3);
  assert.equal(tradePnl(m2k), 4.5);
  const mcl = normalizeTrade({ ...base, symbol: "MCL", direction: "SHORT", quantity: 1, entry_price: 71.13, exit_price: 71.06 });
  assert.equal(tradeTicks(mcl), 7);
  assert.equal(tradePnl(mcl), 7);
  assert.equal(snapToTick(2051.34, "M2K"), 2051.3);
  assert.equal(snapToTick(6844.3, "MES"), 6844.25);
});

test("R is null without a stop, never zero", () => {
  const trade = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 2, entry_price: 6844.25, exit_price: 6849 });
  assert.equal(rMultiple(trade), null);
  assert.equal(formatR(rMultiple(trade)), "—R");
  assert.equal(rMultiple({ ...trade, stop_loss_price: 6844.25 }), null);
  const withStop = { ...trade, stop_loss_price: 6841.25 };
  assert.ok(Math.abs(rMultiple(withStop)! - 19 / 12) < 1e-12);
  assert.equal(formatR(rMultiple(withStop)), "+1.6R");
  assert.equal(formatR(rMultiple({ ...withStop, exit_price: 6841.25 })), "−1.0R");
});

test("classification compares raw elapsed milliseconds at thresholds", () => {
  // 14m 59.600s is a scalp (< 15m threshold in raw milliseconds, #54)
  assert.equal(classifyTrade("2026-11-10T15:00:00.000Z", "2026-11-10T15:14:59.600Z"), "scalp");
  assert.equal(classifyTrade("2026-11-10T15:00:00Z", "2026-11-10T15:14:40Z"), "scalp");
  // Exactly 15m is session_90m
  assert.equal(classifyTrade("2026-11-10T15:00:00.000Z", "2026-11-10T15:15:00.000Z"), "session_90m");
  assert.equal(classifyTrade("2026-11-10T15:00:00Z", "2026-11-10T17:00:00.000Z"), "session_90m");
  assert.equal(classifyTrade("2026-11-10T15:00:00Z", "2026-11-10T17:00:00.001Z"), "investment");
  assert.equal(classifyTrade("2026-11-10T15:00:00Z", "2026-11-10T17:00:01Z"), "investment");
});

test("feed ignores the removed style query and filters only by review status", () => {
  const params = new URLSearchParams("style=scalp&status=unreviewed");
  const filters = parseFilters(params);
  assert.deepEqual(filters, { status: "unreviewed" });
  assert.equal(filtersToQuery(filters), "?status=unreviewed");

  const scalp = normalizeTrade({ ...base, id: "scalp", symbol: "MES", direction: "LONG", entry_price: 1, exit_price: 2 });
  const longer = normalizeTrade({ ...base, id: "longer", symbol: "MES", direction: "LONG", entry_price: 1, exit_price: 2, entry_time: "2026-11-10T15:00:00Z", exit_time: "2026-11-10T16:30:00Z" });
  assert.deepEqual(applyFilters([scalp, longer], filters).map((trade) => trade.id), ["scalp", "longer"]);
});

test("fitted chart window is continuously derived from hold duration", () => {
  const entry = "2026-11-10T15:00:00.000Z";
  for (const seconds of [40, 5 * 60, 16 * 60, 90 * 60, 4 * 60 * 60]) {
    const exit = new Date(Date.parse(entry) + seconds * 1000).toISOString();
    const window = fitWindow(entry, exit, "1m", 0);
    const holdMs = seconds * 1000;
    assert.equal(window.end - window.start, holdMs * 2);
    assert.ok(Math.abs(holdMs / (window.end - window.start) - 0.5) < 1e-12);
    assert.ok(Math.abs((Date.parse(entry) - window.start) / (window.end - window.start) - 0.3) < 1e-12);
    assert.ok(Math.abs((window.end - Date.parse(exit)) / (window.end - window.start) - 0.2) < 1e-12);
  }
  const ninety = fitWindow(entry, "2026-11-10T16:30:00.000Z", "5m");
  // Twice the 90-minute hold is 36 five-minute bars, so the 45-bar floor binds: 225 minutes.
  assert.equal(ninety.end - ninety.start, 45 * 5 * 60 * 1000);
  const twoHours = fitWindow(entry, "2026-11-10T17:00:00.000Z", "5m");
  assert.equal(twoHours.end - twoHours.start, 4 * 60 * 60 * 1000);
});

test("fitted chart window has a forty-five-bar floor", () => {
  const entry = "2026-11-10T15:00:00.000Z";
  const exit = "2026-11-10T15:00:40.000Z";
  const oneMinute = fitWindow(entry, exit, "1m");
  assert.equal(oneMinute.visibleBars, MIN_FITTED_BARS);
  assert.ok(oneMinute.beforeBars > oneMinute.afterBars);
  assert.equal(oneMinute.beforeBars + oneMinute.holdBars + oneMinute.afterBars, MIN_FITTED_BARS);

  const longer = fitWindow(entry, "2026-11-10T15:24:00.000Z", "1m");
  assert.equal(longer.visibleBars, 48);
  assert.equal(longer.holdBars / longer.visibleBars, 0.5);
});

test("default timeframe follows hold duration", () => {
  assert.equal(defaultTimeframe(40), "1m");
  assert.equal(defaultTimeframe(5 * 60), "1m");
  assert.equal(defaultTimeframe(16 * 60), "1m");
  assert.equal(defaultTimeframe(90 * 60), "5m");
  assert.equal(defaultTimeframe(4 * 60 * 60), "15m");
});

test("coarser timeframes show wider clock-time context", () => {
  const entry = "2026-11-10T15:00:00.000Z";
  const exit = "2026-11-10T16:30:00.000Z";
  const oneMinute = fitWindow(entry, exit, "1m");
  const fifteenMinute = fitWindow(entry, exit, "15m");
  assert.equal(oneMinute.end - oneMinute.start, 180 * 60_000);
  assert.equal(fifteenMinute.end - fifteenMinute.start, 45 * 15 * 60_000);
  assert.ok(fifteenMinute.end - fifteenMinute.start > oneMinute.end - oneMinute.start);
});

test("defaultVisibleRange is the trade window with a 45-bar floor, not a 2.5x zoom-out", () => {
  const baseFit = { from: 50, to: 95 }; // 45-bar fitted width
  const opening = defaultVisibleRange(baseFit, 200);
  assert.ok(visibleLogicalBars(opening) >= 45, "must never have fewer than 45 bars when data allows");
  assert.equal(visibleLogicalBars(opening), 45, "must not apply a zoom-out multiplier");
  assert.deepEqual(opening, baseFit);
  assert.ok(opening.from >= 0 && opening.to <= 200, "must be clamped to the loaded series");

  const nearStart = defaultVisibleRange({ from: 5, to: 50 }, 200);
  assert.deepEqual(nearStart, { from: 5, to: 50 });
  assert.equal(visibleLogicalBars(nearStart), 45);

  const nearEnd = defaultVisibleRange({ from: 150, to: 195 }, 200);
  assert.deepEqual(nearEnd, { from: 150, to: 195 });
  assert.equal(visibleLogicalBars(nearEnd), 45);

  // Fit window hangs off the end of a 60-bar series: clamp and keep 45 bars.
  const shortHistory = defaultVisibleRange(baseFit, 60);
  assert.deepEqual(shortHistory, { from: 15, to: 60 });
  assert.equal(visibleLogicalBars(shortHistory), 45);

  // Exactly 45 loaded candles still yield a 45-bar logical range, not 44.
  const exact = defaultVisibleRange({ from: 0, to: 20 }, 45);
  assert.equal(visibleLogicalBars(exact), 45);
  assert.deepEqual(exact, { from: 0, to: 45 });

  const thin = defaultVisibleRange({ from: 0, to: 8 }, 20);
  assert.equal(visibleLogicalBars(thin), 20);
});

test("mnq-trend-hold 5m opening range is 45 to about 60 bars, not 100+", () => {
  const trade = demoTrades.find((item) => item.id === "mnq-trend-hold");
  assert.ok(trade);
  const fitted = fitWindow(trade.entry_time, trade.exit_time, "5m");
  assert.ok(fitted.visibleBars >= 45 && fitted.visibleBars <= 60, `fit window is ${fitted.visibleBars} bars`);
  // Same conversion TradeChart uses: logical range starts before the entry bar.
  const entryIndex = 800;
  const fitFrom = entryIndex - fitted.beforeBars;
  const baseFit = { from: fitFrom, to: fitFrom + fitted.visibleBars };
  const opening = defaultVisibleRange(baseFit, 1372);
  const bars = visibleLogicalBars(opening);
  assert.ok(bars >= 45, `opening range is ${bars} bars, need at least 45`);
  assert.ok(bars <= 60, `opening range is ${bars} bars, expected 45–60, not 100+`);
});

test("all ten sample trades have deterministic fitted-window goldens", () => {
  const expected: Record<string, { timeframe: string; share: number }> = {
    "mes-opening-scalp": { timeframe: "1m", share: (479 / 60) / 45 },
    "mnq-trend-hold": { timeframe: "5m", share: 13.9 / 45 },
    "mes-failed-reclaim": { timeframe: "1m", share: 3.5 / 45 },
    "mes-orb-fakeout": { timeframe: "1m", share: 0.5 },
    "mnq-vwap-reclaim": { timeframe: "1m", share: 10.5 / 45 },
    "mes-lunch-chop": { timeframe: "5m", share: (4199 / 300) / 45 },
    "mnq-breakdown-scalp": { timeframe: "1m", share: 5.5 / 45 },
    "mes-premarket-reversal": { timeframe: "1m", share: 7.5 / 45 },
    "mnq-late-chase": { timeframe: "1m", share: 2.5 / 45 },
    "mes-afternoon-hold": { timeframe: "1m", share: 0.5 },
  };
  assert.equal(demoTrades.length, 10);
  for (const trade of demoTrades) {
    assert.notEqual(trade.planned_target_price, null, `${trade.id} needs a planned target`);
    assert.deepEqual(trade.sparkline, [], `${trade.id} must not ship generated candles`);
    const golden = expected[trade.id];
    assert.ok(golden, `missing golden for ${trade.id}`);
    const timeframe = defaultTimeframe(Math.round((Date.parse(trade.exit_time) - Date.parse(trade.entry_time)) / 1000));
    const fitted = fitWindow(trade.entry_time, trade.exit_time, timeframe);
    assert.equal(timeframe, golden.timeframe, trade.id);
    assert.ok(Math.abs(fitted.holdBars / fitted.visibleBars - golden.share) < 1e-12, trade.id);
    assert.ok(fitted.visibleBars >= MIN_FITTED_BARS, trade.id);
  }
});

test("chart autoscale includes candles, planned stop, planned target and actual exit", () => {
  assert.deepEqual(includeInPriceRange({ minValue: 100, maxValue: 110 }, [104, 116, 96, 114]), { minValue: 96, maxValue: 116 });
  assert.deepEqual(includeInPriceRange(null, [104, 116, 96, 114]), { minValue: 96, maxValue: 116 });
  assert.deepEqual(includeInPriceRange({ minValue: 100, maxValue: 110 }, [null, undefined, Number.NaN]), { minValue: 100, maxValue: 110 });
});

test("bar validator reports crossed plans and an exit outside its bar without changing the trade", () => {
  const minute = 60_000;
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles: Candle[] = [
    { time: start, open: 100, high: 102, low: 99, close: 101, volume: 1 },
    { time: start + minute, open: 101, high: 111, low: 94, close: 105, volume: 1 },
    { time: start + 2 * minute, open: 105, high: 108, low: 103, close: 106, volume: 1 },
    { time: start + 3 * minute, open: 106, high: 107, low: 104, close: 105, volume: 1 },
  ];
  const trade = normalizeTrade({
    id: "bar-check", symbol: "MES", direction: "LONG",
    entry_time: new Date(start).toISOString(), exit_time: new Date(start + 3 * minute).toISOString(),
    entry_price: 100, exit_price: 108, stop_loss_price: 95, planned_target_price: 110,
  });
  const before = structuredClone(trade);
  const result = validateTradeAgainstBars(trade, candles);
  assert.equal(result.coverage, "complete");
  assert.deepEqual(result.issues, [
    { code: "stop_crossed_before_exit", barTime: start + minute, price: 95 },
    { code: "target_crossed_before_exit", barTime: start + minute, price: 110 },
    { code: "exit_outside_bar", barTime: start + 3 * minute, price: 108 },
  ]);
  assert.deepEqual(trade, before);
});

test("bar validator handles shorts and does not infer order inside the exit bar", () => {
  const minute = 60_000;
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles: Candle[] = [
    { time: start, open: 100, high: 101, low: 99, close: 100, volume: 1 },
    { time: start + minute, open: 100, high: 106, low: 89, close: 94, volume: 1 },
    { time: start + 2 * minute, open: 94, high: 95, low: 88, close: 90, volume: 1 },
  ];
  const exitsAtTarget = normalizeTrade({
    id: "short-target", symbol: "MNQ", direction: "SHORT",
    entry_time: new Date(start).toISOString(), exit_time: new Date(start + minute).toISOString(),
    entry_price: 100, exit_price: 90, stop_loss_price: 105, planned_target_price: 90,
  });
  const clean = validateTradeAgainstBars(exitsAtTarget, candles);
  assert.equal(clean.coverage, "complete");
  assert.deepEqual(clean.issues, []);

  const exitsLaterAndWorse = { ...exitsAtTarget, exit_time: new Date(start + 2 * minute).toISOString(), exit_price: 94 };
  const worse = validateTradeAgainstBars(exitsLaterAndWorse, candles);
  assert.equal(worse.coverage, "complete");
  assert.deepEqual(worse.issues.map((issue) => issue.code), [
    "stop_crossed_before_exit",
    "target_crossed_before_exit",
  ]);
});

test("bar validator reports missing, partial, and complete coverage", () => {
  const minute = 60_000;
  const start = Date.parse("2026-11-10T15:00:00Z");
  const trade = normalizeTrade({
    id: "cover", symbol: "MES", direction: "LONG",
    entry_time: new Date(start).toISOString(), exit_time: new Date(start + 4 * minute).toISOString(),
    entry_price: 100, exit_price: 104, stop_loss_price: 90, planned_target_price: 120,
  });
  const bar = (time: number, high = 105, low = 99): Candle => (
    { time, open: 100, high, low, close: 104, volume: 1 }
  );
  const complete = [
    bar(start),
    bar(start + minute),
    bar(start + 2 * minute),
    bar(start + 3 * minute),
    bar(start + 4 * minute),
  ];

  const empty = validateTradeAgainstBars(trade, []);
  assert.equal(empty.coverage, "missing");
  assert.deepEqual(empty.issues, []);

  const noneOverlap = validateTradeAgainstBars(trade, [bar(start + 20 * minute)]);
  assert.equal(noneOverlap.coverage, "missing");
  assert.deepEqual(noneOverlap.issues, []);

  const gapped = validateTradeAgainstBars(trade, [
    bar(start),
    bar(start + minute),
    // start + 2 minutes is missing
    bar(start + 3 * minute),
    bar(start + 4 * minute),
  ]);
  assert.equal(gapped.coverage, "partial");
  assert.deepEqual(gapped.issues, []);

  const clean = validateTradeAgainstBars(trade, complete);
  assert.equal(clean.coverage, "complete");
  assert.equal(clean.chronology, "resolved");
  assert.deepEqual(clean.issues, []);
});

test("issue #60: complete coverage requires the entry candle, not only inside and exit bars", () => {
  const minute = 60_000;
  const start = Date.parse("2026-11-10T15:00:00Z");
  // Entry 15:00:30, exit 15:03:20. Expected inside bars: 15:01, 15:02. Exit bar: 15:03. Entry bar: 15:00.
  const trade = normalizeTrade({
    id: "missing-entry", symbol: "MES", direction: "LONG",
    entry_time: new Date(start + 30_000).toISOString(),
    exit_time: new Date(start + 3 * minute + 20_000).toISOString(),
    entry_price: 100, exit_price: 104,
  });
  const bar = (time: number): Candle => ({ time, open: 100, high: 105, low: 99, close: 104, volume: 1 });
  const withoutEntry = [bar(start + minute), bar(start + 2 * minute), bar(start + 3 * minute)];
  const missingEntry = validateTradeAgainstBars(trade, withoutEntry);
  assert.equal(missingEntry.coverage, "partial");
  assert.equal(missingEntry.chronology, "resolved");

  const withEntry = [bar(start), ...withoutEntry];
  const complete = validateTradeAgainstBars(trade, withEntry);
  assert.equal(complete.coverage, "complete");
  assert.equal(complete.chronology, "resolved");
});

test("issue #60: fillInsideBar is false when the bar is missing", () => {
  const bar: Candle = { time: Date.parse("2026-11-10T15:00:00Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 1 };
  assert.equal(fillInsideBar(100, undefined, "MES"), false);
  assert.equal(fillInsideBar(100, bar, "MES"), true);
  assert.equal(fillInsideBar(110, bar, "MES"), false);
});

test("issue #60: a same-bar hold can have complete data and unresolved chronology", () => {
  const minute = 60_000;
  const start = Date.parse("2026-11-10T15:00:00Z");
  const trade = normalizeTrade({
    id: "intra-bar", symbol: "MES", direction: "LONG",
    entry_time: new Date(start + 10_000).toISOString(),
    exit_time: new Date(start + 30_000).toISOString(),
    entry_price: 100, exit_price: 100.25,
  });
  const bar: Candle = { time: start, open: 100, high: 101, low: 99, close: 100.5, volume: 1 };
  const present = validateTradeAgainstBars(trade, [bar]);
  assert.equal(present.coverage, "complete");
  assert.equal(present.chronology, "unresolved");
  assert.deepEqual(present.issues, []);

  const absent = validateTradeAgainstBars(trade, []);
  assert.equal(absent.coverage, "missing");
  assert.equal(absent.chronology, "unresolved");

  const otherBar = validateTradeAgainstBars(trade, [{ ...bar, time: start + minute }]);
  assert.equal(otherBar.coverage, "missing");
  assert.equal(otherBar.chronology, "unresolved");
});

test("issue #61: dayStats labels gross, counts unpriceable trades, and uses priced trades for win rate", () => {
  const winner = normalizeTrade({
    id: "priced-win", symbol: "MES", direction: "LONG", quantity: 1,
    entry_time: "2026-11-10T15:00:00.000Z", exit_time: "2026-11-10T15:05:00.000Z",
    entry_price: 6000, exit_price: 6020, stop_loss_price: 5990,
  });
  const unpriceable = normalizeTrade({
    id: "bad-spec", symbol: "XYZ", direction: "LONG", quantity: 1,
    entry_time: "2026-11-10T15:10:00.000Z", exit_time: "2026-11-10T15:15:00.000Z",
    entry_price: 100, exit_price: 90,
  });
  assert.equal(tradePnl(winner), 100); // 20 points * $5
  assert.equal(tradePnl(unpriceable), null);

  const mixed = dayStats([winner, unpriceable]);
  assert.equal(mixed.count, 2);
  assert.equal(mixed.pricedCount, 1);
  assert.equal(mixed.unpriceableCount, 1);
  assert.equal(mixed.gross, 100);
  assert.equal(mixed.wins, 1);
  assert.equal(mixed.winRate, 1);
  assert.equal(mixed.incomplete, true);

  const clean = dayStats([winner]);
  assert.equal(clean.gross, 100);
  assert.equal(clean.pricedCount, 1);
  assert.equal(clean.unpriceableCount, 0);
  assert.equal(clean.winRate, 1);
  assert.equal(clean.incomplete, false);

  const empty = dayStats([]);
  assert.equal(empty.gross, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.incomplete, false);

  const onlyBad = dayStats([unpriceable]);
  assert.equal(onlyBad.gross, 0);
  assert.equal(onlyBad.winRate, null);
  assert.equal(onlyBad.incomplete, true);
});

test("formatting follows docs/08 §13", () => {
  assert.equal(formatMoney(325), "+$325.00");
  assert.equal(formatMoney(-110), "−$110.00");
  assert.equal(formatMoney(1234.5), "+$1,234.50");
  assert.equal(formatR(2.64), "+2.6R");
  assert.equal(formatR(-0.01), "+0.0R");
  assert.equal(formatPoints(13, "MES"), "+13.00 pts");
  assert.equal(formatPoints(-1.25, "MES"), "−1.25 pts");
  assert.equal(formatTicks(52), "+52 ticks");
  assert.equal(formatTicks(-1), "−1 tick");
  assert.equal(formatPrice(5948.25, "MES"), "5948.25");
  assert.equal(formatPrice(null), "—");
  assert.equal(formatDuration(48), "48s");
  assert.equal(formatDuration(42 * 60 + 10), "42m 10s");
  assert.equal(formatDuration(42 * 60), "42m");
  assert.equal(formatDuration(3 * 3600 + 5 * 60), "3h 05m");
  assert.equal(approx("−1.25 pts"), "≈ −1.25 pts");
});

test("session date: the Globex evening belongs to the next session, across both DST switches", () => {
  // March 2026: DST starts Sunday the 8th, so New York is UTC−4 in the week after.
  assert.equal(sessionDate("2026-03-10T21:59:00Z"), "2026-03-10"); // Tue 17:59 EDT
  assert.equal(sessionDate("2026-03-10T22:00:00Z"), "2026-03-11"); // Tue 18:00 EDT
  assert.equal(sessionDate("2026-03-08T22:30:00Z"), "2026-03-09"); // Sun 18:30 EDT opens Monday
  // November 2026: DST ends Sunday the 1st, so New York is UTC−5 in the week after.
  assert.equal(sessionDate("2026-11-03T22:59:00Z"), "2026-11-03"); // Tue 17:59 EST
  assert.equal(sessionDate("2026-11-03T23:00:00Z"), "2026-11-04"); // Tue 18:00 EST
  assert.equal(sessionDate("2026-11-13T15:51:00Z"), "2026-11-13"); // Fri morning
  assert.equal(sessionDate("2026-11-14T17:00:00Z"), "2026-11-16"); // Saturday rolls to Monday
  assert.equal(formatSessionDate("2026-11-13"), "Fri, Nov 13");
});

test("display zone formats and parses wall-clock time whatever the device zone", () => {
  assert.equal(formatListTime("2026-11-10T15:43:00Z", "America/Chicago"), "09:43");
  assert.equal(formatListTime("2026-11-10T15:43:00Z", "America/New_York"), "10:43");
  assert.equal(formatDetailTime("2026-07-10T14:43:12Z", "America/Chicago"), "09:43:12 CDT");
  const typed = fromZonedInput("2026-11-10T09:43", "America/Chicago");
  assert.equal(typed.toISOString(), "2026-11-10T15:43:00.000Z");
  assert.equal(toZonedInput(typed, "America/Chicago"), "2026-11-10T09:43");
  assert.equal(fromZonedInput("2026-07-10T09:43", "America/Chicago").toISOString(), "2026-07-10T14:43:00.000Z");
});

test("fill times snap to the bar that contains them (B-23)", () => {
  const minute = 60_000;
  const start = Date.parse("2026-11-10T15:40:00Z");
  const bars: Candle[] = Array.from({ length: 20 }, (_, i) => ({ time: start + i * minute, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 1 }));
  const fill = Date.parse("2026-11-10T15:48:37Z");
  assert.equal(snapToBar(bars.map((bar) => bar.time), fill, "1m"), start + 8 * minute);
  const five = aggregateCandles(bars, "5m");
  assert.equal(five.length, 4);
  assert.equal(snapToBar(five.map((bar) => bar.time), fill, "5m"), start + 5 * minute);
  // A missing bar snaps to the nearest one instead of vanishing.
  const gappy = bars.filter((_, i) => i !== 8).map((bar) => bar.time);
  assert.equal(snapToBar(gappy, fill, "1m"), start + 7 * minute);
});

test("review status and adherence", () => {
  const trade = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", entry_price: 1, exit_price: 2 });
  assert.equal(trade.review_status, "new");
  assert.equal(deriveReviewStatus({ ...trade, quick_tags: ["Level Sweep"] }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, review_status: "reviewed" }), "reviewed");

  // Deeper notes, checklist, and blind review count as review evidence (#54)
  assert.equal(deriveReviewStatus({ ...trade, post_exit_notes: "Clean exit at target." }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, management_notes: "Trailing stop behind 1m swing." }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, pre_trade_thesis: "Premarket high reclaim." }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, checklist_state: [{ id: "r1", label: "Rule 1", checked: false }] }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, take_again: "yes" }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, take_again: "pass" }), "tagged");

  // Trade with only post_exit_notes is not "new"; trade with none of those fields is "new"
  assert.equal(deriveReviewStatus({ review_status: "new", post_exit_notes: "Detailed review notes." }), "tagged");
  assert.equal(deriveReviewStatus({ review_status: "new" }), "new");
  assert.equal(deriveReviewStatus(trade), "new");

  assert.equal(adherence(trade), null);
  assert.deepEqual(adherence({ checklist_state: [{ id: "a", label: "a", checked: true }, { id: "b", label: "b", checked: false }] }), { followed: 1, total: 2, ratio: 0.5 });
});

test("process read: rules and violation tags decide, never the outcome", () => {
  const rule = (checked: boolean) => ({ id: "a", label: "a", checked });
  assert.equal(processRead({ checklist_state: [], quick_tags: [] }), null);
  assert.equal(processRead({ checklist_state: [rule(true)], quick_tags: ["Level Sweep"] }), "clean");
  assert.equal(processRead({ checklist_state: [rule(true), rule(false)], quick_tags: [] }), "broken");
  assert.equal(processRead({ checklist_state: [rule(true)], quick_tags: ["Revenge"] }), "broken");
});

test("OD-15: MES charts on MES=F and MNQ on MNQ=F, with ticker-scoped cache keys", () => {
  const provider = new YahooFinanceProvider();
  assert.equal(FUTURES_SPECS.MES.yahooTicker, "MES=F");
  assert.equal(FUTURES_SPECS.MNQ.yahooTicker, "MNQ=F");
  assert.equal(FUTURES_SPECS.ES.yahooTicker, "ES=F");
  assert.equal(FUTURES_SPECS.NQ.yahooTicker, "NQ=F");
  assert.equal(provider.resolveProviderSymbol("MES"), "MES=F");
  assert.equal(provider.resolveProviderSymbol("MNQ"), "MNQ=F");

  // Stored trades from before OD-15 that carried yahoo_ticker: "ES=F" are migrated to "MES=F".
  const migrated = normalizeTrade({ ...base, symbol: "MES", yahoo_ticker: "ES=F", direction: "LONG", entry_price: 6844.25, exit_price: 6849 });
  assert.equal(migrated.yahoo_ticker, "MES=F");
  assert.equal(candleCacheKey(migrated), "t:MES=F");
  assert.ok(candleSignature(migrated).includes("MES=F"));
  assert.ok(!candleSignature(migrated).includes("|ES=F|"));
});

test("chart text equivalent describes direction, size, times, prices and R or points (UX-84, UX-71)", () => {
  const trade = normalizeTrade({
    ...base,
    symbol: "MES",
    direction: "LONG",
    quantity: 2,
    entry_price: 5948.5,
    exit_price: 5961.5,
    stop_loss_price: 5943.5,
  });
  assert.equal(
    describeTrade(trade, "America/Chicago", false),
    "Long MES, 2 contracts, entered 09:43:00 CST at 5948.50, exited 09:45:00 CST at 5961.50, plus 2.6 R.",
  );
  assert.equal(
    describeTrade(trade, "America/Chicago", true),
    "Long MES, entered 09:43:00 CST at 5948.50, exited 09:45:00 CST at 5961.50, plus 2.6 R.",
  );
  const noStop = { ...trade, stop_loss_price: null };
  assert.match(describeTrade(noStop, "America/Chicago", true), /plus 13 points, no stop recorded\.$/);
});

test("Shield / privacy mode omits dollars and contract size in descriptions and share file names (UX-64, UX-72)", () => {
  const trade = normalizeTrade({
    ...base,
    symbol: "MES",
    direction: "LONG",
    quantity: 3,
    entry_price: 6844.25,
    exit_price: 6849,
    stop_loss_price: 6841.25,
    playbook_id: "orb-reclaim",
    quick_tags: ["Opening Drive", "A+ Patience"],
    checklist_state: [{ id: "hard-stop", label: "Hard stop placed", checked: true }],
  });
  const open = describeTrade(trade, "America/Chicago", false);
  const shielded = describeTrade(trade, "America/Chicago", true);
  assert.match(open, /3 contracts/);
  assert.doesNotMatch(shielded, /contract|3×|\$|usd/i);
  assert.match(shielded, /plus 1\.6 R/);

  const fileName = shareCardFileName(trade);
  assert.equal(fileName, "mes-long-2026-11-10-trade-card.png");
  assert.doesNotMatch(fileName, /\$|usd|3|contract|71\.25/i);

  const privateCard = shareCardContent(trade, "America/Chicago", true);
  assert.doesNotMatch(JSON.stringify(privateCard), /\$|contract/i);
  assert.match(privateCard.outcome, /R$/);
  assert.equal(privateCard.outcomeDetail, "+4.75 pts");
  assert.match(privateCard.entry, /ENTRY Nov 10, 09:43 CST/);
  assert.match(privateCard.exit, /EXIT Nov 10, 09:45 CST/);
  assert.equal(privateCard.playbook, "ORB Reclaim");
  assert.deepEqual(privateCard.tags, ["Opening Drive", "A+ Patience"]);
  assert.equal(privateCard.ruleSeal, "1/1 FOLLOWED");
  assert.deepEqual(privateCard.rules, trade.checklist_state);

  const openCard = shareCardContent(trade, "America/Chicago", false);
  assert.match(openCard.outcome, /\+\$71\.25/);
  assert.match(openCard.direction, /3 contracts/);
});

test("encodes the Trade Card lazily, never on a notes keystroke", () => {
  assert.equal(shouldBuildShareCard("notes", false), false);
  assert.equal(shouldBuildShareCard("notes", true), false);
  assert.equal(shouldBuildShareCard("sheet-open", false), true);
  assert.equal(shouldBuildShareCard("share", false), true);
  assert.equal(shouldBuildShareCard("privacy", true), true);
  assert.equal(shouldBuildShareCard("chart-render", false), false);
  assert.equal(shouldBuildShareCard("view-change", false), false);
  assert.equal(shouldBuildShareCard("view-change", true), true);
  assert.equal(shouldBuildShareCard("chart-render", true), true);
});

test("journal backup round-trips trades (notes, prices, tags, checklist, playbook) and preserves sample labels", () => {
  const realTrade = normalizeTrade({
    id: "real-trade-1",
    symbol: "MES",
    direction: "LONG",
    quantity: 2,
    entry_time: "2026-11-12T15:35:00.000Z",
    exit_time: "2026-11-12T15:52:00.000Z",
    entry_price: 6840.25,
    exit_price: 6846.75,
    stop_loss_price: 6836.25,
    planned_target_price: 6848.25,
    key_level_price: 6838.5,
    note: "Held reclaim cleanly.",
    playbook_id: "orb-reclaim",
    quick_tags: ["Opening Drive", "A+ Patience"],
    checklist_state: [
      { id: "r1", label: "Wait for close", checked: true },
      { id: "r2", label: "Stop in place", checked: false },
    ],
    pre_trade_thesis: "Above ONH",
    management_notes: "Kept initial stop",
    post_exit_notes: "Ran 2 more points",
    flagged: true,
    review_status: "reviewed",
    is_sample: false,
  });

  const sampleTrade = normalizeTrade({
    id: "mes-opening-scalp",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-10T15:43:00.000Z",
    exit_time: "2026-11-10T15:45:00.000Z",
    entry_price: 6844.25,
    exit_price: 6849,
    is_sample: true,
  });

  const backup = buildBackup([realTrade, sampleTrade], {
    shield: true,
    goldPreset: "champagne",
    goldIntensity: 0.6,
    boxOpacity: 0.35,
    palette: "blue-orange",
    timeZone: "America/New_York",
    showSamples: false,
    blindReview: true,
    riskBudgetUsd: 300,
  });

  assert.equal(backup.app, "mogmine");
  assert.equal(backup.includesCandles, false);

  const parsed = parseBackupFile(JSON.stringify(backup));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.realCount, 1);
  assert.equal(parsed.sampleCount, 1);
  assert.equal(parsed.prefs?.goldPreset, "champagne");
  assert.equal(parsed.prefs?.timeZone, "America/New_York");

  const restoredReal = parsed.trades.find((t) => t.id === "real-trade-1")!;
  assert.equal(restoredReal.is_sample, false);
  assert.equal(restoredReal.note, "Held reclaim cleanly.");
  assert.equal(restoredReal.entry_price, 6840.25);
  assert.equal(restoredReal.exit_price, 6846.75);
  assert.equal(restoredReal.stop_loss_price, 6836.25);
  assert.equal(restoredReal.planned_target_price, 6848.25);
  assert.equal(restoredReal.key_level_price, 6838.5);
  assert.equal(restoredReal.playbook_id, "orb-reclaim");
  assert.deepEqual(restoredReal.quick_tags, ["Opening Drive", "A+ Patience"]);
  assert.deepEqual(restoredReal.checklist_state, [
    { id: "r1", label: "Wait for close", checked: true },
    { id: "r2", label: "Stop in place", checked: false },
  ]);
  assert.equal(restoredReal.pre_trade_thesis, "Above ONH");
  assert.equal(restoredReal.management_notes, "Kept initial stop");
  assert.equal(restoredReal.post_exit_notes, "Ran 2 more points");
  assert.equal(restoredReal.flagged, true);
  assert.equal(restoredReal.review_status, "reviewed");

  const restoredSample = parsed.trades.find((t) => t.id === "mes-opening-scalp")!;
  assert.equal(restoredSample.is_sample, true);
});

test("parseBackupFile accepts legacy raw trade arrays, strips inline candles, and rejects invalid files", () => {
  // Legacy v1/v2 array without explicit is_sample still labels known demo IDs as samples
  const legacyRaw = JSON.stringify([
    {
      id: "mes-opening-scalp",
      symbol: "MES",
      direction: "LONG",
      entry_time: "2026-11-10T15:43:00.000Z",
      exit_time: "2026-11-10T15:45:00.000Z",
      entry_price: 6844.25,
      exit_price: 6849,
      candles: [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
    },
  ]);
  const legacyParsed = parseBackupFile(legacyRaw);
  assert.equal(legacyParsed.ok, true);
  if (legacyParsed.ok) {
    assert.equal(legacyParsed.trades[0].is_sample, true);
    assert.equal("candles" in legacyParsed.trades[0], false);
  }

  assert.equal(parseBackupFile("").ok, false);
  assert.equal(parseBackupFile("{not json").ok, false);
  assert.equal(parseBackupFile(JSON.stringify({ app: "other", trades: [] })).ok, false);
  assert.equal(parseBackupFile(JSON.stringify({ app: "mogmine", trades: [] })).ok, false);
  assert.equal(parseBackupFile(JSON.stringify({ app: "mogmine", trades: [{ id: "bad-trade" }] })).ok, false);
});

test("home-screen hint only appears once in an uninstalled iOS browser", () => {
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  const ipadDesktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
  assert.equal(isIosDevice(ios, 5), true);
  assert.equal(isIosDevice(ipadDesktop, 5), true);
  assert.equal(isIosDevice(ipadDesktop, 0), false);

  const environment = { userAgent: ios, maxTouchPoints: 5, navigatorStandalone: false, displayModeStandalone: false, seen: false };
  assert.equal(shouldShowHomeScreenHint(environment), true);
  assert.equal(shouldShowHomeScreenHint({ ...environment, seen: true }), false);
  assert.equal(shouldShowHomeScreenHint({ ...environment, navigatorStandalone: true }), false);
  assert.equal(shouldShowHomeScreenHint({ ...environment, displayModeStandalone: true }), false);
  assert.equal(shouldShowHomeScreenHint({ ...environment, userAgent: "Mozilla/5.0 (Linux; Android 15)" }), false);
});
