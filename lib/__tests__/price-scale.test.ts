// docs/20 §3: dragging the price axis stretches or compresses the price scale.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOUBLE_TAP_MS, MAX_SPAN_TICKS, MIN_SPAN_TICKS, STRETCH_DEAD_ZONE_PX, STRETCH_PER_PANE, isDoubleTap, stretchPriceRange, wheelToDragPx } from "../price-scale.ts";

const start = { from: 6800, to: 6840 }; // 40 points, centre 6820
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

test("drag down compresses (wider span), drag up stretches (narrower), centre stays", () => {
  const down = stretchPriceRange(start, 150, 300, 0.25);
  const up = stretchPriceRange(start, -150, 300, 0.25);
  close(down.to - down.from, 40 * Math.exp(STRETCH_PER_PANE / 2));
  close(up.to - up.from, 40 * Math.exp(-STRETCH_PER_PANE / 2));
  close((down.from + down.to) / 2, 6820);
  close((up.from + up.to) / 2, 6820);
});

test("up then back down by the same distance returns to the start span", () => {
  const up = stretchPriceRange(start, -90, 300, 0.25);
  const back = stretchPriceRange(up, 90, 300, 0.25);
  close(back.to - back.from, 40);
});

test("a drag inside the dead zone is a tap: nothing changes", () => {
  assert.deepEqual(stretchPriceRange(start, STRETCH_DEAD_ZONE_PX - 1, 300, 0.25), start);
});

test("the span is clamped to the min and max tick spans", () => {
  const tight = stretchPriceRange(start, -100_000, 300, 0.25);
  close(tight.to - tight.from, MIN_SPAN_TICKS * 0.25);
  const wide = stretchPriceRange(start, 100_000, 300, 0.25);
  close(wide.to - wide.from, MAX_SPAN_TICKS * 0.25);
});

test("bad input returns the start range", () => {
  assert.deepEqual(stretchPriceRange(start, Number.NaN, 300, 0.25), start);
  assert.deepEqual(stretchPriceRange({ from: 10, to: 10 }, 50, 300, 0.25), { from: 10, to: 10 });
  assert.deepEqual(stretchPriceRange(start, 50, 300, 0), start);
  // A zero-height pane does not divide by zero.
  assert.ok(Number.isFinite(stretchPriceRange(start, 50, 0, 0.25).to));
});

test("wheel notches act like a short drag", () => {
  assert.equal(wheelToDragPx(100), 30);
  assert.equal(wheelToDragPx(Number.NaN), 0);
});

test("double tap: close in time and place", () => {
  const first = { time: 1000, x: 10, y: 100 };
  assert.equal(isDoubleTap(null, first), false);
  assert.equal(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS - 1, x: 14, y: 108 }), true);
  assert.equal(isDoubleTap(first, { time: 1000 + DOUBLE_TAP_MS + 1, x: 10, y: 100 }), false);
  assert.equal(isDoubleTap(first, { time: 1100, x: 10, y: 160 }), false);
  assert.equal(isDoubleTap(first, { time: 900, x: 10, y: 100 }), false);
});
