import assert from "node:assert/strict";
import { test } from "node:test";
import { levelLines, levelPills, levelsSummary, MERGE_TICKS, tradeAnchors } from "../chart-levels.ts";
import type { LineSource } from "../chart-levels.ts";
import { layoutPills } from "../label-stack.ts";

const source = (key: string, type: LineSource["type"], price: number, label: string): LineSource => ({
  key, type, price, price_ticks: Math.round(price * 4), label,
});

// sim-trade-20261119-a: short 7405, 2 lots, initial stop 7444, trailed to 7350 (field notes, 2026-11-23).
const thursday: LineSource[] = [
  source("onh", "onh", 7440.75, "ONH"),
  source("plan:p:a", "planned", 7400, "Round 7400"),
  source("pdh", "pdh", 7389.75, "PDH"),
  source("rth_high", "rth_high", 7389, "RTH high"),
  source("rth_open", "rth_open", 7371.5, "RTH open"),
  source("globex_open", "globex_open", 7341, "Globex open"),
  source("plan:p:b", "planned", 7340.75, "PDC"),
  source("rth_close", "rth_close", 7340, "3 PM close"),
  source("rth_low", "rth_low", 7305.25, "RTH low"),
  source("pdl", "pdl", 7305.25, "PDL"),
  source("plan:p:c", "planned", 7300, "Round 7300"),
];
const trade = {
  symbol: "MES", entry_price: 7405, stop_loss_price: 7350, initial_stop_price: 7444,
  planned_target_price: 7300, key_level_price: 7389.75,
};
const lines = levelLines(thursday, 7405, "MES");

test("the merge window is a few ticks of the instrument: 1.00 pt on MES", () => {
  assert.equal(MERGE_TICKS, 4);
});

test("PDC, 3 PM close and Globex open within a point share one pill; the planned level gives the price", () => {
  const pills = levelPills(lines, [], "MES", 7405);
  const cluster = pills.filter((pill) => pill.label.includes("3 PM close"));
  assert.equal(cluster.length, 1);
  assert.equal(cluster[0].price, 7340.75);
  assert.equal(cluster[0].label, "7340.75 PDC · Globex open · 3 PM close");
  assert.deepEqual(cluster[0].lineTicks.sort(), [7340 * 4, 7340.75 * 4, 7341 * 4].sort());
  // Same-tick members still join with " / " (LV-09).
  assert.ok(pills.some((pill) => pill.label === "7305.25 RTH low / PDL"));
  // 7305.25 and 7300 are 21 ticks apart: two pills.
  assert.ok(pills.some((pill) => pill.label === "7300.00 Round 7300"));
});

test("the trade's own prices come first and absorb levels a few ticks away", () => {
  const anchors = tradeAnchors(trade);
  assert.deepEqual(anchors.map((anchor) => anchor.label), ["Key", "Entry", "SL", "Initial SL", "TP"]);
  const pills = levelPills(lines, anchors, "MES", 7405);
  const key = pills.find((pill) => pill.tone === "key")!;
  assert.equal(key.rank, 0);
  // PDH 7389.75 and RTH high 7389 sit within 4 ticks of the key level.
  assert.equal(key.label, "Key 7389.75 · PDH · RTH high");
  const tp = pills.find((pill) => pill.tone === "profit")!;
  assert.match(tp.label, /^TP 7300\.00 · Round 7300/);
  const ranks = pills.map((pill) => pill.rank);
  const planned = pills.find((pill) => pill.label.includes("Round 7400"))!;
  const computed = pills.find((pill) => pill.label.includes("RTH open"))!;
  assert.ok(Math.max(...ranks.slice(0, anchors.length)) < planned.rank);
  assert.ok(planned.rank < computed.rank);
});

test("no initial-stop tag when the stop never moved", () => {
  assert.deepEqual(tradeAnchors({ ...trade, initial_stop_price: 7350 }).map((anchor) => anchor.label), ["Key", "Entry", "SL", "TP"]);
});

test("the summary lists every level with its exact price", () => {
  const summary = levelsSummary(lines);
  for (const price of ["7440.75", "7341.00", "7340.75", "7340.00", "7305.25"]) assert.ok(summary.includes(price), price);
});

test("pills never overlap, keep the cap and stay near their price", () => {
  // 10 pills wanted within 120 px of a 300 px pane (≈140 pts on a phone).
  const slots = Array.from({ length: 10 }, (_, index) => ({ y: 100 + index * 12, rank: index }));
  const placed = layoutPills(slots, 17, 0, 300);
  const kept = placed.flatMap((y, index) => (y == null ? [] : [{ y, index }]));
  assert.ok(kept.length <= 8);
  const sorted = kept.map(({ y }) => y).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 17 - 1e-9);
  for (const { y, index } of kept) assert.ok(Math.abs(y - slots[index].y) <= 17 * 2.5 + 1e-9);
  // The most important pill always keeps its place.
  assert.equal(placed[0] != null, true);
});

test("the least important crowded pill is dropped first, not a distant one", () => {
  const slots = [
    { y: 150, rank: 0 }, { y: 151, rank: 5 }, { y: 152, rank: 6 }, { y: 153, rank: 7 }, { y: 154, rank: 8 },
    { y: 20, rank: 9 },
  ];
  const placed = layoutPills(slots, 17, 0, 300, { maxShift: 20 });
  assert.equal(placed[5], 20);
  assert.equal(placed[0] != null, true);
  assert.equal(placed[4], null);
});

test("re-laid out when the pane resizes: a taller pane keeps more pills", () => {
  const slots = Array.from({ length: 10 }, (_, index) => ({ y: 20 + index * 25, rank: index }));
  const short = layoutPills(slots.map((slot) => ({ ...slot, y: slot.y * 0.5 })), 17, 0, 150).filter((y) => y != null).length;
  const tall = layoutPills(slots, 17, 0, 300).filter((y) => y != null).length;
  assert.ok(short < tall);
});

test("offscreen pills are dropped, never pinned to the edge", () => {
  assert.deepEqual(layoutPills([{ y: -5, rank: 0 }, { y: 50, rank: 1 }], 17, 0, 300), [null, 50]);
});
