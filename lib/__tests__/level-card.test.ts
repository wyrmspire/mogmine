// LB-B2 (docs/03 §3 LB-6/LB-7, D-E): unit tests for pure level-card helpers (`lib/level-card.ts`) plus
// DOM/wiring assertions verifying `LevelCard` stays outside the `lightweight-charts` canvas.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { LevelLine } from "../chart-levels.ts";
import type { LevelPill } from "../level-pills.ts";
import {
  EXPORT_LEVEL_GROUPS, LEVEL_CARD_DISMISS_MS, LEVEL_CARD_EDGE_PX, LEVEL_CARD_HUD_PX,
  clampPopoverPosition, formatLevelCardData, levelHitForTick, selectExportLevelPills,
} from "../level-card.ts";

const ROOT = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf-8");

const card = read("components/LevelCard.tsx");
const chart = read("components/TradeChart.tsx");
const detail = read("components/TradeDetail.tsx");
const layout = read("app/layout.tsx");
const css = read("app/levels.css");
const globals = read("app/globals.css");

function makeLine(over: Partial<LevelLine> & Pick<LevelLine, "price" | "price_ticks" | "names" | "keys">): LevelLine {
  return {
    role: "neutral",
    label: `${over.price.toFixed(2)} ${over.names}`,
    proxy: false,
    startAt: null,
    ...over,
  };
}

function makePill(over: Partial<LevelPill> & Pick<LevelPill, "price" | "label" | "role">): LevelPill {
  return {
    tone: null,
    rank: 1,
    lineTicks: [Math.round(over.price * 4)],
    ...over,
  };
}

test("formatLevelCardData formats merged members with tabular prices, source, and proxy tags", () => {
  const lines: LevelLine[] = [
    makeLine({ price: 7340.75, price_ticks: 29363, names: "PDC / 3 PM close", keys: ["pdc", "close_3pm"], proxy: true }),
    makeLine({ price: 7341.0, price_ticks: 29364, names: "Globex open", keys: ["plan:p1:l1"] }),
    makeLine({ price: 7341.25, price_ticks: 29365, names: "PDH / Key resistance", keys: ["pdh", "plan:p1:l2"] }),
  ];
  const view = formatLevelCardData({ kind: "group", price: 7340.75, x: 100, y: 120, lines }, "MES");
  assert.equal(view.title, "Session level");
  assert.equal(view.price, "7340.75");
  assert.deepEqual(view.members, [
    { name: "PDC · 3 PM close", price: "7340.75", source: "computed", tag: "proxy" },
    { name: "Globex open", price: "7341.00", source: "planned", tag: null },
    { name: "PDH · Key resistance", price: "7341.25", source: "planned + computed", tag: null },
  ]);
});

test("clampPopoverPosition keeps the card inside [4, width-card-4] and clear of the 32px HUD at 390x844", () => {
  const frame = { width: 390, height: 340 };
  const size = { width: 220, height: 96 };

  // Tap near top-left: kept >= 4px from left and >= 32px below top HUD.
  const topLeft = clampPopoverPosition({ x: -20, y: 8 }, size, frame);
  assert.equal(topLeft.left, LEVEL_CARD_EDGE_PX);
  assert.equal(topLeft.top, LEVEL_CARD_HUD_PX);

  // Tap near bottom-right: clamped to right & bottom edges with 4px inset.
  const bottomRight = clampPopoverPosition({ x: 388, y: 338 }, size, frame);
  assert.equal(bottomRight.left, frame.width - size.width - LEVEL_CARD_EDGE_PX);
  assert.equal(bottomRight.top, frame.height - size.height - LEVEL_CARD_EDGE_PX);
});

