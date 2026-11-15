import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  Coordinate,
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export interface PositionBoxConfig {
  entryTime: Time;
  exitTime: Time;
  entryPrice: number;
  exitPrice: number;
  riskPrice: number;
  targetPrice: number;
  /** Colours and opacity come from the theme store (lib/theme.ts), never from literals (Invariant 5). */
  profitColor: string;
  riskColor: string;
  accent: string;
  opacity: number;
}

interface Coordinates {
  x1: Coordinate | null;
  x2: Coordinate | null;
  yEntry: Coordinate | null;
  yExit: Coordinate | null;
  yRisk: Coordinate | null;
  yTarget: Coordinate | null;
}

class PositionBoxRenderer implements IPrimitivePaneRenderer {
  constructor(private coordinates: Coordinates, private config: PositionBoxConfig) {}

  draw(target: CanvasRenderingTarget2D) {
    target.useBitmapCoordinateSpace((scope) => {
      const { x1, x2, yEntry, yExit, yRisk, yTarget } = this.coordinates;
      if ([x1, x2, yEntry, yExit, yRisk, yTarget].some((value) => value == null)) return;
      const ctx = scope.context;
      const sx = scope.horizontalPixelRatio;
      const sy = scope.verticalPixelRatio;
      const left = Math.min(x1!, x2!) * sx;
      const width = Math.max(4, Math.abs(x2! - x1!)) * sx;
      const profitTop = Math.min(yEntry!, yTarget!) * sy;
      const profitHeight = Math.max(2, Math.abs(yTarget! - yEntry!)) * sy;
      const riskTop = Math.min(yEntry!, yRisk!) * sy;
      const riskHeight = Math.max(2, Math.abs(yRisk! - yEntry!)) * sy;

      ctx.globalAlpha = this.config.opacity;
      ctx.fillStyle = this.config.profitColor;
      ctx.fillRect(left, profitTop, width, profitHeight);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.config.accent;
      ctx.lineWidth = Math.max(1, sx);
      ctx.setLineDash([]);
      ctx.strokeRect(left, profitTop, width, profitHeight);

      ctx.globalAlpha = this.config.opacity;
      ctx.fillStyle = this.config.riskColor;
      ctx.fillRect(left, riskTop, width, riskHeight);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = this.config.riskColor;
      ctx.setLineDash([5 * sx, 4 * sx]);
      ctx.strokeRect(left, riskTop, width, riskHeight);

      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.config.accent;
      ctx.lineWidth = 1.5 * sx;
      ctx.setLineDash([6 * sx, 4 * sx]);
      ctx.beginPath();
      ctx.moveTo(x1! * sx, yEntry! * sy);
      ctx.lineTo(x2! * sx, yExit! * sy);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }
}

class PositionBoxPaneView implements IPrimitivePaneView {
  private coordinates: Coordinates = { x1: null, x2: null, yEntry: null, yExit: null, yRisk: null, yTarget: null };

  constructor(private source: PositionBoxPrimitive) {}

  update() {
    const { chart, series, config } = this.source;
    if (!chart || !series) return;
    this.coordinates = {
      x1: chart.timeScale().timeToCoordinate(config.entryTime),
      x2: chart.timeScale().timeToCoordinate(config.exitTime),
      yEntry: series.priceToCoordinate(config.entryPrice),
      yExit: series.priceToCoordinate(config.exitPrice),
      yRisk: series.priceToCoordinate(config.riskPrice),
      yTarget: series.priceToCoordinate(config.targetPrice),
    };
  }

  renderer() {
    return new PositionBoxRenderer(this.coordinates, this.source.config);
  }

  zOrder() { return "top" as const; }
}

export class PositionBoxPrimitive implements ISeriesPrimitive<Time> {
  chart?: IChartApi;
  series?: ISeriesApi<SeriesType, Time>;
  private requestUpdate?: () => void;
  private readonly views: PositionBoxPaneView[];

  constructor(public config: PositionBoxConfig) {
    this.views = [new PositionBoxPaneView(this)];
  }

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
    this.views.forEach((view) => view.update());
  }

  paneViews() {
    return this.views;
  }

  update(config: PositionBoxConfig) {
    this.config = config;
    this.requestUpdate?.();
  }
}
