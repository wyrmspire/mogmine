// The Position Box: a Canvas series primitive, never HTML over the chart (Invariant 1).
// Drawn like TradingView's long/short position tool: fills only, no outline or frame on any box,
// and no numbers over the candles (they live in the header and stats grid).
//   PLAN — faint red fill entry→stop, faint green fill entry→target.
//   ACTUAL — a stronger fill entry→exit in the result colour: green win, red loss, gray scratch.
//   PATH — a thin dotted line from the entry fill to the exit fill.
//   KEY — an optional faint dotted level with a small low-contrast `KEY` pill at the right edge.
//
// Fills are drawn under the candles, so candles stay crisp at any opacity.
// Colours and opacity arrive in the config from the theme store; draw() never reads CSS (AGENTS §3b-7).
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  AutoscaleInfo,
  Coordinate,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";
import { includeInPriceRange } from "@/lib/trades";

export interface PositionBoxConfig {
  /** Fill times already snapped to bar open times for the active timeframe (B-23). */
  entryTime: Time;
  exitTime: Time;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  isLong: boolean;
  /** Result is within the scratch threshold: the actual band is gray instead of green or red. */
  scratch: boolean;
  profitColor: string;
  riskColor: string;
  mutedColor: string;
  /** Background for the small KEY pill. */
  pillBackground: string;
  textColor: string;
  /** Key level, drawn faint with a small pill. Null hides it. */
  keyPrice: number | null;
  keyColor: string;
  opacity: number;
  /** True when entry or exit was snapped to a nearby bar rather than a containing bar (issue #64 / OD-28). */
  approximate?: boolean;
  /** Issue #37: dotted continuation past the exit (and, when extended, before the entry). Hidden at Low detail. */
  showContinuation?: boolean;
  /** Draw the same dotted levels to the left of entry after the trader taps ‹ 30. */
  extendBackward?: boolean;
  laterTouches?: Array<{ time: Time; kind: "target" | "stop" }>;
}

interface Geometry {
  left: number;
  right: number;
  x1: number;
  x2: number;
  yEntry: number;
  yExit: number;
  yStop: number | null;
  yTarget: number | null;
  yKey: number | null;
  touches: Array<{ x: number; y: number; kind: "target" | "stop" }>;
}

const XRAY_OPACITY = 0.05;
/** Plan fills stay clearly weaker than the actual band so they cannot be read as P&L. */
const PLAN_FILL_RATIO = 0.28;
const KEY_FONT = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";

class FillRenderer implements IPrimitivePaneRenderer {
  constructor(private g: Geometry | null, private c: PositionBoxConfig, private opacity: number) {}

  draw(target: CanvasRenderingTarget2D) {
    const { g, c } = this;
    if (!g) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: sx, verticalPixelRatio: sy }) => {
      const left = Math.round(g.left * sx);
      const width = Math.max(1, Math.round((g.right - g.left) * sx));
      const rect = (yA: number, yB: number, color: string, alpha: number) => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.fillRect(left, Math.round(Math.min(yA, yB) * sy), width, Math.max(1, Math.round(Math.abs(yB - yA) * sy)));
      };
      const approxScale = c.approximate ? 0.72 : 1;
      const effectiveOpacity = this.opacity * approxScale;
      const planAlpha = effectiveOpacity * PLAN_FILL_RATIO;
      // PLAN fills first, faint, so the actual band (if any) paints over them.
      if (g.yTarget != null) rect(g.yEntry, g.yTarget, c.profitColor, planAlpha);
      if (g.yStop != null) rect(g.yEntry, g.yStop, c.riskColor, planAlpha);
      // ACTUAL: one stronger fill in the result colour. A scratch is gray, and at least 2px tall
      // so a flat exit is still visible. Nothing outlines it.
      const made = (c.exitPrice - c.entryPrice) * (c.isLong ? 1 : -1);
      const actual = c.scratch || made === 0 ? c.mutedColor : made > 0 ? c.profitColor : c.riskColor;
      const minHalf = 1;
      const yA = Math.abs(g.yExit - g.yEntry) < 2 * minHalf ? (g.yEntry + g.yExit) / 2 - minHalf : g.yEntry;
      const yB = Math.abs(g.yExit - g.yEntry) < 2 * minHalf ? (g.yEntry + g.yExit) / 2 + minHalf : g.yExit;
      rect(yA, yB, actual, effectiveOpacity);
      ctx.globalAlpha = 1;
    });
  }
}

