import assert from "node:assert/strict";
import { test } from "node:test";
import { CHART_TOKENS } from "../chart-paint.ts";
import { createPositionAxisViews, extractTradeAxisTags, isRulerLabel, isRulerSegment } from "../position-axis-views.ts";
import type { ISeriesPrimitiveAxisView } from "lightweight-charts";
import type { ChartTheme } from "../theme.ts";
import type { Mark } from "../trade-marks.ts";
import { PositionBoxPrimitive } from "../../components/PositionBoxPrimitive.ts";

// Library axis views declare their members optional; the painter always sets them all.
type AxisView = Required<ISeriesPrimitiveAxisView>;

// Only the chip keys the tags read. Values are the same tokens lib/theme.ts reads from the CSS.
const classic = {
  chipNeutral: CHART_TOKENS.chip.neutral,
  chipRisk: CHART_TOKENS.chip.risk,
  chipReward: CHART_TOKENS.chip.reward,
} as ChartTheme;
const blueOrange = {
  chipNeutral: CHART_TOKENS.chip.neutral,
  chipRisk: CHART_TOKENS.blueOrange.chipRisk,
  chipReward: CHART_TOKENS.blueOrange.chipReward,
} as ChartTheme;

const T0 = Date.parse("2026-11-20T14:00:00Z");
const T1 = Date.parse("2026-11-20T14:30:00Z");
const span = { t0: T0, t1: T1 };

const actualZone = (p0: number, p1: number, tone: "profit" | "risk" | "neutral" = "profit", layer: "actual" | "archived" = "actual") =>
  ({ kind: "zone", ...span, p0, p1, tone, layer, style: "solid" }) as Mark;
const planZone = (p0: number, p1: number, tone: "profit" | "risk") =>
  ({ kind: "zone", ...span, p0, p1, tone, layer: "plan", style: "faint" }) as Mark;
const entrySegment = (price: number) =>
  ({ kind: "segment", ...span, p0: price, p1: price, layer: "actual", dash: "solid", tone: "entry" }) as Mark;

// Long MES: entry 6840, stop 6830, target 6860. The plan and the actual exit share the 6860 target.
const planMarks: Mark[] = [entrySegment(6840), planZone(6840, 6830, "risk"), planZone(6840, 6860, "profit")];

test("extracts entry, stop, target and exit tags for the selected trade", () => {
  const marks = [...planMarks, actualZone(6840, 6850, "risk")];
  const tags = extractTradeAxisTags(marks, classic);
  assert.deepEqual(tags.map((t) => [t.price, t.text]), [[6840, "6840.00"], [6830, "6830.00"], [6860, "6860.00"], [6850, "6850.00"]]);
});

test("entry falls back to the actual zone's near price when there is no entry segment", () => {
  const tags = extractTradeAxisTags([actualZone(6841.5, 6855)], classic);
  assert.equal(tags[0].price, 6841.5);
  assert.equal(tags[0].text, "6841.50");
});

test("classic and blue-orange palettes colour the tags from theme chips", () => {
  const marks = [...planMarks, actualZone(6840, 6850, "risk")];
  const classicTags = extractTradeAxisTags(marks, classic);
  assert.deepEqual(classicTags.map((t) => t.bg), [CHART_TOKENS.chip.neutral, CHART_TOKENS.chip.risk, CHART_TOKENS.chip.reward, CHART_TOKENS.chip.risk]);
  assert.ok(classicTags.every((t) => t.fg === CHART_TOKENS.chip.text || t.fg === CHART_TOKENS.chip.neutralText));
  assert.equal(classicTags[0].fg, CHART_TOKENS.chip.neutralText);

  const boTags = extractTradeAxisTags(marks, blueOrange);
  assert.equal(boTags[1].bg, CHART_TOKENS.blueOrange.chipRisk);
  assert.equal(boTags[2].bg, CHART_TOKENS.blueOrange.chipReward);
});

test("an exit equal to the target is deduplicated; a distinct exit is tagged by its outcome", () => {
  const exitAtTarget = extractTradeAxisTags([...planMarks, actualZone(6840, 6860, "profit")], classic);
  assert.equal(exitAtTarget.length, 3, "exit equal to target adds no tag");

  const exitAtStop = extractTradeAxisTags([...planMarks, actualZone(6840, 6830, "risk")], classic);
  assert.equal(exitAtStop.length, 3, "exit equal to stop adds no tag");

  const profitExit = extractTradeAxisTags([...planMarks, actualZone(6840, 6852, "profit")], classic);
  assert.equal(profitExit[3].price, 6852);
  assert.equal(profitExit[3].bg, CHART_TOKENS.chip.reward);

  const lossExit = extractTradeAxisTags([...planMarks, actualZone(6840, 6835, "risk")], classic);
  assert.equal(lossExit[3].price, 6835);
  assert.equal(lossExit[3].bg, CHART_TOKENS.chip.risk);
});

