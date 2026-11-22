// LV-2: computed levels as 1 px rays with right-edge price pills (docs/12 §5 LV-08/LV-09, docs/24 §5).
// Canvas only (Invariant 1), colours from theme tokens (Invariant 5). Levels never feed autoscale, so a
// distant level does not compress the price scale; offscreen levels are simply not drawn. Pills paint on
// top so two texts never overlap; a pill can cover a trade label, whose value also shows in the stats row.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";
// Relative with extension so node tests and the Chrome check can load this file directly.
import { stackLabels } from "../lib/label-stack.ts";
import type { LevelLine, LevelRole } from "@/lib/chart-levels";
import type { ChartTheme } from "@/lib/theme";

const FONT = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
const PILL_HEIGHT = 16;
const PILL_PAD = 5;
const RIGHT_INSET = 2;

function roleColor(theme: ChartTheme, role: LevelRole) {
  return role === "resistance" ? theme.levelResistance
    : role === "support" ? theme.levelSupport
      : role === "adr" ? theme.levelAdr : theme.levelNeutral;
}

export class SessionLevelsPrimitive implements ISeriesPrimitive<Time> {
  private attachment?: SeriesAttachedParameter<Time>;
  private lines: readonly LevelLine[] = [];
  private theme?: ChartTheme;
  private barMs = 60_000;
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target, "rays") }) },
    { zOrder: () => "top", renderer: () => ({ draw: (target) => this.draw(target, "labels") }) },
  ];

  attached(param: SeriesAttachedParameter<Time>) { this.attachment = param; }
  detached() { this.attachment = undefined; }
  paneViews() { return this.views; }
  /** Never widen the price scale for a level: distant levels must not compress the trade (docs/12 §5). */
  autoscaleInfo() { return null; }

  /** `barMs` is the displayed bar size: a level's start time snaps to the bar that holds it (B-23). */
  update(lines: readonly LevelLine[], theme: ChartTheme, barMs: number) {
    this.lines = lines;
    this.theme = theme;
    this.barMs = barMs;
    this.attachment?.requestUpdate();
  }

  private draw(target: CanvasRenderingTarget2D, layer: "rays" | "labels") {
    const { attachment, theme } = this;
    if (!attachment || !theme || !this.lines.length) return;
    const scale = attachment.chart.timeScale();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize: pane }) => {
      const visible = this.lines.flatMap((line) => {
        const y = attachment.series.priceToCoordinate(line.price);
        return y == null || y < 0 || y > pane.height ? [] : [{ line, y: Math.round(y) + 0.5 }];
      });
      if (!visible.length) return;
      ctx.save();
      ctx.font = FONT;
      if (layer === "rays") {
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.8;
        for (const { line, y } of visible) {
          let x0 = 0;
          if (line.startAt != null) {
            const bar = Math.floor(line.startAt / this.barMs) * this.barMs;
            const x = scale.timeToCoordinate(Math.floor(bar / 1000) as UTCTimestamp);
            // The forming bar is off the loaded data: draw from the edge rather than guess (B-23).
            if (x != null) x0 = Math.max(0, Math.min(pane.width, x));
          }
          ctx.strokeStyle = roleColor(theme, line.role);
          ctx.setLineDash(line.proxy ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(pane.width, y);
          ctx.stroke();
        }
      } else {
        const placed = stackLabels(visible.map(({ y }) => y), PILL_HEIGHT + 1, 0, pane.height);
        visible.forEach(({ line, y }, index) => {
          const width = Math.ceil(ctx.measureText(line.label).width) + PILL_PAD * 2 + 3;
          const right = pane.width - RIGHT_INSET;
          const left = right - width;
          const top = Math.round(placed[index] - PILL_HEIGHT / 2);
          const color = roleColor(theme, line.role);
          ctx.setLineDash([]);
          if (Math.abs(placed[index] - y) > 1) {
            // Leader tick back to the true price when the pill was stacked away from it.
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(left - 6, y);
            ctx.lineTo(left, placed[index]);
            ctx.stroke();
          }
          ctx.globalAlpha = 0.82;
          ctx.fillStyle = theme.surface;
          ctx.fillRect(left, top, width, PILL_HEIGHT);
          ctx.globalAlpha = 1;
          ctx.fillStyle = color;
          ctx.fillRect(left, top, 3, PILL_HEIGHT);
          ctx.fillStyle = theme.levelLabelText;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(line.label, left + 3 + PILL_PAD, top + PILL_HEIGHT / 2 + 0.5);
        });
      }
      ctx.restore();
    });
  }
}
