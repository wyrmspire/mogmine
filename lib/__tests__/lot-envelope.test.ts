import assert from "node:assert/strict";
import { test } from "node:test";
import { subtractRects } from "../chart-paint.ts";
import type { PaintRect } from "../chart-paint.ts";
import { buildActualLotEnvelopes, LOT_SEPARATOR_ALPHA } from "../lot-envelope.ts";
import type { ActualLotZone } from "../lot-envelope.ts";

// Builds a lot the way PositionBoxPrimitive does: the rect spans the entry and exit y, and x is the lot's time span.
const lot = (tone: ActualLotZone["tone"], x0: number, x1: number, y0: number, y1: number, extra: Partial<ActualLotZone> = {}): ActualLotZone => ({
  tone, rect: { x: x0, y: Math.min(y0, y1), width: x1 - x0, height: Math.abs(y1 - y0) }, y0, y1, ...extra,
});

const contains = (r: PaintRect, px: number, py: number) => px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;

test("single lot: one envelope with the exact rect, entry/far prices and an outer edge only", () => {
  const zone = lot("profit", 100, 160, 200, 190, { opacityMultiplier: 0.33 });
  const [envelope, ...rest] = buildActualLotEnvelopes([zone]);
  assert.equal(rest.length, 0);
  assert.deepEqual(envelope.rect, zone.rect);
  assert.deepEqual(envelope.slices, [zone.rect]);
  assert.equal(envelope.entryY, 200);
  assert.equal(envelope.farY, 190);
  assert.equal(envelope.opacityMultiplier, 0.33, "a lone partial lot keeps its qty / max strength");
  assert.deepEqual(envelope.farEdges, [{ y: 190, x0: 100, x1: 160, alpha: 0.9 }]);
  assert.deepEqual(envelope.separators, []);
});

test("3-lot scale-out: non-overlapping slices, one gradient, far-edge rule and 2 interior separators", () => {
  // Entry at y 200. Exits at +10, +20 and +30 pts (y 190, 180, 170). Lots overlap in time at 140–160 and 200–220.
  const lots = [
    lot("profit", 100, 160, 200, 190, { opacityMultiplier: 0.33 }),
    lot("profit", 140, 220, 200, 180, { opacityMultiplier: 0.33 }),
    lot("profit", 200, 260, 200, 170, { opacityMultiplier: 0.33 }),
  ];
  const [envelope, ...rest] = buildActualLotEnvelopes(lots);
  assert.equal(rest.length, 0);
  assert.equal(envelope.lots, 3);

  // Every point of the grid inside the union belongs to at most one slice, and every lot point is covered.
  let covered = 0;
  for (let px = 95; px < 265; px++) {
    for (let py = 165; py < 205; py++) {
      const hits = envelope.slices.filter((slice) => contains(slice, px, py)).length;
      assert.ok(hits <= 1, `point ${px},${py} is in ${hits} slices`);
      if (hits === 1) covered++;
      const inLot = lots.some((zone) => contains(zone.rect, px, py));
      assert.equal(hits === 1, inLot, `point ${px},${py} coverage differs from the lots`);
    }
  }
  assert.ok(covered > 0);

  // One continuous gradient across the group, full strength, no per-lot step.
  assert.equal(envelope.entryY, 200);
  assert.equal(envelope.farY, 170);
  assert.equal(envelope.opacityMultiplier, 1);

  assert.deepEqual(envelope.farEdges, [{ y: 170, x0: 200, x1: 260, alpha: 0.9 }]);
  assert.equal(envelope.separators.length, 2);
  assert.deepEqual(
    envelope.separators.map((seg) => seg.y).sort((a, b) => b - a),
    [190, 180],
  );
  assert.deepEqual(envelope.separators.find((seg) => seg.y === 190), { y: 190, x0: 100, x1: 160, alpha: LOT_SEPARATOR_ALPHA });
  assert.equal(LOT_SEPARATOR_ALPHA, 0.65);
});

test("profit and risk lots on opposite sides of entry stay in separate tone envelopes", () => {
  const envelopes = buildActualLotEnvelopes([
    lot("profit", 100, 160, 200, 190),
    lot("risk", 120, 180, 200, 210),
    lot("profit", 160, 220, 200, 185),
  ]);
  assert.equal(envelopes.length, 2);
  const profit = envelopes.find((envelope) => envelope.tone === "profit");
  const risk = envelopes.find((envelope) => envelope.tone === "risk");
  assert.ok(profit && risk);
  assert.equal(profit.lots, 2);
  assert.equal(risk.lots, 1);
  assert.ok(profit.slices.every((slice) => slice.y + slice.height <= 200), "profit stays above entry");
  assert.ok(risk.slices.every((slice) => slice.y >= 200), "risk stays below entry");
});

test("same-tone lots with a gap of more than 1 px are separate envelopes; a 1 px touch merges", () => {
  assert.equal(buildActualLotEnvelopes([lot("profit", 100, 160, 200, 190), lot("profit", 163, 220, 200, 190)]).length, 2);
  assert.equal(buildActualLotEnvelopes([lot("profit", 100, 160, 200, 190), lot("profit", 161, 220, 200, 190)]).length, 1);
});

test("subtractRects against the envelope slices leaves no plan-under-actual overlap", () => {
  const envelopes = buildActualLotEnvelopes([
    lot("profit", 100, 160, 200, 190),
    lot("profit", 140, 220, 200, 180),
    lot("profit", 200, 260, 200, 170),
  ]);
  const actualRects = envelopes.flatMap((envelope) => envelope.slices);
  const plan: PaintRect = { x: 80, y: 150, width: 200, height: 80 };
  const pieces = subtractRects(plan, actualRects);
  for (let px = 80; px < 280; px++) {
    for (let py = 150; py < 230; py++) {
      const inPlan = contains(plan, px, py);
      const inPiece = pieces.filter((piece) => contains(piece, px, py)).length;
      const inActual = actualRects.some((rect) => contains(rect, px, py));
      assert.ok(inPiece <= 1);
      if (inActual) assert.equal(inPiece, 0, `plan fill under actual at ${px},${py}`);
      else assert.equal(inPiece, inPlan ? 1 : 0, `plan fill missing at ${px},${py}`);
    }
  }
});
