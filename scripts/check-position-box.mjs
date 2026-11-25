import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { deriveTrade } from "../lib/trade-document.ts";
import { buildMarks } from "../lib/trade-marks.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const painter = ts.transpileModule(read("../components/PositionBoxPrimitive.ts"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
// The painter imports `separateLabels` (UX-a) and the chart paint helpers (08 §7.1); hand both through a tiny require shim.
const transpile = (path) => ts.transpileModule(read(path), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const labelStack = transpile("../lib/label-stack.ts");
const chartPaint = transpile("../lib/chart-paint.ts");
const lightweightCharts = fileURLToPath(new URL(
  "../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js", import.meta.url,
));

const time = (hourMinute) => Date.parse(`2026-11-12T${hourMinute}:00Z`);
const candleTimes = Array.from({ length: 52 }, (_, index) => time("15:28") + index * 60_000);
const fixtureMarks = (id) => buildMarks(
  deriveTrade(JSON.parse(read(`../fixtures/trades/${id}.json`))), null, "1m", "medium", false, { candleTimes },
);
const marks = {
  trail: fixtureMarks("ex-trail"),
  ignored: fixtureMarks("ex-ignored"),
};
const t = candleTimes[8];
const span = { t0: t, t1: t + 300_000 };
marks.box = [
  { kind: "zone", ...span, p0: 7600, p1: 7595, tone: "risk", layer: "plan", style: "faint" },
  { kind: "zone", ...span, p0: 7600, p1: 7610, tone: "profit", layer: "plan", style: "faint" },
  { kind: "zone", ...span, p0: 7600, p1: 7604, tone: "profit", layer: "actual", style: "solid" },
  { kind: "zone", t0: t, t1: t, p0: 7611, p1: 7613, tone: "risk", layer: "actual", style: "solid" },
];

const folder = mkdtempSync(join(tmpdir(), "mogmine-position-box-"));
try {
  const html = join(folder, "position-box.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><pre id="result"></pre><div id="chart"></div>
    <script src="${pathToFileURL(lightweightCharts)}"></script>
    <script>const modules = {
      "../lib/label-stack.ts": (() => { const exports = {}; ${labelStack}; return exports; })(),
      "../lib/chart-paint.ts": (() => { const exports = {}; ${chartPaint}; return exports; })(),
    };
      const require = (name) => modules[name]; const exports = {}; ${painter}</script>
    <script>
    const result = document.querySelector("#result");
    try {
      const times = ${JSON.stringify(candleTimes)};
      const marks = ${JSON.stringify(marks)};
      const chart = LightweightCharts.createChart(document.querySelector("#chart"), {
        width: 360, height: 320,
        layout: { background: { color: "#000000" }, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        timeScale: { visible: false, barSpacing: 11 },
      });
      const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        priceLineVisible: false, lastValueVisible: false,
      });
      series.setData(times.map((time) => ({ time: time / 1000, open: 7598, high: 7598.5, low: 7597.5, close: 7598 })));
      const primitive = new exports.PositionBoxPrimitive();
      series.attachPrimitive(primitive);
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: 22 });
      chart.priceScale("right").setVisibleRange({ from: 7590, to: 7616 });
      const theme = {
        profit: "#00ff00", risk: "#ff0000", profitText: "#00ff00", lossText: "#ff0000",
        textPrimary: "#ffffff", textMuted: "#888888", boxOpacity: 0.5,
        chartBg: "#000000", zoneReward: "#00ff00", zoneRisk: "#ff0000", entryLine: "#ffffff", labelMuted: "#888888",
        chipReward: "#00aa00", chipRisk: "#aa0000", chipNeutral: "#222222", chipGhost: "#101010",
        fontMono: "monospace", fontSans: "sans-serif",
      };
      primitive.update(marks.box, theme);
      const screenshot = chart.takeScreenshot(true);
      const ctx = screenshot.getContext("2d");
      const x = (time) => Math.round(chart.timeScale().timeToCoordinate(time / 1000));
      const y = (price) => Math.round(series.priceToCoordinate(price));
      const fillX = x(${t + 180_000});
      const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
      const pixels = {
        planRisk: pixel(fillX, y(7596)),
        planProfit: pixel(fillX, y(7607)),
        planBorder: pixel(fillX, y(7610)),
        actual: pixel(fillX, y(7602)),
        actualBorder: pixel(fillX, y(7604)),
        outside: pixel(fillX, y(7610) - 1),
        sameBar: [-3, 0, 3].map((dx) => pixel(x(${t}) + dx, y(7612))),
      };

      const range = JSON.stringify(chart.timeScale().getVisibleLogicalRange());
      const opacitySamples = [0.15, 0.65].map((boxOpacity) => {
        primitive.update(marks.box, { ...theme, boxOpacity });
        const sample = chart.takeScreenshot(true).getContext("2d").getImageData(fillX, y(7607), 1, 1);
        return { green: sample.data[1], sameRange: range === JSON.stringify(chart.timeScale().getVisibleLogicalRange()) };
      });

      const proto = CanvasRenderingContext2D.prototype;
      const filledText = proto.fillText;
      const strokes = proto.stroke;
      const findings = [];
      const lines = [];
      let path = [];
      for (const method of ["beginPath", "moveTo", "lineTo"]) {
        const original = proto[method];
        proto[method] = function (...args) {
          if (method === "beginPath") path = [];
          else path.push(args);
          return original.apply(this, args);
        };
      }
      proto.stroke = function (...args) {
        lines.push({ path, alpha: this.globalAlpha });
        return strokes.apply(this, args);
      };
      proto.fillText = function (text, ...args) {
        findings.push(text);
        return filledText.call(this, text, ...args);
      };
      chart.timeScale().setVisibleLogicalRange({ from: 1, to: 45 });
      primitive.update(marks.trail, theme);
      chart.takeScreenshot(true);
      const step = (from, to) => lines.some(({ path }) => path.length === 2
        && path[0][0] === path[1][0]
        && Math.round(path[0][1]) === y(from) && Math.round(path[1][1]) === y(to));
      const trail = { steps: [step(7595, 7601), step(7601, 7606)],
        hatch: lines.some(({ path, alpha }) => alpha === 0.15 && path.length === 2 && path[0][0] !== path[1][0]),
        text: findings.includes("TRAIL") };

      findings.length = 0;
      lines.length = 0;
      primitive.update(marks.ignored, theme);
      chart.takeScreenshot(true);
      const crossX = x(${time("15:39")});
      const crossY = y(7595);
      const cross = lines.some(({ path }) => path.length === 4
        && Math.round(path[0][0]) === crossX - 4 && Math.round(path[3][0]) === crossX - 4
        && Math.round(path[0][1]) === crossY - 4 && Math.round(path[3][1]) === crossY + 4);
      const ignored = { cross, hatch: findings.includes("PAST STOP −0.6R"),
        manualExit: findings.includes("MKT") };
      result.textContent = JSON.stringify({ pixels, opacitySamples, trail, ignored });
    } catch (error) {
      result.textContent = JSON.stringify({ error: String(error) });
    }
    </script>`);
  const output = execFileSync(process.env.CHROME_BIN || "google-chrome", [
    "--headless", "--disable-gpu", "--disable-background-networking", "--no-sandbox",
    "--no-first-run", "--force-device-scale-factor=1", `--user-data-dir=${join(folder, "chrome")}`,
    "--dump-dom", pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 25_000, stdio: ["ignore", "pipe", "ignore"] });
  const result = JSON.parse(output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1] ?? "{}");
  assert.ok(!result.error, result.error);
  const { pixels, opacitySamples, trail, ignored } = result;
  assert.ok(pixels, "Chrome must produce screenshot pixels");
  // 08 §4.1: plan fill is flat 0.40 of Position Box Opacity; actual fades 0.55 → 0.85 from entry to exit.
  assert.deepEqual(pixels.planRisk, [51, 0, 0]);
  assert.deepEqual(pixels.planProfit, [0, 51, 0]);
  // The plan's dashed target edge (0.55) sits on this pixel: the edge rule, not the fill.
  assert.deepEqual(pixels.planBorder, [0, 163, 0]);
  assert.deepEqual(pixels.outside, [0, 0, 0]);
  // Midway between entry and exit the gradient is ~0.35; the plan fill beneath it is cut out, not stacked.
  assert.deepEqual(pixels.actual, [0, 88, 0]);
  // The solid 0.90 exit edge.
  assert.deepEqual(pixels.actualBorder, [0, 240, 0]);
  assert.ok(pixels.sameBar.every((pixel) => pixel[0] > 80 && pixel[1] === 0 && pixel[2] === 0));
  assert.deepEqual(opacitySamples, [{ green: 15, sameRange: true }, { green: 66, sameRange: true }]);
  assert.deepEqual(trail, { steps: [true, true], hatch: true, text: true });
  assert.deepEqual(ignored, { cross: true, hatch: true, manualExit: true });
  console.log(JSON.stringify(result));
} finally {
  rmSync(folder, { recursive: true, force: true });
}