class StrokeRenderer implements IPrimitivePaneRenderer {
  constructor(private g: Geometry | null, private c: PositionBoxConfig, private xray: boolean) {}

  draw(target: CanvasRenderingTarget2D) {
    const { g, c } = this;
    if (!g) return;
    const strength = this.xray ? 0.35 : 1;
    const made = (c.exitPrice - c.entryPrice) * (c.isLong ? 1 : -1);
    const resultColor = c.scratch || made === 0 ? c.mutedColor : made > 0 ? c.profitColor : c.riskColor;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: sx, verticalPixelRatio: sy }) => {
      const line = Math.max(1, Math.floor(sx));

      // Execution path: thin dotted line from the entry fill to the exit fill, no text.
      // An approximate alignment uses a fainter, thinner dash (issue #64).
      ctx.globalAlpha = (c.approximate ? 0.6 : 0.85) * strength;
      ctx.strokeStyle = c.textColor;
      ctx.lineWidth = line;
      ctx.setLineDash(c.approximate ? [1.5 * sx, 3 * sx] : [3 * sx, 3 * sx]);
      ctx.beginPath();
      ctx.moveTo(g.x1 * sx, g.yEntry * sy);
      ctx.lineTo(g.x2 * sx, g.yExit * sy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Entry and exit flags at the fill prices. Entry is neutral; the exit takes the result colour.
      const flag = (x: number, yValue: number, pointUp: boolean, color: string) => {
        const size = 6 * sx;
        const px = x * sx;
        const py = yValue * sy;
        ctx.beginPath();
        if (pointUp) {
          ctx.moveTo(px, py - size);
          ctx.lineTo(px + size * 0.7, py + size * 0.55);
          ctx.lineTo(px - size * 0.7, py + size * 0.55);
        } else {
          ctx.moveTo(px, py + size);
          ctx.lineTo(px + size * 0.7, py - size * 0.55);
          ctx.lineTo(px - size * 0.7, py - size * 0.55);
        }
        ctx.closePath();
        ctx.globalAlpha = (c.approximate ? 0.75 : 1) * strength;
        ctx.fillStyle = color;
        ctx.fill();
      };
      flag(g.x1, g.yEntry, c.isLong, c.textColor);
      flag(g.x2, g.yExit, !c.isLong, resultColor);

      ctx.globalAlpha = 1;
    });

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      // Faint cue for approximate nearby alignment: quiet tiny ≈ at entry marker (issue #64).
      if (c.approximate) {
        const fade = this.xray ? 0.4 : 0.75;
        ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillStyle = c.textColor;
        ctx.globalAlpha = fade;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        const xApprox = g.x1;
        const yApprox = c.isLong ? g.yEntry - 8 : g.yEntry - 3;
        ctx.fillText("≈", xApprox, yApprox);
        ctx.globalAlpha = 1;
      }
      if (c.showContinuation) {
        // Same colours as the plan zones: faint green target, faint red stop, faint gray entry.
        // No end labels and no "after exit" text on the chart (owner review of PR #72).
        const fade = this.xray ? 0.28 : 0.5;
        const level = (y: number | null, fromX: number, toX: number, color: string) => {
          if (y == null || y < 0 || y > mediaSize.height) return;
          if (Math.abs(toX - fromX) < 6) return;
          ctx.globalAlpha = fade;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([1, 3]);
          ctx.beginPath();
          ctx.moveTo(fromX, Math.round(y) + 0.5);
          ctx.lineTo(toX, Math.round(y) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        };
        const rightEdge = mediaSize.width - 4;
        level(g.yEntry, g.x2, rightEdge, c.mutedColor);
        level(g.yStop, g.x2, rightEdge, c.riskColor);
        level(g.yTarget, g.x2, rightEdge, c.profitColor);
        if (c.extendBackward) {
          level(g.yEntry, g.x1, 4, c.mutedColor);
          level(g.yStop, g.x1, 4, c.riskColor);
          level(g.yTarget, g.x1, 4, c.profitColor);
        }
        for (const touch of g.touches) {
          if (touch.x < 0 || touch.x > mediaSize.width) continue;
          ctx.strokeStyle = touch.kind === "stop" ? c.riskColor : c.profitColor;
          ctx.lineWidth = 1.25;
          ctx.globalAlpha = this.xray ? 0.35 : 0.7;
          ctx.beginPath();
          ctx.arc(touch.x, touch.y, 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      if (g.yKey == null || g.yKey < 0 || g.yKey > mediaSize.height) return;
      const fade = this.xray ? 0.5 : 1;
      // Faint dotted key level across the pane.
      ctx.globalAlpha = 0.45 * fade;
      ctx.strokeStyle = c.keyColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(g.yKey) + 0.5);
      ctx.lineTo(mediaSize.width, Math.round(g.yKey) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      // Small low-contrast pill at the right edge of the pane, never over the price scale.
      ctx.font = KEY_FONT;
      const text = "KEY";
      const width = Math.ceil(ctx.measureText(text).width) + 8;
      const height = 12;
      const x = mediaSize.width - width - 4;
      const yPill = Math.round(g.yKey - height / 2);
      ctx.globalAlpha = 0.85 * fade;
      ctx.beginPath();
      ctx.roundRect(x, yPill, width, height, 6);
      ctx.fillStyle = c.pillBackground;
      ctx.fill();
      ctx.globalAlpha = 0.18 * fade;
      ctx.fillStyle = c.keyColor;
      ctx.fill();
      ctx.globalAlpha = 0.8 * fade;
      ctx.fillStyle = c.keyColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + width / 2, yPill + height / 2 + 0.5);
      ctx.globalAlpha = 1;
    });
  }
}

