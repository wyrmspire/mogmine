// LB-B2 (docs/03 §3 LB-6/LB-7, D-E). The card helpers live in `components/LevelCard.tsx`, which needs JSX and so
// cannot be loaded by `node --test` (no .tsx loader in this repo). These tests read the source instead, as
// `a11y-core-screens.test.ts` does, and pin the wiring the acceptance rules depend on.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(process.cwd());
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf-8");

const card = read("components/LevelCard.tsx");
const chart = read("components/TradeChart.tsx");
const detail = read("components/TradeDetail.tsx");
const layout = read("app/layout.tsx");
const css = read("app/levels.css");
const globals = read("app/globals.css");

test("LevelCard is a non-modal dialog that closes on ×, Escape, or after 6000 ms (LB-6)", () => {
  assert.match(card, /export const LEVEL_CARD_DISMISS_MS = 6000;/);
  assert.match(card, /role="dialog"\s+aria-label="Session level details"/);
  assert.match(card, /aria-label="Close level details"/);
  assert.match(card, /event\.key === "Escape"/);
  assert.match(card, /window\.setTimeout\(onClose, LEVEL_CARD_DISMISS_MS\)/);
  assert.doesNotMatch(card, /aria-modal/);
});

test("LevelCard exports the pure helpers the popover and export rely on", () => {
  for (const name of ["formatLevelCardData", "clampPopoverPosition", "selectExportLevelPills", "levelHitForTick", "LevelsDisclosureList"]) {
    assert.match(card, new RegExp(`export (function|const) ${name}\\b`), `${name} must be exported`);
  }
  // Clamp keeps 4 px from every frame edge and below the HUD band (32 px).
  assert.match(card, /const EDGE_PX = 4;/);
  assert.match(card, /export const LEVEL_CARD_HUD_PX = 32;/);
});

test("export is capped at four labelled groups and restores live tap mode (D-E)", () => {
  assert.match(card, /export const EXPORT_LEVEL_GROUPS = 4;/);
  assert.match(card, /maxGroups = EXPORT_LEVEL_GROUPS/);
  // The export path swaps to "always" pills, captures, and restores "tap" in a finally block.
  const exportStart = chart.indexOf("screenshot: () => {");
  assert.ok(exportStart >= 0, "screenshot() exists");
  const exportBody = chart.slice(exportStart, chart.indexOf("}), []);", exportStart));
  assert.match(exportBody, /paintLevels\(l, paint, "always", exportPills\)/);
  assert.match(exportBody, /selectExportLevelPills\(livePills/);
  assert.match(exportBody, /try \{\s*return l\.chart\.takeScreenshot\(true, false\);\s*\} finally \{\s*paintLevels\(l, paint, "tap", livePills\);/);
});

test("the card sits outside the lightweight-charts canvas, so takeScreenshot never draws it (Invariant 1)", () => {
  const hostAt = chart.indexOf('className="chart-host"');
  const cardAt = chart.indexOf("{openLevel && <LevelCard");
  assert.ok(hostAt > 0 && cardAt > hostAt, "LevelCard is rendered after the chart host div, as a DOM sibling");
  assert.doesNotMatch(card, /\.takeScreenshot\(|createChart\(|attachPrimitive\(/);
});

test("TradeChart opens the card on tap, a pan, a zoom, or a focused list row", () => {
  assert.match(chart, /setOpenLevel\(hit \? \{ hit, fromList: false \} : null\)/);
  assert.match(chart, /const dismissLevel = \(\) => \{/);
  assert.match(chart, /dismissLevel\(\);/);
  assert.match(chart, /levelHitForTick\(latest\.current\.levels, highlightedLineTick/);
  assert.match(chart, /highlightedLineTick = null \}: Props/);
});

test("TradeDetail mounts the level list and passes the highlighted tick to the chart (LB-6)", () => {
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
