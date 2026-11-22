import test from "node:test";
import assert from "node:assert/strict";
import {
  cutAtEntry, drillSkipReason, isMiss, missDueAt, missesDeck, playbookDeck, takeVsPass, warmupDeck,
} from "../drills.ts";
import type { DrillRecord } from "../drills.ts";
import type { Candle, TradeRecord } from "../trades.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-11-22T18:00:00Z");
const ago = (days: number) => new Date(now - days * DAY).toISOString();
/** A long MES trade, 1 contract, 4-point stop. `points` is the exit minus the entry. */
const trade = (id: string, over: Partial<TradeRecord> & { points?: number; days?: number } = {}): TradeRecord => {
  const { points = 4, days = 10, ...rest } = over;
  return {
    id, symbol: "MES", direction: "LONG", quantity: 1, status: "closed", is_sample: false, playbook_id: "orb",
    entry_time: ago(days), exit_time: new Date(now - days * DAY + 600_000).toISOString(),
    entry_price: 7600, exit_price: 7600 + points, stop_loss_price: 7596,
    checklist_state: [{ id: "a", label: "Stop", checked: true }], quick_tags: [],
    ...rest,
  } as TradeRecord;
};
const broken = { checklist_state: [{ id: "a", label: "Stop", checked: false }] };
const answer = (trade_id: string, a: DrillRecord["answer"], days: number): DrillRecord => ({
  id: `${trade_id}-${days}`, user_id: "demo-owner", trade_id, kind: "take_it", answer: a, answered_at: ago(days), hidden: ["bars_after_entry"],
});
const all = () => true;

test("CD-2a: only closed, real trades older than 7 days with saved bars are dealt", () => {
  assert.equal(drillSkipReason(trade("ok"), now, true), null);
  assert.equal(drillSkipReason(trade("open", { exit_time: null, exit_price: null, status: "open" }), now, true), "open");
  assert.equal(drillSkipReason(trade("demo", { is_sample: true }), now, true), "sample");
  assert.equal(drillSkipReason(trade("fresh", { days: 6.9 }), now, true), "too_recent");
  assert.equal(drillSkipReason(trade("old", { days: 40 }), now, false), "no_bars");
});

test("CD-2a: the warm-up deck is five reproducible picks and counts what it skipped", () => {
  const trades = [...Array.from({ length: 8 }, (_, i) => trade(`t${i}`)), trade("demo", { is_sample: true }), trade("nobars")];
  const hasBars = (id: string) => id !== "nobars";
  const deck = warmupDeck(trades, now, hasBars, 42);
  assert.equal(deck.trade_ids.length, 5);
  assert.equal(new Set(deck.trade_ids).size, 5);
  assert.deepEqual(warmupDeck(trades, now, hasBars, 42), deck);
  assert.deepEqual(deck.skipped, { sample: 1, no_bars: 1 });
  assert.ok(!deck.trade_ids.includes("demo"));
});

test("CD-2a: a playbook deck holds that playbook's eligible trades, oldest first", () => {
  const deck = playbookDeck([trade("new", { days: 8 }), trade("old", { days: 20 }), trade("other", { playbook_id: "fade" })], "orb", now, all);
  assert.deepEqual(deck.trade_ids, ["old", "new"]);
});

test("CD-2a: a miss is Take on a rule-breaking loser or Pass on a clean winner", () => {
  assert.equal(isMiss("take", trade("l", { points: -4, ...broken })), true);
  assert.equal(isMiss("take", trade("l2", { points: -4 })), false);  // a clean loss is a fine take
  assert.equal(isMiss("pass", trade("w", { points: 8 })), true);
  assert.equal(isMiss("pass", trade("w2", { points: 8, ...broken })), false);
  assert.equal(isMiss("smaller", trade("w3", { points: 8 })), false);
  assert.equal(isMiss("take", trade("nostop", { stop_loss_price: null })), null);
});

test("CD-2a: missed trades return after 1, 3 and 7 days, then retire until missed again", () => {
  const winner = trade("w", { points: 8, days: 30 });
  assert.equal(missDueAt(winner, [answer("w", "take", 10)]), null);
  assert.equal(missDueAt(winner, [answer("w", "pass", 10)]), now - 9 * DAY);
  assert.equal(missDueAt(winner, [answer("w", "pass", 10), answer("w", "take", 8)]), now - 5 * DAY);
  assert.equal(missDueAt(winner, [answer("w", "pass", 10), answer("w", "take", 8), answer("w", "take", 4)]), now + 3 * DAY);
  assert.equal(missDueAt(winner, [answer("w", "pass", 10), answer("w", "take", 8), answer("w", "take", 4), answer("w", "take", 1)]), null);
  // Missed again: the spacing starts over.
  assert.equal(missDueAt(winner, [answer("w", "pass", 10), answer("w", "take", 8), answer("w", "take", 4), answer("w", "take", 3), answer("w", "pass", 2)]), now - DAY);
  const deck = missesDeck([winner, trade("x", { points: 8 })], [answer("w", "pass", 10), answer("x", "pass", 0.5)], now, all);
  assert.deepEqual(deck.trade_ids, ["w"]); // x is not due until tomorrow
});

test("CD-2a: the sealed front keeps only bars that closed by the entry", () => {
  const bars = [0, 1, 2, 3].map((i): Candle => ({ time: Date.parse("2026-11-12T14:30:00Z") + i * 60_000, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  assert.deepEqual(cutAtEntry(bars, "2026-11-12T14:32:30Z", "1m").map((bar) => bar.time), [bars[0].time, bars[1].time]);
  assert.deepEqual(cutAtEntry(bars, "2026-11-12T14:32:00Z", "1m").map((bar) => bar.time), [bars[0].time, bars[1].time]);
  assert.equal(cutAtEntry(bars, "2026-11-12T14:30:00Z", "5m").length, 0);
});

test("CD-2a: take vs pass averages R over each trade's latest answer and waits for 30 answers", () => {
  const trades = [trade("a", { points: 8 }), trade("b", { points: -4 }), trade("c", { points: 4 }), trade("d", { stop_loss_price: null })];
  const records = [answer("a", "pass", 9), answer("a", "take", 8), answer("b", "take", 8), answer("c", "pass", 8), answer("d", "take", 8), answer("gone", "take", 8)];
  const score = takeVsPass(records, trades);
  assert.deepEqual(score.take, { n: 2, avgR: (2 + -1) / 2 });
  assert.deepEqual(score.pass, { n: 1, avgR: 1 });
  assert.deepEqual(score.smaller, { n: 0, avgR: null });
  assert.equal(score.noR, 1);
  assert.equal(score.ready, false);
  const many = Array.from({ length: 30 }, (_, i) => trade(`m${i}`));
  assert.equal(takeVsPass(many.map((t) => answer(t.id, "take", 8)), many).ready, true);
});
