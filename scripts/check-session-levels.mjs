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
const levelHitTest = transpile(read("../lib/level-hit-test.ts"));
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
    <script>
      // Modules the painter requires. The real formatter pulls in trades.ts; MES prints two decimals, which is all this paints.
      const modules = {
        "../lib/label-stack.ts": (() => { const exports = {}; ${labelStack}; return exports; })(),
        "../lib/level-hit-test.ts": (() => { const exports = {}; ${levelHitTest}; return exports; })(),
        "../lib/format.ts": { formatPrice: (value) => value.toFixed(2) },
      };
      const require = (path) => modules[path]; const exports = {}; ${levelsPainter}</script>
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

      const lastBarTime = times[times.length - 1];
      const rayOf = (line) => line.path.length === 2 && line.path[0].args[1] === line.path[1].args[1];
      // Paints the primitive in one label mode and records what it drew.
      const capture = (mode) => {
        renderedText.length = 0;
        renderedLines.length = 0;
        levelsPrimitive.update(levels, theme, 60_000, pills, { lastBarTime, mode, symbol: "MES", entryPrice: 7600 });
        chart.takeScreenshot(true);
        const y = levels[0] && series.priceToCoordinate(levels[0].price);
        // The price scale can settle its width after the first paint, so read the geometry of this paint.
        const geometry = { lastBarX: chart.timeScale().timeToCoordinate(lastBarTime / 1000), paneWidth: chart.paneSize().width };
        const hit = levelsPrimitive.hitTestLevel(120, y);
        // Pill labels are "price name"; the axis tags are price only, so they carry no space.
        const pillLabels = renderedText.filter(t => t.text.includes(" "));
        const ys = pillLabels.map(t => t.y).sort((a, b) => a - b);
        const paneRight = Math.max(...pillLabels.map(t => t.right));
        return {
          pillLabels: pillLabels.map(t => t.text),
          minGap: ys.slice(1).reduce((gap, v, i) => Math.min(gap, v - ys[i]), Infinity),
          rightEdgeCount: pillLabels.filter(t => t.right > paneRight - 20).length,
          rayCount: renderedLines.filter(rayOf).length,
          rayEnds: renderedLines.filter(rayOf).map(l => l.path[1].args[0]),
          geometry,
          dottedRays: renderedLines.filter(l => l.dash.length === 2 && l.dash[0] === 1 && l.dash[1] === 3).map(l => ({ alpha: l.alpha, strokeStyle: l.strokeStyle })),
          axis: levelsPrimitive.priceAxisViews().map(v => ({ text: v.text(), visible: v.visible(), textColor: v.textColor(), backColor: v.backColor() })),
          hit: hit && { kind: hit.kind, price: hit.price, lines: hit.lines.length, ray: y },
          miss: levelsPrimitive.hitTestLevel(120, -50),
        };
      };
      const zOrders = levelsPrimitive.paneViews().map((view) => view.zOrder());

      result.textContent = JSON.stringify({
        levelsCount: levels.length,
        zOrders,
        tap: capture("tap"),
        always: capture("always"),
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
  // LB-1: both layers under candles.
  assert.deepEqual(res.zOrders, ["bottom", "bottom"]);
  // LB-4: rays stop at the last bar + 4px, measured on the same paint that drew them.
  const rayStops = (mode) => {
    const { geometry, rayEnds } = res[mode];
    assert.ok(geometry.lastBarX != null && geometry.lastBarX < geometry.paneWidth, `${mode}: last bar must be in view`);
    const expected = Math.min(geometry.paneWidth, Math.round(geometry.lastBarX + 4));
    assert.ok(rayEnds.length > 0 && rayEnds.every((x) => x <= expected + 0.5), `${mode}: ray past last bar`);
    assert.ok(Math.max(...rayEnds) >= expected - 0.5, `${mode}: rays stop short of last bar + 4px`);
  };

  // LB-6 (`levelLabels: "tap"`, the default): no pills, rays present, at most 3 price-only axis tags, tap opens a ray.
  const tap = res.tap;
  assert.equal(tap.pillLabels.length, 0, `tap mode drew pills: ${tap.pillLabels}`);
  assert.ok(tap.rayCount >= 15, `tap mode rays: ${tap.rayCount}`);
  rayStops("tap");
  assert.ok(tap.axis.length >= 1 && tap.axis.length <= 3, `axis tags: ${tap.axis.length}`);
  for (const tag of tap.axis) {
    assert.match(tag.text, /^\d{4}\.\d{2}$/, `axis tag is not price only: ${tag.text}`);
    assert.ok(tag.visible, "axis tag off pane");
  }
  assert.ok(tap.hit && tap.hit.kind === "group" && tap.hit.lines >= 1, `tap on a ray missed: ${JSON.stringify(tap.hit)}`);
  assert.equal(tap.miss, null);

  // `"always"`: the right-edge pill column (LB-A, max 8), no axis tags.
  const always = res.always;
  const drawn = always.pillLabels.filter((label) => / [A-Z]/.test(label));
  rayStops("always");
  assert.ok(drawn.length <= 8, `too many pills: ${drawn.length}`);
  assert.ok(drawn.some(l => l.includes("7619.75 PP")));
  assert.ok(drawn.some(l => l.includes("7593.00")));
  assert.ok(drawn.some(l => l.includes("7628.75 ONH")));
  assert.ok(!drawn.some(l => l.includes("7743.75 R2")), "the farthest level gave up its pill");
  assert.ok(always.minGap >= 16.5, `pills overlap: ${always.minGap}`);
  assert.ok(always.rightEdgeCount >= Math.min(8, drawn.length));
  assert.equal(always.axis.length, 0, "always mode must not draw axis tags");
  assert.ok(always.rayCount >= 15);
  // 0.6 is the settlement ray; 0.3 is the faint ray of a level whose pill was dropped (UX-21).
  assert.ok(always.dottedRays.length >= 1, "no settlement ray is dotted");
  for (const ray of always.dottedRays) assert.ok(ray.alpha === 0.6 || ray.alpha === 0.3, `dotted ray alpha ${ray.alpha}`);
  assert.ok(always.hit && always.hit.kind === "group", "always mode hit test missed a ray");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
