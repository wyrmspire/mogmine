import assert from "node:assert/strict";
import { test } from "node:test";
import { MERGE_TICKS } from "../chart-levels.ts";
import type { LevelLine, LevelPill } from "../chart-levels.ts";
import { AXIS_TAG_MAX, LEVEL_HIT_TOLERANCE_PX, hitLevel, resolveTapAction, selectAxisTagGroups } from "../level-hit-test.ts";
import type { LevelZone } from "../level-hit-test.ts";

const line = (price: number, label: string, role: LevelLine["role"] = "neutral", extra: Partial<LevelLine> = {}): LevelLine => ({
  price, price_ticks: Math.round(price * 4), role, label: `${price.toFixed(2)} ${label}`, names: label, keys: [label],
  proxy: false, startAt: null, ...extra,
});

const pill = (price: number, label: string, tone: LevelPill["tone"] = null): LevelPill => ({
  price, label, role: "neutral", tone, rank: 0, lineTicks: [Math.round(price * 4)],
});

// Linear scale: 10 px per point, 7400 at y = 0.
const linear = (price: number) => (7400 - price) * 10;

test("the group tolerance matches the right-edge merge (MERGE_TICKS)", () => {
  assert.equal(LEVEL_HIT_TOLERANCE_PX, 10);
  assert.equal(MERGE_TICKS, 4);
});

test("selectAxisTagGroups drops trade-anchor pills and keeps the three groups nearest entry", () => {
  const pills = [
    pill(7450, "far above"),
    pill(7405.00, "Entry 7405.00", "entry"),
    pill(7404.00, "Stop 7404.00", "risk"),
    pill(7412.00, "near above"),
    pill(7399.00, "near below"),
    pill(7396.00, "further below"),
    pill(7430.00, "above"),
  ];
  const picked = selectAxisTagGroups(pills, 7405, 3);
  // Distances from 7405: near below 6, near above 7, further below 9.
  assert.deepEqual(picked.map((p) => p.label), ["near below", "near above", "further below"]);
  assert.ok(picked.every((p) => p.tone == null));
  assert.equal(selectAxisTagGroups(pills, 7405).length, AXIS_TAG_MAX);
  assert.equal(selectAxisTagGroups([pill(7405, "Entry", "entry")], 7405).length, 0);
  assert.equal(selectAxisTagGroups(pills, 7405, 0).length, 0);
});

test("a tap 8 px from a ray hits it and returns every merged member", () => {
  const pdc = line(7340.75, "PDC", "neutral", { settlement: true });
  const globex = line(7341.00, "Globex open");
  const far = line(7360, "PDH", "resistance");
  const hit = hitLevel([pdc, globex, far], [], { x: 50, y: linear(7340.75) + 8 }, { priceToY: linear });
  assert.ok(hit);
  assert.equal(hit.kind, "group");
  assert.equal(hit.price, 7340.75);
  assert.deepEqual(hit.lines.map((l) => l.names).sort(), ["Globex open", "PDC"]);
  assert.equal(hit.y, linear(7340.75));
  assert.equal(hit.x, 50);
});

test("a tap 11 px from the nearest ray misses", () => {
  const lines = [line(7340.75, "PDC")];
  assert.equal(hitLevel(lines, [], { x: 50, y: linear(7340.75) + 11 }, { priceToY: linear }), null);
  assert.equal(hitLevel(lines, [], { x: 50, y: linear(7340.75) + 10 }, { priceToY: linear })?.price, 7340.75);
});

test("with two rays 8 px apart, the nearer ray wins", () => {
  const yOf = new Map<number, number>([[7000, 100], [7002, 108]]);
  const project = { priceToY: (price: number) => yOf.get(price) ?? null };
  const hit = hitLevel([line(7000, "Low"), line(7002, "High")], [], { x: 10, y: 105 }, project);
  assert.ok(hit);
  assert.equal(hit.price, 7002, "y=108 is 3 px away, y=100 is 5 px away");
  assert.equal(hit.y, 108);
  assert.deepEqual(hit.lines.map((l) => l.names), ["High"]);
});

test("a tap left of a ray's start misses; a tap inside its span hits", () => {
  const starts = line(7000, "ORB", "neutral", { startAt: 1 });
  const project = {
    priceToY: () => 100,
    raySpanX: () => ({ x0: 200, x1: 400 }),
  };
  assert.equal(hitLevel([starts], [], { x: 150, y: 100 }, project), null);
  assert.equal(hitLevel([starts], [], { x: 401, y: 100 }, project), null);
  assert.equal(hitLevel([starts], [], { x: 250, y: 100 }, project)?.price, 7000);
  // A ray that is not drawn at all (no span) cannot be hit.
  assert.equal(hitLevel([starts], [], { x: 250, y: 100 }, { priceToY: () => 100, raySpanX: () => null }), null);
});

test("a tap inside a zone band with no ray in range hits the zone", () => {
  const zone: LevelZone = { id: "z1", label: "Supply", priceLow: 7300, priceHigh: 7320, role: "resistance" };
  const inside = line(7310, "PDH");
  const outside = line(7400, "Far");
  const hit = hitLevel([inside, outside], [zone], { x: 80, y: linear(7305) }, { priceToY: linear });
  assert.ok(hit);
  assert.equal(hit.kind, "zone");
  assert.equal(hit.zone, zone);
  assert.deepEqual(hit.lines.map((l) => l.price), [7310]);
  assert.equal(hitLevel([inside, outside], [zone], { x: 80, y: linear(7250) }, { priceToY: linear }), null);
});

test("a ray within tolerance beats a zone at the same tap", () => {
  const zone: LevelZone = { id: "z1", label: "Supply", priceLow: 7300, priceHigh: 7320, role: "resistance" };
  const hit = hitLevel([line(7310, "PDH")], [zone], { x: 80, y: linear(7310) + 2 }, { priceToY: linear });
  assert.equal(hit?.kind, "group");
});

test("resolveTapAction: a neighbour box at the tap takes precedence over a level ray", () => {
  const levelHit = hitLevel([line(7340.75, "PDC")], [], { x: 50, y: linear(7340.75) }, { priceToY: linear });
  assert.ok(levelHit);
  assert.deepEqual(resolveTapAction("trade-40", levelHit), { kind: "neighbour", tradeId: "trade-40" });
  assert.deepEqual(resolveTapAction(null, levelHit), { kind: "level", hit: levelHit });
  assert.deepEqual(resolveTapAction(null, null), { kind: "dismiss" });
  assert.deepEqual(resolveTapAction("trade-40", null), { kind: "neighbour", tradeId: "trade-40" });
});
