import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import fixture from "../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { computeLevelsFromInputs } from "../lib/levels.ts";
import { levelLines, levelPills } from "../lib/chart-levels.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const labelStack = transpile(read("../lib/label-stack.ts"));
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
const lines = levelLines(computedLevels, 7600, "MES");
// Ranked as the trade chart ranks them: nearest the 7600 reference first (no trade anchors here).
const pills = levelPills(lines, [], "MES", 7600);

const folder = mkdtempSync(join(tmpdir(), "mogmine-session-levels-"));
try {
  const html = join(folder, "session-levels.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><pre id="result"></pre><div id="chart"></div>
    <script src="${pathToFileURL(lightweightCharts)}"></script>
    <script>const stack = (() => { const exports = {}; ${labelStack}; return exports; })();
      const require = () => stack; const exports = {}; ${levelsPainter}</script>
    <script>
    const result = document.querySelector("#result");
    try {
      const times = ${JSON.stringify(candleTimes)};
      const levels = ${JSON.stringify(lines)};
      const pills = ${JSON.stringify(pills)};
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

      // Last bar (index 59) inside the pane, so the ray end is measured rather than clipped to the edge.
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: 75 });
      chart.priceScale("right").setVisibleRange({ from: 7540, to: 7750 });

      const theme = {
        profit: "#10b981", risk: "#ef4444", profitText: "#34d399", lossText: "#ff6f7a",
        textPrimary: "#f4f5f7", textMuted: "#8e95a9", surface: "#0d0f17", elevated: "#141824",
        boxOpacity: 0.28,
        levelResistance: "#ef4444", levelSupport: "#10b981", levelAdr: "#f5b544",
        levelNeutral: "#9ca3af", levelLabelText: "#ffffff", levelLabelBgAlpha: 0.95,
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
        renderedLines.push({ path: currentPath, strokeStyle: this.strokeStyle, dash: this.getLineDash(), alpha: this.globalAlpha });
        return originalStroke.apply(this, args);
      };
      proto.fillText = function (text, ...args) {
        renderedText.push({ text, fillStyle: this.fillStyle, x: args[0], y: args[1], right: args[0] + this.measureText(text).width });
        return originalFillText.call(this, text, ...args);
      };
      proto.fillRect = function (...args) {
        renderedRects.push({ args, fillStyle: this.fillStyle });
        return originalFillRect.apply(this, args);
      };

      // Test with levels visible
      const lastBarTime = times[times.length - 1];
      levelsPrimitive.update(levels, theme, 60_000, pills, { lastBarTime });
      const screenshotVisible = chart.takeScreenshot(true);
      const zOrders = levelsPrimitive.paneViews().map((view) => view.zOrder());
      const lastBarX = chart.timeScale().timeToCoordinate(lastBarTime / 1000);
      const paneWidth = chart.paneSize().width;
      const rayEnds = renderedLines.filter(l => l.path.length === 2 && l.path[0].args[1] === l.path[1].args[1]).map(l => l.path[1].args[0]);
      const dottedRays = renderedLines.filter(l => l.dash.length === 2 && l.dash[0] === 1 && l.dash[1] === 3);
      const visibleLabels = renderedText.map(t => t.text);
      const rayCount = renderedLines.filter(l => l.path.length === 2 && l.path[0].args[1] === l.path[1].args[1]).length;

      // Check right-edge positioning: labels should sit close to width (pane.width is the chart width excluding price scale)
      const levelLabels = renderedText.filter(t => t.text.includes(" "));
      // Stacked pills never overlap (16 px pills, 17 px pitch).
      const ys = levelLabels.map(t => t.y).sort((a, b) => a - b);
      const minGap = ys.slice(1).reduce((gap, y, i) => Math.min(gap, y - ys[i]), Infinity);
      // Pills are right-aligned: every label ends within 20 px of the pane edge.
      const paneRight = Math.max(...levelLabels.map(t => t.right));
      const rightEdgeLabels = levelLabels.filter(t => t.right > paneRight - 20);

      // Test toggle off
      renderedText.length = 0;
      renderedLines.length = 0;
      levelsPrimitive.update([], theme, 60_000);
      chart.takeScreenshot(true);
      const hiddenLabelsCount = renderedText.filter(t => t.text.includes(" ")).length;
      const hiddenRaysCount = renderedLines.filter(l => l.path.length === 2 && l.path[0].args[1] === l.path[1].args[1]).length;

      result.textContent = JSON.stringify({
        levelsCount: levels.length,
        visibleLabels,
        rayCount,
        zOrders,
        lastBarX,
        paneWidth,
        expectedRayEnd: Math.min(paneWidth, Math.round(lastBarX + 4)),
        rayEnds,
        dottedRays: dottedRays.map(l => ({ alpha: l.alpha, strokeStyle: l.strokeStyle })),
        rightEdgeCount: rightEdgeLabels.length,
        minGap,
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
  // 19 levels; PDH/RTH high and ADR inner low/RTH low share ticks, so 17 lines.
  assert.equal(res.levelsCount, 17);
  assert.ok(res.minGap >= 16.5, `pills overlap: ${res.minGap}`);
  // UX-21: at most 8 pills, nearest the reference first; the rest keep their rays (faint).
  const drawn = res.visibleLabels.filter((label) => / [A-Z]/.test(label));
  assert.ok(drawn.length <= 8, `too many pills: ${drawn.length}`);
  assert.ok(drawn.some(l => l.includes("7619.75 PP")));
  assert.ok(drawn.some(l => l.includes("7593.00")));
  assert.ok(drawn.some(l => l.includes("7628.75 ONH")));
  assert.ok(!drawn.some(l => l.includes("7743.75 R2")), "the farthest level gave up its pill");
  assert.ok(res.rayCount >= 15);
  // LB-1: both layers under candles. LB-4: rays stop at lastBar + 4px, settlement rays dotted neutral 0.6.
  assert.deepEqual(res.zOrders, ["bottom", "bottom"]);
  assert.ok(res.lastBarX != null && res.lastBarX < res.paneWidth, "last bar must be in view");
  assert.ok(res.rayEnds.length > 0 && res.rayEnds.every((x) => x <= res.expectedRayEnd + 0.5), `ray past last bar: ${Math.max(...res.rayEnds)}`);
  assert.ok(Math.max(...res.rayEnds) >= res.expectedRayEnd - 0.5, "rays stop short of last bar + 4px");
  assert.ok(res.dottedRays.length >= 1, "no settlement ray is dotted");
  // 0.6 is the settlement ray; 0.3 is the faint ray of a level whose pill was dropped (UX-21).
  for (const ray of res.dottedRays) assert.ok(ray.alpha === 0.6 || ray.alpha === 0.3, `dotted ray alpha ${ray.alpha}`);
  assert.ok(res.rightEdgeCount >= Math.min(8, drawn.length));
  assert.equal(res.hiddenLabelsCount, 0);
  assert.equal(res.hiddenRaysCount, 0);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
