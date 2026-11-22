import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const cssPath = join(process.cwd(), "app/globals.css");
const componentPath = join(process.cwd(), "components/TradeDetail.tsx");
const css = readFileSync(cssPath, "utf8");
const component = readFileSync(componentPath, "utf8");

test("Trade detail layout: mobile edge clearance prevents gesture conflict", () => {
  // Chart card margin on mobile: >= 14px so controls are inset from phone back-swipe zone (<15px)
  const chartCardMobile = css.match(/\.chart-card\s*\{[^}]*margin:\s*0\s+(\d+)px/);
  assert.ok(chartCardMobile, "chart-card has horizontal margin defined");
  const chartCardMargin = parseInt(chartCardMobile[1], 10);
  assert.ok(chartCardMargin >= 14, `chart-card margin should be >= 14px (got ${chartCardMargin}px)`);

  // Chart toolbar padding: >= 8px so 1m button sits at margin + padding >= 20px
  const chartToolbar = css.match(/\.chart-toolbar\s*\{[^}]*padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(chartToolbar, "chart-toolbar has padding defined");
  const toolbarPadLeft = parseInt(chartToolbar[2], 10);
  assert.ok(toolbarPadLeft >= 8, `chart-toolbar horizontal padding should be >= 8px (got ${toolbarPadLeft}px)`);
  assert.ok(chartCardMargin + toolbarPadLeft >= 20, `1m button distance from edge should be >= 20px (got ${chartCardMargin + toolbarPadLeft}px)`);

  // Chart note padding: >= 12px so 'After the exit' note sits at margin + padding >= 20px
  const chartNote = css.match(/\.chart-note\s*\{[^}]*padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(chartNote, "chart-note has padding defined");
  const notePadLeft = parseInt(chartNote[2], 10);
  assert.ok(notePadLeft >= 12, `chart-note horizontal padding should be >= 12px (got ${notePadLeft}px)`);
  assert.ok(chartCardMargin + notePadLeft >= 20, `After-the-exit note distance should be >= 20px (got ${chartCardMargin + notePadLeft}px)`);

  // Trade levels card margin on mobile: >= 14px
  const levelsCardMobile = css.match(/\.trade-levels-card\s*\{[^}]*margin:\s*\d+px\s+(\d+)px/);
  assert.ok(levelsCardMobile, "trade-levels-card has horizontal margin defined");
  const levelsCardMargin = parseInt(levelsCardMobile[1], 10);
  assert.ok(levelsCardMargin >= 14, `trade-levels-card margin should be >= 14px (got ${levelsCardMargin}px)`);

  // R-strip row padding: >= 12px so mood button sits at margin + padding >= 20px from right edge
  const rstripRow = css.match(/\.rstrip-row\s*\{[^}]*padding:\s*(\d+)px\s+(\d+)px/);
  assert.ok(rstripRow, "rstrip-row has padding defined");
  const rstripPadRight = parseInt(rstripRow[2], 10);
  assert.ok(rstripPadRight >= 12, `rstrip-row horizontal padding should be >= 12px (got ${rstripPadRight}px)`);
  assert.ok(levelsCardMargin + rstripPadRight >= 20, `Mood button distance from edge should be >= 20px (got ${levelsCardMargin + rstripPadRight}px)`);

  // Level editor in levels has padding so change-target chip is offset >= 20px
  const levelEditor = css.match(/\.levels\s*>\s*\.level-editor\s*\{[^}]*padding:\s*0\s+(\d+)px/);
  assert.ok(levelEditor, "level-editor in levels has horizontal padding");
  const levelEditorPad = parseInt(levelEditor[1], 10);
  assert.ok(levelsCardMargin + levelEditorPad >= 20, `Target chip distance from edge should be >= 20px (got ${levelsCardMargin + levelEditorPad}px)`);
});

test("Trade detail layout: desktop 3-column workstation hierarchy", () => {
  // Detail layout on >= 1024px has 3 columns: rail (290px), main, side (350px)
  assert.ok(css.includes("grid-template-columns: 290px minmax(0, 1fr) 350px"));

  // Desktop chart frame height uses balanced clamp so trade-levels-card is not hidden
  assert.ok(css.includes("height: clamp(360px, calc(100dvh - 440px), 580px);"));

  // Desktop levels grid displays in a single compact 7-column ribbon
  assert.ok(css.includes("grid-template-columns: repeat(7, minmax(0, 1fr));"));

  // Component structure places trade-levels-card directly following chart-card before actions
  const chartCardIndex = component.indexOf('className={`chart-card specular-card');
  const levelsCardIndex = component.indexOf('className="trade-levels-card specular-card"');
  const detailActionsIndex = component.indexOf('className="detail-actions"');
  assert.ok(chartCardIndex !== -1, "chart-card exists");
  assert.ok(levelsCardIndex !== -1, "trade-levels-card exists");
  assert.ok(detailActionsIndex !== -1, "detail-actions exists");
  assert.ok(levelsCardIndex > chartCardIndex, "trade-levels-card is placed after chart-card");
  assert.ok(levelsCardIndex < detailActionsIndex, "trade-levels-card is placed directly under chart before detail-actions");
});
