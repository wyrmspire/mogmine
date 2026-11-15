// Golden tests for what is expensive to get wrong: money, then time (CONTRIBUTING §7).
// Run with `npm test` (Node's built-in runner; no extra dependencies).
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTrade } from "../describe.ts";
import { approx, formatDuration, formatMoney, formatPoints, formatPrice, formatR, formatTicks } from "../format.ts";
import { formatSessionDate, sessionDate } from "../session.ts";
import { applyFilters, filtersToQuery, parseFilters } from "../selectors.ts";
import { demoTrades } from "../fixtures.ts";
import { validateTradeAgainstBars } from "../trade-bar-validation.ts";
import { shareCardFileName } from "../shareCard.ts";

import { formatDetailTime, formatListTime, fromZonedInput, toZonedInput } from "../time.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import { processRead } from "../trades.ts";
import { FUTURES_SPECS, MIN_FITTED_BARS, adherence, aggregateCandles, candleCacheKey, candleSignature, classifyTrade, defaultTimeframe, deriveReviewStatus, excursions, fitWindow, includeInPriceRange, normalizeTrade, rMultiple, snapToBar, snapToTick, tradePnl, tradePoints, tradeTicks } from "../trades.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
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
    "mnq-trend-hold": { timeframe: "5m", share: 14 / 30 },
    "mes-failed-reclaim": { timeframe: "1m", share: 14 / 30 },
    "mes-orb-fakeout": { timeframe: "1m", share: 2 / 30 },
    "mnq-vwap-reclaim": { timeframe: "1m", share: 0.5 },
    "mes-lunch-chop": { timeframe: "1m", share: 0.5 },
    "mnq-breakdown-scalp": { timeframe: "1m", share: 5 / 30 },
    "mes-premarket-reversal": { timeframe: "5m", share: 10.8 / 30 },
    "mnq-late-chase": { timeframe: "1m", share: 10 / 30 },
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
  assert.deepEqual(validateTradeAgainstBars(trade, candles), [
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
  assert.deepEqual(validateTradeAgainstBars(exitsAtTarget, candles), []);

  const exitsLaterAndWorse = { ...exitsAtTarget, exit_time: new Date(start + 2 * minute).toISOString(), exit_price: 94 };
  assert.deepEqual(validateTradeAgainstBars(exitsLaterAndWorse, candles).map((issue) => issue.code), [
    "stop_crossed_before_exit",
    "target_crossed_before_exit",
  ]);
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
  const trade = normalizeTrade({ ...base, symbol: "MES", direction: "LONG", quantity: 3, entry_price: 6844.25, exit_price: 6849, stop_loss_price: 6841.25 });
  const open = describeTrade(trade, "America/Chicago", false);
  const shielded = describeTrade(trade, "America/Chicago", true);
  assert.match(open, /3 contracts/);
  assert.doesNotMatch(shielded, /contract|3×|\$|usd/i);
  assert.match(shielded, /plus 1\.6 R/);

  const fileName = shareCardFileName(trade);
  assert.equal(fileName, "mes-long-2026-11-10-trade-card.png");
  assert.doesNotMatch(fileName, /\$|usd|3|contract|71\.25/i);
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
