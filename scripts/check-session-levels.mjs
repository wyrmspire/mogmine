import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import fixture from "../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { computeLevelsFromInputs } from "../lib/levels.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const levelsPainter = transpile(read("../components/SessionLevelsPrimitive.ts"));
const lightweightCharts = fileURLToPath(new URL(
  "../node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js", import.meta.url,
));

const time = (hourMinute) => Date.parse(`2026-11-12T${hourMinute}:00Z`);
const candleTimes = Array.from({ length: 60 }, (_, index) => time("14:30") + index * 60_000);

const computedLevels = computeLevelsFromInputs({
  symbol: fixture.symbol,
  sessionDate: fixture.session_date,
  inputs: fixture.inputs,
});

const folder = mkdtempSync(join(tmpdir(), "mogmine-session-levels-"));
try {
  const html = join(folder, "session-levels.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><pre id="result"></pre><div id="chart"></div>
    <script src="${pathToFileURL(lightweightCharts)}"></script>
    <script>const exports = {}; ${levelsPainter}</script>
    <script>
    const result = document.querySelector("#result");
    try {
      const times = ${JSON.stringify(candleTimes)};
      const levels = ${JSON.stringify(computedLevels)};
      const chart = LightweightCharts.createChart(document.querySelector("#chart"), {
        width: 390, height: 400,
        layout: { background: { color: "#07080c" }, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        timeScale: { visible: false, barSpacing: 8 },
      });
      const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        priceLineVisible: false, lastValueVisible: false,
      });
      series.setData(times.map((t) => ({ time: t / 1000, open: 7600, high: 7615, low: 7590, close: 7605 })));
      
      const levelsPrimitive = new exports.SessionLevelsPrimitive();
      series.attachPrimitive(levelsPrimitive);

      chart.timeScale().setVisibleLogicalRange({ from: 0, to: 45 });
      chart.priceScale("right").setVisibleRange({ from: 7540, to: 7750 });

      const theme = {
        profit: "#10b981", risk: "#ef4444", profitText: "#34d399", lossText: "#ff6f7a",
        textPrimary: "#f4f5f7", textMuted: "#8e95a9", surface: "#0d0f17", elevated: "#141824",
        boxOpacity: 0.28,
        levelResistance: "#ef4444", levelSupport: "#10b981", levelAdr: "#f5b544",
        levelNeutral: "#9ca3af", levelLabelText: "#ffffff",
      };

      // 1. Capture fills and strokes
      const proto = CanvasRenderingContext2D.prototype;
      const originalStroke = proto.stroke;
      const originalFillText = proto.fillText;
      const originalFillRect = proto.fillRect;

      const renderedText = [];
      const renderedLines = [];
      const renderedRects = [];

      let currentPath = [];
      for (const m of ["beginPath", "moveTo", "lineTo"]) {
        const orig = proto[m];
        proto[m] = function (...args) {
          if (m === "beginPath") currentPath = [];
          else currentPath.push({ method: m, args });
          return orig.apply(this, args);
        };
      }
      proto.stroke = function (...args) {
        renderedLines.push({ path: currentPath, strokeStyle: this.strokeStyle, dash: this.getLineDash() });
        return originalStroke.apply(this, args);
      };
      proto.fillText = function (text, ...args) {
        renderedText.push({ text, fillStyle: this.fillStyle, x: args[0], y: args[1] });
        return originalFillText.call(this, text, ...args);
      };
      proto.fillRect = function (...args) {
        renderedRects.push({ args, fillStyle: this.fillStyle });
        return originalFillRect.apply(this, args);
      };

      // Test with levels visible
      levelsPrimitive.update(levels, true, theme);
      const screenshotVisible = chart.takeScreenshot(true);
      const visibleLabels = renderedText.map(t => t.text);
      const rayCount = renderedLines.filter(l => l.path.length === 2 && l.path[0].args[1] === l.path[1].args[1]).length;

      // Check right-edge positioning: labels should sit close to width (pane.width is the chart width excluding price scale)
      const levelLabels = renderedText.filter(t => t.text.includes(" "));
      const rightEdgeLabels = levelLabels.filter(t => t.x > 180);

      // Test toggle off
      renderedText.length = 0;
      renderedLines.length = 0;
      levelsPrimitive.update(levels, false, theme);
      chart.takeScreenshot(true);
      const hiddenLabelsCount = renderedText.filter(t => t.text.includes(" ")).length;
      const hiddenRaysCount = renderedLines.filter(l => l.path.length === 2 && l.path[0].args[1] === l.path[1].args[1]).length;

      result.textContent = JSON.stringify({
        levelsCount: levels.length,
        visibleLabels,
        rayCount,
        rightEdgeCount: rightEdgeLabels.length,
        hiddenLabelsCount,
        hiddenRaysCount,
      });
    } catch (error) {
      result.textContent = JSON.stringify({ error: String(error) });
    }
    </script>`);

  const output = execFileSync(process.env.CHROME_BIN || "google-chrome", [
    "--headless", "--disable-gpu", "--disable-background-networking", "--no-sandbox",
    "--no-first-run", "--force-device-scale-factor=1", `--user-data-dir=${join(folder, "chrome")}`,
    "--dump-dom", pathToFileURL(html).href,
  ], { encoding: "utf8", timeout: 25_000, stdio: ["ignore", "pipe", "ignore"] });

  const res = JSON.parse(output.match(/<pre id="result">([^<]+)<\/pre>/)?.[1] ?? "{}");
  assert.ok(!res.error, res.error);
  console.log("Session levels check passed:", res);
  assert.equal(res.levelsCount, 19);
  assert.ok(res.visibleLabels.some(l => l.includes("7671.50 PDH")));
  assert.ok(res.visibleLabels.some(l => l.includes("7640.50 PDC")));
  assert.ok(res.visibleLabels.some(l => l.includes("7547.50 PDL")));
  assert.ok(res.visibleLabels.some(l => l.includes("7619.75 PP")));
  assert.ok(res.visibleLabels.some(l => l.includes("7687.25 ADR High")));
  assert.ok(res.rayCount >= 15);
  assert.ok(res.rightEdgeCount >= 15);
  assert.equal(res.hiddenLabelsCount, 0);
  assert.equal(res.hiddenRaysCount, 0);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