class PaneView implements IPrimitivePaneView {
  constructor(private source: PositionBoxPrimitive, private layer: "fill" | "stroke") {}

  zOrder(): PrimitivePaneViewZOrder { return this.layer === "fill" ? "bottom" : "normal"; }

  renderer() {
    const { geometry, config, xray } = this.source;
    return this.layer === "fill"
      ? new FillRenderer(geometry, config, xray ? XRAY_OPACITY : config.opacity)
      : new StrokeRenderer(geometry, config, xray);
  }
}

export class PositionBoxPrimitive implements ISeriesPrimitive<Time> {
  geometry: Geometry | null = null;
  xray = false;
  private hidden = false;
  private chart?: IChartApi;
  private series?: ISeriesApi<SeriesType, Time>;
  private requestUpdate?: () => void;
  private readonly views = [new PaneView(this, "fill"), new PaneView(this, "stroke")];

  constructor(public config: PositionBoxConfig) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = undefined;
    this.series = undefined;
    this.requestUpdate = undefined;
  }

  updateAllViews() {
    const { chart, series, config } = this;
    if (!chart || !series || this.hidden) { this.geometry = null; return; }
    const timeScale = chart.timeScale();
    const x1 = timeScale.timeToCoordinate(config.entryTime);
    const x2 = timeScale.timeToCoordinate(config.exitTime);
    const price = (value: number | null): Coordinate | null => (value == null ? null : series.priceToCoordinate(value));
    const yEntry = price(config.entryPrice);
    const yExit = price(config.exitPrice);
    if (x1 == null || x2 == null || yEntry == null || yExit == null) { this.geometry = null; return; }
    // Cover the whole entry and exit bars, so a trade inside one bar is still a visible box.
    const half = Math.max(3, timeScale.options().barSpacing / 2);
    const yStop = price(config.stopPrice);
    const yTarget = price(config.targetPrice);
    const touches = (config.laterTouches ?? []).flatMap((touch) => {
      const x = timeScale.timeToCoordinate(touch.time);
      const y = touch.kind === "stop" ? yStop : yTarget;
      if (x == null || y == null) return [];
      return [{ x, y, kind: touch.kind }];
    });
    this.geometry = {
      left: Math.min(x1, x2) - half, right: Math.max(x1, x2) + half, x1, x2, yEntry, yExit,
      yStop, yTarget, yKey: price(config.keyPrice),
      touches,
    };
  }

  paneViews() { return this.views; }

  /** Keep the stop and target inside the price scale, so the box is never clipped by auto-fit. */
  autoscaleInfo(): AutoscaleInfo | null {
    const { entryPrice, exitPrice, stopPrice, targetPrice } = this.config;
    const priceRange = includeInPriceRange(null, [entryPrice, exitPrice, stopPrice, targetPrice]);
    return priceRange ? { priceRange } : null;
  }

  update(config: PositionBoxConfig) {
    this.config = config;
    this.requestUpdate?.();
  }

  /** Hide the box when its fills have no bar to sit on (issue #51). The price scale still keeps the fills. */
  setHidden(on: boolean) {
    if (this.hidden === on) return;
    this.hidden = on;
    this.requestUpdate?.();
  }

  /** X-Ray: fade the box to 5% so the candles underneath can be read (UX-42). */
  setXray(on: boolean) {
    if (this.xray === on) return;
    this.xray = on;
    this.requestUpdate?.();
  }
}
