// Golden tests for what is expensive to get wrong: money, then time (CONTRIBUTING §7).
// Run with `npm test` (Node's built-in runner; no extra dependencies).
import assert from "node:assert/strict";
import { test } from "node:test";
import { approx, formatDuration, formatMoney, formatPoints, formatPrice, formatR, formatTicks } from "../format.ts";
import { formatSessionDate, sessionDate } from "../session.ts";
import { applyFilters, filtersToQuery, parseFilters } from "../selectors.ts";
import { demoTrades } from "../fixtures.ts";
import { formatDetailTime, formatListTime, fromZonedInput, toZonedInput } from "../time.ts";
import { processRead } from "../trades.ts";
import { MIN_FITTED_BARS, adherence, aggregateCandles, classifyTrade, defaultTimeframe, deriveReviewStatus, excursions, fitWindow, includeInPriceRange, normalizeTrade, rMultiple, snapToBar, snapToTick, tradePnl, tradePoints, tradeTicks } from "../trades.ts";
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

test("classification compares seconds, not rounded minutes", () => {
  assert.equal(classifyTrade("2026-11-10T15:00:00Z", "2026-11-10T15:14:40Z"), "scalp");
  assert.equal(classifyTrade("2026-11-10T15:00:00Z", "2026-11-10T15:15:00Z"), "session_90m");
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
  assert.equal(ninety.end - ninety.start, 3 * 60 * 60 * 1000);
});

test("fitted chart window has a thirty-bar floor", () => {
  const entry = "2026-11-10T15:00:00.000Z";
  const exit = "2026-11-10T15:00:40.000Z";
  const oneMinute = fitWindow(entry, exit, "1m");
  assert.equal(oneMinute.visibleBars, MIN_FITTED_BARS);
  assert.ok(oneMinute.beforeBars > oneMinute.afterBars);
  assert.equal(oneMinute.beforeBars + oneMinute.holdBars + oneMinute.afterBars, MIN_FITTED_BARS);

  const longer = fitWindow(entry, "2026-11-10T15:16:00.000Z", "1m");
  assert.equal(longer.visibleBars, 32);
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
  assert.equal(fifteenMinute.end - fifteenMinute.start, 450 * 60_000);
  assert.ok(fifteenMinute.end - fifteenMinute.start > oneMinute.end - oneMinute.start);
});

test("all ten sample trades have deterministic fitted-window goldens", () => {
  const expected: Record<string, { timeframe: string; share: number }> = {
    "mes-opening-scalp": { timeframe: "1m", share: 2 / 30 },
    "mnq-trend-hold": { timeframe: "5m", share: 0.5 },
    "mes-failed-reclaim": { timeframe: "1m", share: 0.5 },
    "mes-orb-fakeout": { timeframe: "1m", share: 7 / 30 },
    "mnq-vwap-reclaim": { timeframe: "1m", share: 0.5 },
    "mes-lunch-chop": { timeframe: "1m", share: 0.5 },
    "mnq-breakdown-scalp": { timeframe: "1m", share: 5 / 30 },
    "mes-premarket-reversal": { timeframe: "1m", share: 0.5 },
    "mnq-late-chase": { timeframe: "1m", share: 13 / 30 },
    "mes-afternoon-hold": { timeframe: "5m", share: 0.5 },
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
  const ex = excursions({ direction: "LONG", entry_time: new Date(start + 2 * minute + 5000).toISOString(), exit_time: new Date(start + 4 * minute + 5000).toISOString(), entry_price: 12 }, bars);
  assert.deepEqual(ex, { maePrice: 11, mfePrice: 16 });
});

test("review status and adherence", () => {
  const trade = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", entry_price: 1, exit_price: 2 });
  assert.equal(trade.review_status, "new");
  assert.equal(deriveReviewStatus({ ...trade, quick_tags: ["Level Sweep"] }), "tagged");
  assert.equal(deriveReviewStatus({ ...trade, review_status: "reviewed" }), "reviewed");
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
