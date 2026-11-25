import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import fixture from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { computeLevelsFromInputs } from "../levels.ts";
import { levelLines } from "../chart-levels.ts";
import { SessionLevelsPrimitive, computeLevelRightOffsetBars, levelPillColumnPx } from "../../components/SessionLevelsPrimitive.ts";
import type { ChartTheme } from "../theme.ts";

const theme = {
  surface: "#111", levelResistance: "#ef4444", levelSupport: "#10b981", levelAdr: "#f5b544",
  levelNeutral: "#9ca3af", levelLabelText: "#ffffff", levelLabelBgAlpha: 0.95,
} as ChartTheme;

const levels = () => computeLevelsFromInputs({ symbol: fixture.symbol, sessionDate: fixture.session_date, inputs: fixture.inputs });

test("levels never widen the price scale, so S2/R2 do not compress the trade (regression for #154)", () => {
  const primitive = new SessionLevelsPrimitive();
  primitive.update(levelLines(levels(), 7600, "MES"), theme, 60_000);
  assert.equal(primitive.autoscaleInfo(), null);
});

test("rays and pills both paint in the bottom layer, under candles and wicks (LB-1)", () => {
  const views = new SessionLevelsPrimitive().paneViews();
  assert.deepEqual(views.map((view) => view.zOrder?.()), ["bottom", "bottom"]);
});

test("a settlement proxy is carried to the line so its ray is dashed", () => {
  const computed = computeLevelsFromInputs({
    symbol: "MES", sessionDate: "2026-11-12",
    inputs: { prior_session: { session_date: "2026-11-11", high: 7671.5, low: 7547.5, settle: 7640.5, settle_provenance: { source: "Yahoo daily close", isProxy: true } } },
  });
  const pdc = levelLines(computed, 7600, "MES").find((line) => line.keys.includes("pdc"));
  assert.equal(pdc?.label, "7640.50 PDC (proxy)");
  assert.equal(pdc?.proxy, true);
  assert.equal(levelLines(computed, 7600, "MES").find((line) => line.keys.includes("pdh"))?.proxy, false);
});

test("settlement-type levels are tagged for the quiet dotted ray (Q-7, LB-4)", () => {
  const lines = levelLines(levels(), 7600, "MES");
  const settlement = (key: string) => lines.find((line) => line.keys.includes(key))?.settlement;
  assert.equal(settlement("pdc"), true);
  assert.equal(settlement("rth_close"), true);
  assert.equal(settlement("pdh"), false);
  const planned = levelLines([{ key: "plan:1:s", type: "planned", price: 7600, price_ticks: 76000, label: "Settle" }], 7600, "MES");
  assert.equal(planned[0].settlement, true);
  const plainPlan = levelLines([{ key: "plan:1:r", type: "planned", price: 7610, price_ticks: 76100, label: "Breakout" }], 7600, "MES");
  assert.equal(plainPlan[0].settlement, false);
});

test("the level pill background reads --level-label-bg-alpha: 0.95 and its label keeps 4.5:1 over it (LB-2)", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `missing ${selector}`);
    return css.slice(start, css.indexOf("\n}", start));
  };
  const tokens = (selector: string) => Object.fromEntries([...block(selector).matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const classic = tokens(":root");
  const blueOrange = { ...classic, ...tokens('[data-palette="blue-orange"]') };
  const hex = (value: string) => {
    const n = Number.parseInt(value.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const luminance = (rgb: number[]) => {
    const [r, g, b] = rgb.map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const [name, t] of [["classic", classic], ["blue-orange", blueOrange]] as const) {
    assert.equal(Number.parseFloat(t["level-label-bg-alpha"]), 0.95, name);
    const alpha = Number.parseFloat(t["level-label-bg-alpha"]);
    const surface = hex(t["bg-surface"]);
    const chartBg = hex(t["chart-bg"]);
    const composite = surface.map((c, i) => alpha * c + (1 - alpha) * chartBg[i]);
    const [hi, lo] = [luminance(hex(t["level-label-text"])), luminance(composite)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    assert.ok(ratio >= 4.5, `${name} contrast ${ratio.toFixed(2)}:1`);
  }
});

test("rightOffset reserves the pill column only when pills exist (OD-55a)", () => {
  assert.equal(computeLevelRightOffsetBars(0, 200, 8), 0);
  assert.equal(computeLevelRightOffsetBars(3, 200, 8), Math.ceil(208 / 8));
  assert.equal(computeLevelRightOffsetBars(3, 200, 0), 0);
  assert.equal(levelPillColumnPx([]), 0);
  assert.ok(levelPillColumnPx(["7547.50 PDL / ADR Low", "7600.00 PP"]) > levelPillColumnPx(["7600.00 PP"]));
});

test("rays stop at the last bar plus 4px, and settlement rays are 1px dotted neutral at 0.6 (LB-4, Q-7)", () => {
  const settlementLine = levelLines([{ key: "pdc", type: "pdc", price: 7600, price_ticks: 76000, label: "PDC", formed_at: undefined }], 7600, "MES");
  const lines = [...settlementLine, { ...levelLines([{ key: "pdh", type: "pdh", price: 7620, price_ticks: 76200, label: "PDH" }], 7600, "MES")[0] }];
  const lastBarTime = Date.parse("2026-11-12T15:00:00Z");
  const lastX = 120;
  const strokes: { right: number; alpha: number; style: unknown; dash: number[] }[] = [];
  let pendingPath: number[] = [];
  // Records each stroke's end x, alpha, colour and dash. Only the calls the primitive makes are stubbed.
  const ctx = {
    globalAlpha: 1, strokeStyle: "", dash: [] as number[],
    save() {}, restore() {}, beginPath() { pendingPath = []; },
    moveTo(x: number) { pendingPath = [x]; }, lineTo(x: number) { pendingPath.push(x); },
    stroke() { strokes.push({ right: pendingPath[1], alpha: this.globalAlpha, style: this.strokeStyle, dash: [...this.dash] }); },
    setLineDash(d: number[]) { this.dash = d; },
    fillRect() {}, strokeRect() {}, fillText() {}, measureText: (t: string) => ({ width: t.length * 6 }),
  };
  const attachment = {
    chart: { timeScale: () => ({ timeToCoordinate: (s: number) => (s === lastBarTime / 1000 ? lastX : 0) }) },
    series: { priceToCoordinate: () => 50, requestUpdate() {} },
    requestUpdate() {},
  };
  const primitive = new SessionLevelsPrimitive();
  primitive.attached(attachment as never);
  primitive.update(lines, theme, 60_000, undefined, { lastBarTime });
  const target = { useMediaCoordinateSpace: (fn: (s: unknown) => void) => fn({ context: ctx, mediaSize: { width: 300, height: 200 } }) };
  primitive.paneViews()[0].renderer()?.draw?.(target as never);
  assert.equal(strokes.length, 2);
  for (const stroke of strokes) assert.equal(stroke.right, lastX + 4);
  const dotted = strokes.find((stroke) => stroke.dash.length === 2 && stroke.dash[0] === 1 && stroke.dash[1] === 3);
  assert.ok(dotted, "settlement ray is dotted");
  assert.equal(dotted.alpha, 0.6);
  assert.equal(dotted.style, theme.levelNeutral);
});
