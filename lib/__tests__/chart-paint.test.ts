import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CHART_TOKENS, chipWidth, crisp, dashFor, subtractRect, subtractRects, withAlpha, zoneAlpha } from "../chart-paint.ts";
import { hitTestArchivedBoxes } from "../../components/PositionBoxPrimitive.ts";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const block = (selector: RegExp) => {
  const body = selector.exec(css)?.[1] ?? "";
  const declarations = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    declarations.set(`--${name}`, value.replace(/\s+/g, "").toLowerCase());
  }
  return declarations;
};
const classicCss = block(/:root\s*\{([^}]*)\}/);
const blueOrangeCss = block(/\[data-palette="blue-orange"\]\s*\{([^}]*)\}/);

// Token pinning (08 §4.1, §4.5, §4.6). Every value here is copied from the design doc.
const CLASSIC_TOKENS: Record<string, string> = {
  "--chart-bg": "#0b0e15",
  "--chart-grid-h": "rgba(255,255,255,0.045)",
  "--chart-grid-v": "rgba(255,255,255,0.025)",
  "--chart-border": "rgba(255,255,255,0.08)",
  "--chart-axis-text": "#8b93a7",
  "--chart-crosshair": "rgba(163,171,189,0.55)",
  "--chart-crosshair-label": "#232838",
  "--candle-up": "#22b88f",
  "--candle-down": "#ec5664",
  "--zone-reward": "#22c39a",
  "--zone-risk": "#f0545f",
  "--chip-reward-bg": "#0f7a5f",
  "--chip-risk-bg": "#b8323f",
  "--chip-neutral-bg": "#2a3142",
  "--chip-warn-bg": "#8a5a12",
  "--chip-ghost-bg": "rgba(18,22,33,0.92)",
  "--chart-entry-line": "#c9ced8",
  "--chart-label-muted": "#a3abbd",
  "--indicator-vwap": "#e879c6",
};
const BLUE_ORANGE_TOKENS: Record<string, string> = {
  "--zone-reward": "#4d8dff",
  "--zone-risk": "#f5873a",
  "--candle-up": "#4c8dff",
  "--candle-down": "#f98a3c",
  "--chip-reward-bg": "#1f5fcf",
  "--chip-risk-bg": "#a8480c",
  "--chip-warn-bg": "#5b4a8a",
};

test("CSS tokens in :root and the blue-orange palette match 08-visual-quality", () => {
  for (const [name, value] of Object.entries(CLASSIC_TOKENS)) assert.equal(classicCss.get(name), value, name);
  for (const [name, value] of Object.entries(BLUE_ORANGE_TOKENS)) assert.equal(blueOrangeCss.get(name), value, name);
});

test("CHART_TOKENS defaults match 08-visual-quality for both palettes", () => {
  const t = CHART_TOKENS;
  assert.equal(t.surface.bg, "#0B0E15");
  assert.equal(t.surface.gridH, "rgba(255,255,255,0.045)");
  assert.equal(t.surface.gridV, "rgba(255,255,255,0.025)");
  assert.equal(t.surface.border, "rgba(255,255,255,0.08)");
  assert.equal(t.surface.axisText, "#8B93A7");
  assert.equal(t.surface.crosshair, "rgba(163,171,189,0.55)");
  assert.equal(t.surface.crosshairLabel, "#232838");
  assert.deepEqual(t.candle, { up: "#22B88F", down: "#EC5664" });
  assert.equal(t.zone.reward, "#22C39A");
  assert.equal(t.zone.risk, "#F0545F");
  assert.equal(t.zone.nearFactor, 0.55);
  assert.equal(t.zone.farFactor, 0.85);
  assert.equal(t.zone.planFactor, 0.4);
  assert.equal(t.zone.cancelledFactor, 0.15);
  assert.equal(t.zone.archivedMaxAlpha, 0.08);
  assert.equal(t.zone.edgeActual, 0.9);
  assert.equal(t.zone.edgePlan, 0.55);
  assert.deepEqual(t.line, { entry: "#C9CED8", labelMuted: "#A3ABBD", vwap: "#E879C6", vwapWidth: 1.5, bracketAlpha: 0.7 });
  assert.deepEqual(t.chip, {
    reward: "#0F7A5F", risk: "#B8323F", neutral: "#2A3142", warn: "#8A5A12", ghost: "rgba(18,22,33,0.92)",
    text: "#FFFFFF", neutralText: "#E9ECF2", ghostText: "#C9CED8", height: 16, padX: 6, radius: 3,
  });
  assert.deepEqual(t.blueOrange, {
    reward: "#4D8DFF", risk: "#F5873A", candleUp: "#4C8DFF", candleDown: "#F98A3C",
    chipReward: "#1F5FCF", chipRisk: "#A8480C", chipWarn: "#5B4A8A",
  });
});

