import test from "node:test";
import assert from "node:assert/strict";
import { dayTradeCounts, formatDayTradeHeader, formatReviewQueueSummary } from "../day-counts.ts";
import type { TradeRecord } from "../trades.ts";

const trade = (id: string, entry_time: string, exit_time: string | null, over: Partial<TradeRecord> = {}) =>
  ({ id, symbol: "MES", entry_time, exit_time, is_sample: false, ...over }) as TradeRecord;

// 2026-11-23 is a Monday; sessions run 18:00 ET prior day to 17:00 ET (EST, UTC-5).
const DAY = "2026-11-23";

test("UX-A: an open trade entered today reads as 1 trade today, 0 closed, not 0 trades", () => {
  const counts = dayTradeCounts([trade("open", "2026-11-23T15:00:00Z", null)], DAY);
  assert.deepEqual(counts, { entered: 1, closed: 0, openEntered: 1 });
  assert.equal(formatDayTradeHeader(counts, false), "1 trade today (0 closed)");
});

test("UX-A: three trades entered and closed today read as 3 trades today", () => {
  const counts = dayTradeCounts([
    trade("a", "2026-11-23T14:00:00Z", "2026-11-23T14:30:00Z"),
    trade("b", "2026-11-23T15:00:00Z", "2026-11-23T15:20:00Z"),
    trade("c", "2026-11-23T16:00:00Z", "2026-11-23T16:10:00Z"),
  ], DAY);
  assert.deepEqual(counts, { entered: 3, closed: 3, openEntered: 0 });
  assert.equal(formatDayTradeHeader(counts, false), "3 trades today");
});

test("UX-A: an overnight trade entered yesterday and closed today counts as closed only", () => {
  // Entered Friday 11/20 (session 11/20), still open into Monday, closed Monday 11/23.
  const counts = dayTradeCounts([trade("night", "2026-11-20T15:00:00Z", "2026-11-23T14:00:00Z")], DAY);
  assert.deepEqual(counts, { entered: 0, closed: 1, openEntered: 0 });
  assert.equal(formatDayTradeHeader(counts, false), "0 trades today (1 closed)");
});

test("UX-A: sample trades are dropped when the day has real trades, kept when it does not", () => {
  const real = trade("real", "2026-11-23T15:00:00Z", "2026-11-23T15:30:00Z");
  const sample = trade("sample", "2026-11-23T16:00:00Z", "2026-11-23T16:30:00Z", { is_sample: true });
  assert.equal(dayTradeCounts([real, sample], DAY).entered, 1);
  assert.equal(dayTradeCounts([sample], DAY).entered, 1);
});

test("UX-A: a weekend with no trades says the market is closed; an open weekday says no trades yet", () => {
  const empty = dayTradeCounts([], "2026-11-21");
  assert.equal(formatDayTradeHeader(empty, true), "Markets are closed for the weekend.");
  assert.equal(formatDayTradeHeader(dayTradeCounts([], DAY), false), "No trades yet today");
});

test("UX-A: review queue wording counts to review and needs tags", () => {
  assert.equal(formatReviewQueueSummary(12, 1), "12 to review · 1 needs tags");
  assert.equal(formatReviewQueueSummary(5, 0), "5 to review");
  assert.equal(formatReviewQueueSummary(3, 2), "3 to review · 2 need tags");
  assert.equal(formatReviewQueueSummary(0, 0), "");
});
