// UX-E5: chart chrome (F-10, §7.3, D-V4). Pure rules plus source checks on the wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_RIGHT_OFFSET_BARS, MIN_BAR_SPACING_PX, TRADINGVIEW_ATTRIBUTION, effectiveRightOffsetBars } from "../chart-chrome.ts";

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

test("effectiveRightOffsetBars gives the breathing room when there are no pills (F-10)", () => {
  assert.equal(DEFAULT_RIGHT_OFFSET_BARS, 2);
  assert.equal(effectiveRightOffsetBars(0, 0, 8), 2);
  assert.equal(effectiveRightOffsetBars(0, 200, 8), 2);
});

test("effectiveRightOffsetBars uses the pill column bar count when it is wider than the breathing room", () => {
  // Same maths as computeLevelRightOffsetBars: ceil((200 px + 8 px gap) / 8 px per bar) = 26 bars.
  assert.equal(effectiveRightOffsetBars(3, 200, 8), 26);
});

test("effectiveRightOffsetBars falls back to the breathing room when barSpacing is 0", () => {
  assert.equal(effectiveRightOffsetBars(3, 200, 0), 2);
  assert.equal(effectiveRightOffsetBars(0, 0, 0), 2);
});

test("MIN_BAR_SPACING_PX keeps 1m candles at least 3 px wide (§7.3)", () => {
  assert.ok(MIN_BAR_SPACING_PX >= 3);
});

test("TRADINGVIEW_ATTRIBUTION links to the lightweight-charts page", () => {
  assert.equal(TRADINGVIEW_ATTRIBUTION.href, "https://www.tradingview.com/lightweight-charts/");
  assert.match(TRADINGVIEW_ATTRIBUTION.notice, /Apache License 2\.0/);
});

test("TradeChart turns off the attribution logo and sets the offset and bar-spacing floor (F-10, §7.3)", () => {
  const src = read("components/TradeChart.tsx");
  assert.match(src, /attributionLogo: false/);
  assert.doesNotMatch(src, /attributionLogo: true/);
  assert.match(src, /minBarSpacing: MIN_BAR_SPACING_PX/);
  assert.match(src, /rightOffset: DEFAULT_RIGHT_OFFSET_BARS/);
  assert.match(src, /effectiveRightOffsetBars\(state\.levelLabels\.length/);
});

test("TuneScreen renders the licence link with rel=noopener noreferrer and a 44 px tap target (D-V4)", () => {
  const src = read("components/TuneScreen.tsx");
  assert.match(src, /aria-label="About and licences"/);
  assert.match(src, /href=\{TRADINGVIEW_ATTRIBUTION\.href\}/);
  assert.equal(TRADINGVIEW_ATTRIBUTION.href, "https://www.tradingview.com/lightweight-charts/");
  assert.match(src, /target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(src, /minHeight: 44, display: "inline-flex", alignItems: "center"/);
});
