// UX-E4 (docs/design-2026-11-24/08 §2 F-9, §4.3, §7.3): export sizing, snapshot placement, high-quality card draw,
// and the TradeChart export wiring that toggles export mode and restores host size and view in `finally`.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  EXPORT_MIN_BITMAP_WIDTH,
  computeExportDimensions,
  computeSnapshotDrawBox,
} from "../chart-export.ts";
import { renderCardCanvas } from "../shareCard.ts";
import type { TradeRecord } from "../trades.ts";

const ROOT = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf-8");
const chart = read("components/TradeChart.tsx");

test("EXPORT_MIN_BITMAP_WIDTH is 1200 px (4:5 at 1080 and 16:9 at 1920 never upscale below it)", () => {
  assert.equal(EXPORT_MIN_BITMAP_WIDTH, 1200);
});

test("computeExportDimensions resizes a DPR-1 host to a crisp 2x-3x bitmap without upscaling", () => {
  // 390 px at DPR 1 -> ceil(1200/390) = 4, clamped to 3x: 1170 px wide.
  assert.deepEqual(computeExportDimensions(390, 320, 1), { resize: true, width: 1170, height: 960 });
  // 800 px at DPR 1 -> exactly 2x: 1600 x 1000.
  assert.deepEqual(computeExportDimensions(800, 500, 1), { resize: true, width: 1600, height: 1000 });
  // 390 px at DPR 3 -> 1170 device px is under 1200, so 2x CSS: 780 x 640.
  assert.deepEqual(computeExportDimensions(390, 320, 3), { resize: true, width: 780, height: 640 });
  // 700 px at DPR 2 -> 1400 device px already >= 1200: no resize.
  assert.deepEqual(computeExportDimensions(700, 450, 2), { resize: false, width: 700, height: 450 });
});

test("computeExportDimensions preserves the host aspect ratio and clamps the factor to [2, 3]", () => {
  const dims = computeExportDimensions(500, 333, 1);
  assert.equal(dims.resize, true);
  assert.equal(dims.height / dims.width, 333 / 500);
  // A very small host still gets at least 2x and never more than 3x.
  assert.equal(computeExportDimensions(100, 100, 1).width, 300);
  assert.equal(computeExportDimensions(1000, 800, 1).width, 2000);
  assert.equal(computeExportDimensions(1000, 800, 1).resize, true);
});

test("computeExportDimensions passes through a zero or negative host and honours a custom minimum", () => {
  assert.deepEqual(computeExportDimensions(0, 320, 1), { resize: false, width: 0, height: 320 });
  assert.deepEqual(computeExportDimensions(390, -1, 1), { resize: false, width: 390, height: -1 });
  assert.deepEqual(computeExportDimensions(400, 300, 1, 400), { resize: false, width: 400, height: 300 });
});

test("computeSnapshotDrawBox keeps the aspect ratio and centres the snapshot in the available box", () => {
  // 1200x900 snapshot in a 600x600 box: scale 0.5 -> 600x450, centred vertically.
  assert.deepEqual(computeSnapshotDrawBox(10, 20, 600, 600, 1200, 900), { dx: 10, dy: 95, dw: 600, dh: 450 });
  // Tall snapshot in a wide box: height-limited and centred horizontally.
  assert.deepEqual(computeSnapshotDrawBox(0, 0, 900, 300, 300, 300), { dx: 300, dy: 0, dw: 300, dh: 300 });
  assert.deepEqual(computeSnapshotDrawBox(5, 5, 100, 100, 0, 50), { dx: 5, dy: 5, dw: 0, dh: 0 });
});

interface CtxLog { log: string[] }

