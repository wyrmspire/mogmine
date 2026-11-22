import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hitTestArchivedBoxes,
  hitTestArchivedMark,
  PositionBoxPrimitive,
  type ArchivedBoxRect,
} from "../../components/PositionBoxPrimitive.ts";

describe("hitTestArchivedBoxes", () => {
  const sampleRects: ArchivedBoxRect[] = [
    { tradeId: "trade-1", x: 100, y: 50, width: 80, height: 40 },
    { tradeId: "trade-2", x: 250, y: 150, width: 100, height: 60 },
  ];

  it("returns matching tradeId when point is inside rect", () => {
    assert.equal(hitTestArchivedBoxes(140, 70, sampleRects), "trade-1");
    assert.equal(hitTestArchivedBoxes(300, 180, sampleRects), "trade-2");
  });

  it("returns matching tradeId on exact boundary edges", () => {
    // Top-left
    assert.equal(hitTestArchivedBoxes(100, 50, sampleRects), "trade-1");
    // Top-right
    assert.equal(hitTestArchivedBoxes(180, 50, sampleRects), "trade-1");
    // Bottom-left
    assert.equal(hitTestArchivedBoxes(100, 90, sampleRects), "trade-1");
    // Bottom-right
    assert.equal(hitTestArchivedBoxes(180, 90, sampleRects), "trade-1");
    // Edge centers
    assert.equal(hitTestArchivedBoxes(140, 50, sampleRects), "trade-1");
    assert.equal(hitTestArchivedBoxes(180, 70, sampleRects), "trade-1");
  });

  it("returns null for misses immediately outside the rect", () => {
    // 1px to the left
    assert.equal(hitTestArchivedBoxes(99, 70, sampleRects), null);
    // 1px to the right
    assert.equal(hitTestArchivedBoxes(181, 70, sampleRects), null);
    // 1px above
    assert.equal(hitTestArchivedBoxes(140, 49, sampleRects), null);
    // 1px below
    assert.equal(hitTestArchivedBoxes(140, 91, sampleRects), null);
    // In between two rects
    assert.equal(hitTestArchivedBoxes(200, 100, sampleRects), null);
  });

  it("prioritizes topmost (last rendered) rect when rects overlap", () => {
    const overlapping: ArchivedBoxRect[] = [
      { tradeId: "underlying-trade", x: 50, y: 50, width: 100, height: 100 },
      { tradeId: "topmost-trade", x: 80, y: 80, width: 100, height: 100 },
    ];

    // Inside underlying only (x: 60, y: 60)
    assert.equal(hitTestArchivedBoxes(60, 60, overlapping), "underlying-trade");

    // Inside topmost only (x: 160, y: 160)
    assert.equal(hitTestArchivedBoxes(160, 160, overlapping), "topmost-trade");

    // Inside intersection (x: 100, y: 100) -> topmost wins
    assert.equal(hitTestArchivedBoxes(100, 100, overlapping), "topmost-trade");
  });

  it("handles inverted / negative width and height gracefully", () => {
    const negativeDimRects: ArchivedBoxRect[] = [
      { tradeId: "neg-width", x: 150, y: 50, width: -50, height: 40 },
      { tradeId: "neg-height", x: 200, y: 100, width: 60, height: -40 },
    ];
    // For neg-width: x spans 100..150, y spans 50..90
    assert.equal(hitTestArchivedBoxes(125, 70, negativeDimRects), "neg-width");
    assert.equal(hitTestArchivedBoxes(100, 50, negativeDimRects), "neg-width");
    assert.equal(hitTestArchivedBoxes(99, 70, negativeDimRects), null);

    // For neg-height: x spans 200..260, y spans 60..100
    assert.equal(hitTestArchivedBoxes(230, 80, negativeDimRects), "neg-height");
    assert.equal(hitTestArchivedBoxes(200, 60, negativeDimRects), "neg-height");
    assert.equal(hitTestArchivedBoxes(230, 101, negativeDimRects), null);
  });

  it("supports touch tolerance expansion", () => {
    const rects: ArchivedBoxRect[] = [
      { tradeId: "touch-target", x: 100, y: 100, width: 50, height: 30 },
    ];
    // Exact miss by 4px
    assert.equal(hitTestArchivedBoxes(96, 115, rects, 0), null);
    // With 5px tolerance, 4px miss becomes a hit
    assert.equal(hitTestArchivedBoxes(96, 115, rects, 5), "touch-target");
    // With 5px tolerance, 6px miss remains a miss
    assert.equal(hitTestArchivedBoxes(94, 115, rects, 5), null);
  });

  it("ignores rects with missing or empty tradeId", () => {
    const rectsWithEmptyId: ArchivedBoxRect[] = [
      { tradeId: "", x: 50, y: 50, width: 50, height: 50 },
      { tradeId: "valid-trade", x: 120, y: 50, width: 50, height: 50 },
    ];
    assert.equal(hitTestArchivedBoxes(75, 75, rectsWithEmptyId), null);
    assert.equal(hitTestArchivedBoxes(140, 75, rectsWithEmptyId), "valid-trade");
  });

  it("handles empty arrays, null, undefined, and non-finite coordinates safely", () => {
    assert.equal(hitTestArchivedBoxes(100, 100, []), null);
    assert.equal(hitTestArchivedBoxes(100, 100, null), null);
    assert.equal(hitTestArchivedBoxes(100, 100, undefined), null);
    assert.equal(hitTestArchivedBoxes(NaN, 100, sampleRects), null);
    assert.equal(hitTestArchivedBoxes(100, NaN, sampleRects), null);
    assert.equal(hitTestArchivedBoxes(Infinity, 100, sampleRects), null);
    assert.equal(hitTestArchivedBoxes(100, -Infinity, sampleRects), null);
  });

  it("hitTestArchivedMark is an alias for hitTestArchivedBoxes", () => {
    assert.equal(hitTestArchivedMark, hitTestArchivedBoxes);
    assert.equal(hitTestArchivedMark(140, 70, sampleRects), "trade-1");
  });
});

describe("PositionBoxPrimitive hit testing methods", () => {
  it("initializes with empty archived rects and returns null on hitTest", () => {
    const primitive = new PositionBoxPrimitive();
    assert.deepEqual(primitive.getArchivedRects(), []);
    assert.equal(primitive.hitTest(100, 100), null);
    assert.equal(primitive.hitTestTradeId(100, 100), null);
  });

  it("clears archived rects on detached()", () => {
    const primitive = new PositionBoxPrimitive();
    // Simulate detachment
    primitive.detached();
    assert.deepEqual(primitive.getArchivedRects(), []);
    assert.equal(primitive.hitTest(50, 50), null);
  });
});
