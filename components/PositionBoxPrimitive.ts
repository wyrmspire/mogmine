// The Position Box: a Canvas series primitive, never HTML over the chart (Invariant 1).
// "Actual" style from docs/12 LV-18 (OD-23): teal frame, solid strokes; the risk zone keeps its dashed
// border so profit and risk are told apart without colour (UX-80).
//
// Fills are drawn under the candles and strokes above them, so candles stay crisp at any opacity.
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

export interface PositionBoxConfig {
  /** Fill times already snapped to bar open times for the active timeframe (B-23). */
  entryTime: Time;
  exitTime: Time;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  /** Approximate excursions during the hold (B-33). */
  maePrice: number | null;
  mfePrice: number | null;
  isLong: boolean;
  /** Result label drawn on the chart, e.g. `+1.6R · +$47.50`. R only in Shield mode (UX-71). */
  pill: string;
  pillTone: "profit" | "risk" | "neutral";
  profitColor: string;
  riskColor: string;
  frameColor: string;
  pathColor: string;
  pillBackground: string;
  textColor: string;
  opacity: number;
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
  yMae: number | null;
  yMfe: number | null;
}

const XRAY_OPACITY = 0.05;
const PILL_FONT = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";

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
      const won = (c.exitPrice - c.entryPrice) * (c.isLong ? 1 : -1) >= 0;
      // Profit zone: entry to the planned target, or to the exit when the trade made money.
      const yProfit = g.yTarget ?? (won ? g.yExit : null);
      if (yProfit != null) rect(g.yEntry, yProfit, c.profitColor, this.opacity);
      // Risk zone: entry to the stop. Without a stop, entry to the worst price seen, at half strength.
      if (g.yStop != null) rect(g.yEntry, g.yStop, c.riskColor, this.opacity);
      else if (g.yMae != null) rect(g.yEntry, g.yMae, c.riskColor, this.opacity * 0.5);
      // Heat actually taken, as a darker inner shade inside the risk zone.
      if (g.yStop != null && g.yMae != null) rect(g.yEntry, g.yMae, c.riskColor, this.opacity * 0.6);
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
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: sx, verticalPixelRatio: sy }) => {
      const left = Math.round(g.left * sx) + 0.5;
      const right = Math.round(g.right * sx) - 0.5;
      const y = (value: number) => Math.round(value * sy) + 0.5;
      const line = Math.max(1, Math.floor(sx));
      const box = (yA: number, yB: number, color: string, dash: number[]) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = line;
        ctx.setLineDash(dash.map((value) => value * sx));
        ctx.strokeRect(left, y(Math.min(yA, yB)), right - left, y(Math.max(yA, yB)) - y(Math.min(yA, yB)));
      };
      const horizontal = (yValue: number, color: string, dash: number[], alpha: number) => {
        ctx.globalAlpha = alpha * strength;
        ctx.strokeStyle = color;
        ctx.lineWidth = line;
        ctx.setLineDash(dash.map((value) => value * sx));
        ctx.beginPath();
        ctx.moveTo(left, y(yValue));
        ctx.lineTo(right, y(yValue));
        ctx.stroke();
      };
      const won = (c.exitPrice - c.entryPrice) * (c.isLong ? 1 : -1) >= 0;
      const yProfit = g.yTarget ?? (won ? g.yExit : null);

      ctx.globalAlpha = strength;
      if (yProfit != null) box(g.yEntry, yProfit, c.frameColor, []);                 // profit: solid
      if (g.yStop != null) box(g.yEntry, g.yStop, c.riskColor, [5, 4]);              // risk: dashed
      else if (g.yMae != null) box(g.yEntry, g.yMae, c.riskColor, [2, 3]);           // no stop: dotted, estimated
      if (g.yTarget != null) horizontal(g.yExit, c.textColor, [], 0.7);              // where it was actually closed
      if (g.yStop != null && g.yMae != null) horizontal(g.yMae, c.riskColor, [2, 3], 0.9);
      if (g.yMfe != null && yProfit != null) horizontal(g.yMfe, c.frameColor, [2, 3], 0.8);
      horizontal(g.yEntry, c.textColor, [], 0.55);

      // Execution path, entry to exit.
      ctx.globalAlpha = strength;
      ctx.strokeStyle = c.pathColor;
      ctx.lineWidth = 1.5 * sx;
      ctx.setLineDash([6 * sx, 4 * sx]);
      ctx.beginPath();
      ctx.moveTo(g.x1 * sx, g.yEntry * sy);
      ctx.lineTo(g.x2 * sx, g.yExit * sy);
      ctx.stroke();
      ctx.setLineDash([]);
      const dot = (x: number, yValue: number, fill: string) => {
        ctx.beginPath();
        ctx.arc(x * sx, yValue * sy, 3.5 * sx, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = line;
        ctx.strokeStyle = c.pillBackground;
        ctx.stroke();
      };
      dot(g.x1, g.yEntry, c.textColor);
      dot(g.x2, g.yExit, c.pathColor);
      ctx.globalAlpha = 1;
    });

    if (!c.pill) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = PILL_FONT;
      const width = Math.ceil(ctx.measureText(c.pill).width) + 16;
      const height = 22;
      const ys = [g.yEntry, g.yExit, g.yStop, g.yTarget, g.yMae].filter((value): value is number => value != null);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      // Clear of the fill markers, which sit just outside the entry and exit bars.
      let yPill = top - height - 24;
      if (yPill < 4) yPill = Math.min(mediaSize.height - height - 4, bottom + 24);
      const xPill = Math.max(4, Math.min(mediaSize.width - width - 4, (g.left + g.right) / 2 - width / 2));
      ctx.globalAlpha = this.xray ? 0.5 : 1;
      ctx.beginPath();
      ctx.roundRect(xPill, yPill, width, height, 7);
      ctx.fillStyle = c.pillBackground;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.frameColor;
      ctx.stroke();
      ctx.fillStyle = c.pillTone === "profit" ? c.profitColor : c.pillTone === "risk" ? c.riskColor : c.textColor;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(c.pill, xPill + width / 2, yPill + height / 2 + 0.5);
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
    if (!chart || !series) { this.geometry = null; return; }
    const timeScale = chart.timeScale();
    const x1 = timeScale.timeToCoordinate(config.entryTime);
    const x2 = timeScale.timeToCoordinate(config.exitTime);
    const price = (value: number | null): Coordinate | null => (value == null ? null : series.priceToCoordinate(value));
    const yEntry = price(config.entryPrice);
    const yExit = price(config.exitPrice);
    if (x1 == null || x2 == null || yEntry == null || yExit == null) { this.geometry = null; return; }
    // Cover the whole entry and exit bars, so a trade inside one bar is still a visible box.
    const half = Math.max(3, timeScale.options().barSpacing / 2);
    this.geometry = {
      left: Math.min(x1, x2) - half, right: Math.max(x1, x2) + half, x1, x2, yEntry, yExit,
      yStop: price(config.stopPrice), yTarget: price(config.targetPrice), yMae: price(config.maePrice), yMfe: price(config.mfePrice),
    };
  }

  paneViews() { return this.views; }

  /** Keep the stop and target inside the price scale, so the box is never clipped by auto-fit. */
  autoscaleInfo(): AutoscaleInfo | null {
    const { entryPrice, exitPrice, stopPrice, targetPrice } = this.config;
    const prices = [entryPrice, exitPrice, stopPrice, targetPrice].filter((value): value is number => value != null);
    return { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } };
  }

  update(config: PositionBoxConfig) {
    this.config = config;
    this.requestUpdate?.();
  }

  /** X-Ray: fade the box to 5% so the candles underneath can be read (UX-42). */
  setXray(on: boolean) {
    if (this.xray === on) return;
    this.xray = on;
    this.requestUpdate?.();
  }
}