// WCAG 2.x contrast over the composited colours (08 §6).
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Composite an rgb/hex colour at `alpha` over an opaque hex background. */
function over(color: string, alpha: number, bg: string) {
  const rgb = color.startsWith("#")
    ? [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16))
    : (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const back = [1, 3, 5].map((i) => Number.parseInt(bg.slice(i, i + 2), 16));
  const mixed = rgb.map((c, i) => Math.round(c * alpha + back[i] * (1 - alpha)));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

const MIN_TEXT = 4.5;
const MIN_NON_TEXT = 3;
const palettes = {
  classic: {
    chips: [
      { name: "reward", bg: CHART_TOKENS.chip.reward, fg: CHART_TOKENS.chip.text },
      { name: "risk", bg: CHART_TOKENS.chip.risk, fg: CHART_TOKENS.chip.text },
      { name: "warn", bg: CHART_TOKENS.chip.warn, fg: CHART_TOKENS.chip.text },
      { name: "neutral (entry)", bg: CHART_TOKENS.chip.neutral, fg: CHART_TOKENS.chip.neutralText },
    ],
    zone: [CHART_TOKENS.zone.reward, CHART_TOKENS.zone.risk],
  },
  "blue-orange": {
    chips: [
      { name: "reward", bg: CHART_TOKENS.blueOrange.chipReward, fg: CHART_TOKENS.chip.text },
      { name: "risk", bg: CHART_TOKENS.blueOrange.chipRisk, fg: CHART_TOKENS.chip.text },
      { name: "warn", bg: CHART_TOKENS.blueOrange.chipWarn, fg: CHART_TOKENS.chip.text },
      { name: "neutral (entry)", bg: CHART_TOKENS.chip.neutral, fg: CHART_TOKENS.chip.neutralText },
    ],
    zone: [CHART_TOKENS.blueOrange.reward, CHART_TOKENS.blueOrange.risk],
  },
} as const;

for (const [palette, spec] of Object.entries(palettes)) {
  test(`${palette}: chip text is at least 4.5:1 on every chip colour`, () => {
    for (const chip of spec.chips) {
      assert.ok(contrast(chip.fg, chip.bg) >= MIN_TEXT, `${chip.name}: ${contrast(chip.fg, chip.bg).toFixed(2)}`);
    }
  });

  test(`${palette}: chart text and ghost chips are at least 4.5:1 over the chart background`, () => {
    const bg = CHART_TOKENS.surface.bg;
    assert.ok(contrast(CHART_TOKENS.surface.axisText, bg) >= MIN_TEXT);
    assert.ok(contrast(CHART_TOKENS.line.labelMuted, bg) >= MIN_TEXT);
    // The ghost chip is rgba(18,22,33,0.92): #121621 at 0.92 over the chart background.
    const ghost = over("#121621", 0.92, bg);
    assert.ok(contrast(CHART_TOKENS.chip.ghostText, ghost) >= MIN_TEXT);
  });

  test(`${palette}: zone edges stay at least 3:1 against the background for every box opacity`, () => {
    for (const zone of spec.zone) {
      assert.ok(contrast(zone, CHART_TOKENS.surface.bg) >= MIN_NON_TEXT, zone);
      for (const boxOpacity of [0.15, 0.28, 0.65]) {
        const fill = over(zone, zoneAlpha(CHART_TOKENS.zone.farFactor, boxOpacity), CHART_TOKENS.surface.bg);
        assert.notEqual(fill, CHART_TOKENS.surface.bg, `fill is visible at ${boxOpacity}`);
      }
    }
  });
}

test("slider reactivity: zone alpha scales with Position Box Opacity and leaves the tokens alone", () => {
  const before = JSON.stringify(CHART_TOKENS);
  const low = zoneAlpha(CHART_TOKENS.zone.farFactor, 0.15);
  const high = zoneAlpha(CHART_TOKENS.zone.farFactor, 0.65);
  assert.ok(Math.abs(high / low - 0.65 / 0.15) < 1e-9);
  assert.ok(Math.abs(zoneAlpha(CHART_TOKENS.zone.planFactor, 0.28) - 0.112) < 1e-9);
  assert.equal(JSON.stringify(CHART_TOKENS), before);
});

test("crisp snaps hairlines to whole device pixels at DPR 1, 2, 2.625 and 3", () => {
  for (const dpr of [1, 2, 2.625, 3]) {
    for (const v of [10.2, 10.5, 99.9, 240.01]) {
      const media = crisp(v, dpr, 1);
      const device = media * dpr;
      const oddWidth = Math.round(dpr) % 2 === 1;
      assert.equal(device - Math.floor(device), oddWidth ? 0.5 : 0, `dpr ${dpr}, v ${v}`);
      assert.ok(Math.abs(media - v) <= 1 / dpr + 1e-9, `dpr ${dpr}, v ${v}`);
    }
  }
});

test("chip width is text plus 6 px padding each side", () => {
  assert.equal(chipWidth(0), 12);
  assert.equal(chipWidth(30), 42);
});

test("dash table: solid, planned dashes [6, 4], inferred dots [2, 3]", () => {
  assert.deepEqual(dashFor("solid"), []);
  assert.deepEqual(dashFor("dashed"), [6, 4]);
  assert.deepEqual(dashFor("dotted"), [2, 3]);
});

test("withAlpha turns a hex token into rgba and leaves non-hex colours alone", () => {
  assert.equal(withAlpha("#22C39A", 0.5), "rgba(34, 195, 154, 0.500)");
  assert.equal(withAlpha("rgba(1, 2, 3, 0.4)", 0.5), "rgba(1, 2, 3, 0.4)");
});

test("plan fills are cut around actual zones without overlap", () => {
  const plan = { x: 0, y: 0, width: 10, height: 10 };
  const actual = { x: 2, y: 2, width: 4, height: 4 };
  const pieces = subtractRect(plan, actual);
  assert.equal(pieces.reduce((sum, p) => sum + p.width * p.height, 0), 100 - 16);
  for (let x = 0.5; x < 10; x++) {
    for (let y = 0.5; y < 10; y++) {
      const inActual = x > 2 && x < 6 && y > 2 && y < 6;
      const hits = pieces.filter((p) => x > p.x && x < p.x + p.width && y > p.y && y < p.y + p.height).length;
      assert.equal(hits, inActual ? 0 : 1, `point ${x},${y}`);
    }
  }
  // Overlapping actual lots must not reopen a gap between them.
  const twoLots = subtractRects(plan, [actual, { x: 4, y: 4, width: 4, height: 4 }]);
  assert.equal(twoLots.reduce((sum, p) => sum + p.width * p.height, 0), 100 - (16 + 16 - 4));
});

test("geometry is unchanged: archived box hit testing still returns the top-most match", () => {
  const rects = [
    { tradeId: "a", x: 0, y: 0, width: 50, height: 10 },
    { tradeId: "b", x: 40, y: 0, width: 50, height: 10 },
  ];
  assert.equal(hitTestArchivedBoxes(45, 5, rects), "b");
  assert.equal(hitTestArchivedBoxes(10, 5, rects), "a");
  assert.equal(hitTestArchivedBoxes(200, 5, rects), null);
});