// A recording stand-in for CanvasRenderingContext2D: logs every property write and method call, in order.
function recordingCtx(): { ctx: CanvasRenderingContext2D; out: CtxLog } {
  const out: CtxLog = { log: [] };
  const stub = (name: string): unknown => new Proxy(function () {}, {
    get: (_target, prop) => (prop === "width" ? 10 : typeof prop === "symbol" ? undefined : stub(`${name}.${String(prop)}`)),
    apply: () => { out.log.push(`${name}()`); return stub(name); },
    set: (_target, prop, value) => { out.log.push(`${name}.${String(prop)}=${typeof value === "string" || typeof value === "boolean" ? String(value) : "obj"}`); return true; },
  });
  return { ctx: stub("ctx") as CanvasRenderingContext2D, out };
}

const trade = {
  id: "trade-export-1", user_id: "default-user", account_id: "acc-1", symbol: "MES", yahoo_ticker: "MES=F",
  direction: "LONG", quantity: 3, entry_time: "2026-11-10T15:43:00.000Z", exit_time: "2026-11-10T15:45:00.000Z",
  entry_price: 5980.25, exit_price: 5985, stop_loss_price: 5977.25, planned_target_price: 5990,
  initial_stop_price: 5977.25, initial_stop_set_at: "2026-11-10T15:43:00.000Z", key_level_price: null,
  note: "Followed the ORB reclaim cleanly.", playbook_id: "pb-orb-reclaim", quick_tags: [], checklist_state: [],
  is_sample: false, trade_style: "scalp", status: "closed", review_status: "tagged", pre_trade_thesis: "",
  management_notes: "", post_exit_notes: "", flagged: false, sparkline: [5980, 5985], take_again: null, take_again_at: null,
} as unknown as TradeRecord;

test("renderCardCanvas draws the snapshot inside save/restore with high-quality smoothing (F-9)", () => {
  const { ctx, out } = recordingCtx();
  const snapshot = { width: 1200, height: 900 } as unknown as CanvasImageSource & { width: number; height: number };
  renderCardCanvas(ctx, snapshot, trade, "America/Chicago", true, null, { size: "4:5" });
  const draw = out.log.indexOf("ctx.drawImage()");
  assert.ok(draw > 0, "front side draws the chart snapshot");
  const quality = out.log.indexOf("ctx.imageSmoothingQuality=high");
  const enabled = out.log.indexOf("ctx.imageSmoothingEnabled=true");
  const save = out.log.lastIndexOf("ctx.save()", draw);
  const restore = out.log.indexOf("ctx.restore()", draw);
  assert.ok(quality > save && quality < draw, "imageSmoothingQuality is set after save and before drawImage");
  assert.ok(enabled > save && enabled < draw, "imageSmoothingEnabled is set before drawImage");
  assert.ok(restore > draw, "restore follows drawImage");
});

test("TradeChart screenshot() toggles export mode around takeScreenshot and restores in finally (UX-E4 + D-E)", () => {
  const start = chart.indexOf("screenshot: () => {");
  assert.ok(start >= 0, "screenshot() exists");
  const body = chart.slice(start, chart.indexOf("}), []);", start));
  const toggleOn = body.indexOf("l.primitive.setExportMode(true);");
  const tryAt = body.indexOf("try {");
  const shot = body.indexOf("return l.chart.takeScreenshot(true, false);", tryAt);
  const finallyAt = body.indexOf("} finally {");
  assert.ok(toggleOn > 0 && toggleOn < tryAt, "export mode is on before the try block");
  assert.ok(tryAt < shot && shot < finallyAt, "takeScreenshot runs inside try");
  const fin = body.slice(finallyAt);
  assert.match(fin, /l\.primitive\.setExportMode\(false\);/);
  assert.match(fin, /sizeForExport\(l, l\.host\.clientWidth, l\.host\.clientHeight, view\)/);
  assert.match(fin, /paintLevels\(l, paint, "tap", livePills\);/);
  assert.match(body, /computeExportDimensions\(l\.host\.clientWidth, l\.host\.clientHeight, window\.devicePixelRatio \|\| 1\)/);
});
