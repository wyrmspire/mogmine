// The Position Box: a Canvas series primitive, never HTML over the chart (Invariant 1).
// Drawn like TradingView's long/short position tool: fills only, no outline or frame on any box,
// and no text on the box (the price-axis tags and the P&L pill carry the numbers).
//   PLAN — faint red fill entry→stop, faint green fill entry→target.
//   ACTUAL — a stronger fill entry→exit in the result colour: green win, red loss, gray scratch.
//   EXCURSION — a thin unlabelled MFE/MAE bracket beside the box (numbers live in the stats grid).
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
  /** Approximate excursions during the hold (B-33). Null when they cannot be shown honestly. */
  maePrice: number | null;
  mfePrice: number | null;
  isLong: boolean;
  /** Result is within the scratch threshold: the actual band is gray instead of green or red. */
  scratch: boolean;
  /** Result label drawn on the chart, e.g. `+1.6R · +$47.50`. R only in Shield mode (UX-71). */
  pill: string;
  pillTone: "profit" | "risk" | "neutral";
  profitColor: string;
  riskColor: string;
  profitTextColor?: string;
  riskTextColor?: string;
  mutedColor: string;
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
/** Plan fills stay clearly weaker than the actual band so they cannot be read as P&L. */
const PLAN_FILL_RATIO = 0.28;
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
      const planAlpha = this.opacity * PLAN_FILL_RATIO;
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
      rect(yA, yB, actual, this.opacity);
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
      const y = (value: number) => Math.round(value * sy) + 0.5;
      const line = Math.max(1, Math.floor(sx));

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
        ctx.globalAlpha = strength;
        ctx.fillStyle = color;
        ctx.fill();
      };
      flag(g.x1, g.yEntry, c.isLong, c.textColor);
      flag(g.x2, g.yExit, !c.isLong, resultColor);

      // Excursion bracket in the gap right of the exit bar — no text, never a rectangle or a full-width line.
      const capLow = g.yMae ?? g.yEntry;
      const capHigh = g.yMfe ?? g.yEntry;
      if (g.yMae != null || g.yMfe != null) {
        const cap = 5 * sx;
        const bx = Math.round(g.right * sx + 8 * sx) + 0.5;
        ctx.globalAlpha = strength;
        ctx.strokeStyle = c.mutedColor;
        ctx.lineWidth = line;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(bx - cap, y(capHigh));
        ctx.lineTo(bx + cap, y(capHigh));
        ctx.moveTo(bx, y(capHigh));
        ctx.lineTo(bx, y(capLow));
        ctx.moveTo(bx - cap, y(capLow));
        ctx.lineTo(bx + cap, y(capLow));
        ctx.moveTo(bx - cap * 0.6, y(g.yEntry));
        ctx.lineTo(bx + cap * 0.6, y(g.yEntry));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      if (!c.pill) return;
      ctx.font = PILL_FONT;
      const width = Math.ceil(ctx.measureText(c.pill).width) + 16;
      const height = 22;
      // Attach the pill to the exit flag, above it when there is room.
      let yPill = g.yExit - height - 14;
      if (yPill < 4) yPill = Math.min(mediaSize.height - height - 4, g.yExit + 14);
      let xPill = Math.max(4, Math.min(mediaSize.width - width - 4, g.x2 - width / 2));
      // Keep it clear of the excursion bracket on the right.
      if (g.yMae != null || g.yMfe != null) {
        const rightLimit = g.right - 4;
        if (xPill + width > rightLimit) xPill = Math.max(4, rightLimit - width);
      }
      ctx.globalAlpha = this.xray ? 0.5 : 1;
      ctx.beginPath();
      ctx.roundRect(xPill, yPill, width, height, 7);
      ctx.fillStyle = c.pillBackground;
      ctx.fill();
      const profitText = c.profitTextColor || c.profitColor;
      const riskText = c.riskTextColor || c.riskColor;
      ctx.fillStyle = c.pillTone === "profit" ? profitText : c.pillTone === "risk" ? riskText : c.textColor;
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
    const priceRange = includeInPriceRange(null, [entryPrice, exitPrice, stopPrice, targetPrice]);
    return priceRange ? { priceRange } : null;
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
