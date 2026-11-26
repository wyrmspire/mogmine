// IK-1: VWAP standard-deviation bands and optional fill, painted in the chart canvas (Invariant 1).
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";
import type { VwapBandPoint } from "@/lib/chart-indicators";

export interface IndicatorBandLayer {
  bands: readonly (readonly VwapBandPoint[])[];
  color: string;
  dashed?: boolean;
}

export class IndicatorBandsPrimitive implements ISeriesPrimitive<Time> {
  private attachment?: SeriesAttachedParameter<Time>;
  private layers: readonly IndicatorBandLayer[] = [];
  private fill = false;
  private readonly views: readonly IPrimitivePaneView[] = [{
    zOrder: () => "bottom",
    renderer: () => ({ draw: (target) => this.draw(target) }),
  }];

  attached(param: SeriesAttachedParameter<Time>) { this.attachment = param; }
  detached() { this.attachment = undefined; }
  paneViews() { return this.views; }
  autoscaleInfo() { return null; }

  update(layers: readonly IndicatorBandLayer[], fill: boolean) {
    this.layers = layers;
    this.fill = fill;
    this.attachment?.requestUpdate();
  }

  private draw(target: CanvasRenderingTarget2D) {
    const { attachment } = this;
    if (!attachment || !this.layers.some((layer) => layer.bands.length)) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      ctx.save();
      ctx.lineWidth = 1;
      for (const layer of this.layers) {
        ctx.strokeStyle = layer.color;
        ctx.fillStyle = layer.color;
        ctx.setLineDash(layer.dashed ? [4, 4] : []);
        layer.bands.forEach((series, rank) => {
          const points = series.flatMap((point) => {
            const x = attachment.chart.timeScale().timeToCoordinate(Math.floor(point.time / 1000) as UTCTimestamp);
            const upper = attachment.series.priceToCoordinate(point.upper);
            const lower = attachment.series.priceToCoordinate(point.lower);
            return x == null || upper == null || lower == null ? [] : [{ x, upper, lower }];
          });
          if (points.length < 2) return;
          if (this.fill) {
            ctx.globalAlpha = rank === 0 ? 0.045 : 0.025;
            ctx.beginPath();
            points.forEach((point, index) => index ? ctx.lineTo(point.x, point.upper) : ctx.moveTo(point.x, point.upper));
            for (let index = points.length - 1; index >= 0; index -= 1) ctx.lineTo(points[index].x, points[index].lower);
            ctx.closePath();
            ctx.fill();
          }
          ctx.globalAlpha = rank === 0 ? 0.55 : 0.35;
          for (const edge of ["upper", "lower"] as const) {
            ctx.beginPath();
            points.forEach((point, index) => index ? ctx.lineTo(point.x, point[edge]) : ctx.moveTo(point.x, point[edge]));
            ctx.stroke();
          }
        });
      }
      ctx.restore();
    });
  }
}