test("archived marks never produce a tag", () => {
  const archived = [actualZone(6900, 6910, "profit", "archived"), { ...planZone(6900, 6905, "risk"), layer: "archived" } as Mark];
  assert.deepEqual(extractTradeAxisTags(archived, classic), []);
  // The selected trade's tags stay the same when a neighbour is present.
  const withNeighbour = extractTradeAxisTags([...planMarks, ...archived], classic);
  assert.equal(withNeighbour.length, 3);
});

test("createPositionAxisViews clips off-pane prices to -1000 and hides them outside [0, paneHeight]", () => {
  const tags = extractTradeAxisTags(planMarks, classic);
  // 2 px per price point, price 6900 at y=0.
  const toY = (price: number) => (6900 - price) * 2;
  const views = createPositionAxisViews(tags, toY, 300) as AxisView[];
  assert.equal(views.length, 3);
  const entry = views[0];
  assert.equal(entry.coordinate(), 120);
  assert.equal(entry.visible(), true);
  assert.equal(entry.text(), "6840.00");
  assert.equal(entry.backColor(), CHART_TOKENS.chip.neutral);
  assert.equal(entry.textColor(), CHART_TOKENS.chip.neutralText);
  assert.equal(entry.tickVisible(), true);

  // Stop 6830 sits at y=140, target 6860 at y=80: both inside 300.
  assert.ok(views.every((v) => v.visible()));

  const below = createPositionAxisViews([{ price: 6600, text: "6600.00", bg: "#000", fg: "#fff" }], toY, 300)[0] as AxisView;
  assert.equal(below.coordinate(), -1000);
  assert.equal(below.visible(), false);
  const unknown = createPositionAxisViews([{ price: 6600, text: "x", bg: "#000", fg: "#fff" }], () => null, 300)[0] as AxisView;
  assert.equal(unknown.coordinate(), -1000);
});

test("isRulerSegment and isRulerLabel classify R-ruler marks only", () => {
  const ruler = { kind: "segment", ...span, p0: 6850, p1: 6850, layer: "plan", dash: "dotted", tone: "neutral", faint: true } as Mark;
  const rulerLabel = { kind: "label", anchor: { t: T0, price: 6850 }, text: "+1R", priority: 2, tone: "neutral" } as Mark;
  assert.equal(isRulerSegment(ruler), true);
  assert.equal(isRulerLabel(rulerLabel), true);

  assert.equal(isRulerSegment({ ...ruler, faint: undefined } as Mark), false, "not faint");
  assert.equal(isRulerSegment({ ...ruler, dash: "solid" } as Mark), false, "not dotted");
  assert.equal(isRulerSegment({ ...ruler, tone: "entry" } as Mark), false, "not neutral");
  assert.equal(isRulerSegment({ ...ruler, layer: "actual" } as Mark), false, "not plan");
  assert.equal(isRulerSegment(entrySegment(6840)), false);
  assert.equal(isRulerLabel({ ...rulerLabel, priority: 1 } as Mark), false);
  assert.equal(isRulerLabel({ ...rulerLabel, tone: "profit" } as Mark), false);
  assert.equal(isRulerLabel(planZone(6840, 6850, "profit")), false);
});

test("PositionBoxPrimitive.setExportMode toggles export and requests a repaint each time", () => {
  let updates = 0;
  const prim = new PositionBoxPrimitive();
  prim.attached({ requestUpdate: () => { updates += 1; } } as unknown as Parameters<PositionBoxPrimitive["attached"]>[0]);
  prim.setExportMode(true);
  prim.setExportMode(false);
  prim.setExportMode();
  assert.equal(updates, 3);
  // Detached: toggling is safe and does not throw.
  prim.detached();
  assert.doesNotThrow(() => prim.setExportMode(true));
});

test("PositionBoxPrimitive.priceAxisViews returns the selected trade's tags and none for detached or unthemed primitives", () => {
  const prim = new PositionBoxPrimitive();
  assert.deepEqual(prim.priceAxisViews(), []);
  const chart = { paneSize: () => ({ width: 800, height: 300 }) };
  const series = { priceToCoordinate: (price: number) => (6900 - price) * 2 };
  prim.attached({ chart, series, requestUpdate: () => undefined } as unknown as Parameters<PositionBoxPrimitive["attached"]>[0]);
  assert.deepEqual(prim.priceAxisViews(), [], "no theme yet");
  prim.update([...planMarks, actualZone(6900, 6910, "profit", "archived")], classic);
  assert.equal(prim.priceAxisViews().length, 3);
});
