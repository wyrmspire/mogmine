import test from "node:test";
import assert from "node:assert/strict";
import { PLAYBOOK_CARD_MIN_TRADES, playbookCardData, playbookExample } from "../playbook-card.ts";
import type { DrillRecord } from "../drills.ts";
import type { TradeRecord } from "../trades.ts";

const now = Date.parse("2026-11-22T18:00:00Z");
const playbook = { id: "orb", name: "ORB Reclaim", checklist_rules: [{ id: "a", label: "Bias set" }, { id: "b", label: "Stop placed" }] };
let n = 0;
/** Long MES, 1 contract, 4-point stop; `points` is exit minus entry. */
const trade = (over: Partial<TradeRecord> & { points?: number; day?: number; clean?: boolean } = {}): TradeRecord => {
  const { points = 4, day = 10, clean = true, ...rest } = over;
  n += 1;
  const entry = Date.parse(`2026-11-${String(day).padStart(2, "0")}T15:00:00Z`) + n * 60_000;
  return {
    id: `t${n}`, symbol: "MES", direction: "LONG", quantity: 1, status: "closed", is_sample: false, playbook_id: "orb",
    entry_time: new Date(entry).toISOString(), exit_time: new Date(entry + 300_000).toISOString(),
    entry_price: 7600, exit_price: 7600 + points, stop_loss_price: 7596, quick_tags: [], take_again: null,
    checklist_state: [{ id: "a", label: "Bias set", checked: true }, { id: "b", label: "Stop placed", checked: clean }],
    ...rest,
  } as TradeRecord;
};

test("CD-3a: the example is the latest clean blind take, else the latest clean trade, else none", () => {
  const olderTake = trade({ day: 5, take_again: "yes" });
  const newerClean = trade({ day: 9 });
  const newestBroken = trade({ day: 12, clean: false, take_again: "yes" });
  const sample = trade({ day: 13, is_sample: true, take_again: "yes" });
  assert.deepEqual(playbookExample("orb", [olderTake, newerClean, newestBroken, sample]), { trade_id: olderTake.id, basis: "clean_take" });
  assert.deepEqual(playbookExample("orb", [newerClean, newestBroken]), { trade_id: newerClean.id, basis: "clean" });
  assert.equal(playbookExample("orb", [newestBroken]), null);
  assert.equal(playbookExample("orb", [trade({ playbook_id: "fade" })]), null);
  const open = trade({ day: 14, exit_time: null, exit_price: null, status: "open", take_again: "yes" });
  assert.deepEqual(playbookExample("orb", [newerClean, open]), { trade_id: newerClean.id, basis: "clean" });
});

test("CD-3a: no rate prints below 10 trades; the count and R skips always do", () => {
  const few = [trade({ points: 8 }), trade({ points: -4 }), trade({ stop_loss_price: null })];
  const card = playbookCardData(playbook, few, [], now);
  assert.equal(card.stats.trades, 3);
  assert.equal(card.stats.belowMinimum, true);
  assert.equal(card.stats.winRate, null);
  assert.equal(card.stats.avgR, null);
  // D-A: closed priceable trades without a stop have account R; only unpriceable trades increment skippedR.
  assert.equal(card.stats.withR, 3);
  assert.equal(card.stats.skippedR, 0);
  const withUnpriceable = playbookCardData(playbook, [trade({ points: 8 }), trade({ exit_price: 7600.1 })], [], now);
  assert.equal(withUnpriceable.stats.withR, 1);
  assert.equal(withUnpriceable.stats.skippedR, 1);
  assert.deepEqual(card.rules, ["Bias set", "Stop placed"]);
});

test("CD-3a: at the minimum, win rate and average R come from the R-08a selector, samples and open trades excluded", () => {
  const ten = [
    ...Array.from({ length: 6 }, () => trade({ points: 8 })),   // +$40 ÷ $250 = +0.16R each
    ...Array.from({ length: 4 }, () => trade({ points: -4 })),  // −$20 ÷ $250 = −0.08R each
    trade({ is_sample: true, points: -40 }),
    trade({ exit_time: null, exit_price: null, status: "open" }),
  ];
  const card = playbookCardData(playbook, ten, [], now);
  assert.equal(PLAYBOOK_CARD_MIN_TRADES, 10);
  assert.equal(card.stats.trades, 10);
  assert.equal(card.stats.belowMinimum, false);
  assert.equal(card.stats.winRate, 0.6);
  assert.ok(Math.abs((card.stats.avgR ?? NaN) - 0.064) < 1e-12);
});

test("CD-3a: the drill result counts only this playbook's real trades", () => {
  const mine = trade({ points: 8 });
  const other = trade({ playbook_id: "fade", points: -4 });
  const answer = (trade_id: string): DrillRecord => ({ id: `d-${trade_id}`, user_id: "demo-owner", trade_id, kind: "take_it", answer: "take", answered_at: "2026-11-21T10:00:00Z", hidden: [] });
  const card = playbookCardData(playbook, [mine, other], [answer(mine.id), answer(other.id)], now);
  assert.deepEqual(card.drill.take, { n: 1, avgR: 0.16 });
});