test("selectExportLevelPills caps output at <= 4 groups, prioritizes key_level_price, and excludes entry/stop/target (D-E)", () => {
  const pills: LevelPill[] = [
    makePill({ price: 7350, label: "Entry 7350.00", role: "neutral", tone: "entry" }),
    makePill({ price: 7345, label: "Stop 7345.00", role: "support", tone: "risk" }),
    makePill({ price: 7365, label: "Target 7365.00", role: "resistance", tone: "profit" }),
    makePill({ price: 7400, label: "Key 7400.00", role: "resistance", tone: "key" }),
    makePill({ price: 7390, label: "ADR High 7390.00", role: "resistance" }),
    makePill({ price: 7352, label: "VWAP 7352.00", role: "neutral" }),
    makePill({ price: 7348, label: "ONL 7348.00", role: "support" }),
    makePill({ price: 7360, label: "PDH 7360.00", role: "resistance" }),
    makePill({ price: 7330, label: "PDL 7330.00", role: "support" }),
  ];
  const exported = selectExportLevelPills(pills, 7350, 7400);
  assert.equal(exported.length, EXPORT_LEVEL_GROUPS);
  assert.deepEqual(exported.map((pill) => pill.price), [7400, 7352, 7348, 7360]);
  assert.equal(exported.some((pill) => pill.tone === "entry" || pill.tone === "risk" || pill.tone === "profit"), false);
});

test("levelHitForTick groups merged neighbours within MERGE_TICKS and returns null when off-pane", () => {
  const lines: LevelLine[] = [
    makeLine({ price: 7340.75, price_ticks: 29363, names: "PDC", keys: ["pdc"] }),
    makeLine({ price: 7341.0, price_ticks: 29364, names: "Globex open", keys: ["globex_open"] }),
    makeLine({ price: 7350.0, price_ticks: 29400, names: "PDH", keys: ["pdh"] }),
  ];
  const hit = levelHitForTick(lines, 29363, 48, (price) => (price === 7340.75 ? 140 : 100));
  assert.ok(hit);
  assert.equal(hit.lines.length, 2);
  assert.equal(levelHitForTick(lines, 29363, 48, () => null), null);
});

test("LevelCard is a non-modal dialog that closes on ×, Escape, or after 6000 ms (LB-6)", () => {
  assert.equal(LEVEL_CARD_DISMISS_MS, 6000);
  assert.match(card, /role="dialog"\s+aria-label="Session level details"/);
  assert.match(card, /aria-label="Close level details"/);
  assert.match(card, /event\.key === "Escape"/);
  assert.match(card, /window\.setTimeout\(onClose, LEVEL_CARD_DISMISS_MS\)/);
  assert.doesNotMatch(card, /aria-modal/);
});

test("export swaps to <= 4 labelled groups and restores live tap mode in finally (D-E)", () => {
  const exportStart = chart.indexOf("screenshot: () => {");
  assert.ok(exportStart >= 0, "screenshot() exists");
  const exportBody = chart.slice(exportStart, chart.indexOf("}), []);", exportStart));
  assert.match(exportBody, /paintLevels\(l, paint, "always", exportPills\)/);
  assert.match(exportBody, /selectExportLevelPills\(livePills/);
  // UX-E4 adds setExportMode and the resized view inside the same try/finally; the D-E contract still holds.
  assert.match(exportBody, /try \{[\s\S]*?return l\.chart\.takeScreenshot\(true, false\);\s*\} finally \{[\s\S]*?paintLevels\(l, paint, "tap", livePills\);/);
});

test("the card sits outside the lightweight-charts canvas, so takeScreenshot never draws it (Invariant 1)", () => {
  const hostAt = chart.indexOf('className="chart-host"');
  const cardAt = chart.indexOf("{openLevel && <LevelCard");
  assert.ok(hostAt > 0 && cardAt > hostAt, "LevelCard is rendered after the chart host div, as a DOM sibling");
  assert.doesNotMatch(card, /\.takeScreenshot\(|createChart\(|attachPrimitive\(/);
  assert.match(detail, /<LevelsDisclosureList levels=\{levels\.lines\} symbol=\{trade\.symbol\} onHighlightTick=\{setHighlightedTick\} \/>/);
  assert.match(detail, /highlightedLineTick=\{highlightedTick\}/);
});

test("level CSS lives in app/levels.css, is imported once in the layout, and never in globals.css", () => {
  assert.match(layout, /import "\.\/levels\.css";/);
  assert.equal(layout.match(/levels\.css/g)?.length, 1);
  assert.doesNotMatch(globals, /\.level-card|\.levels-disclosure|\.level-labels-toggle/);
  assert.match(css, /\.level-card \{[^}]*background: var\(--bg-elevated\);/);
  assert.match(css, /font-variant-numeric: tabular-nums;/);
});
