// Canvas display-list painter. Marks arrive in price and UTC bar-open coordinates.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  AutoscaleInfo, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp,
} from "lightweight-charts";
import type { ChartTheme } from "@/lib/theme";
import type { FlagMark, Mark, SegmentMark } from "@/lib/trade-marks";

const PLAN_FILL_RATIO = 0.28;
const EDGE_INSET = 4;
type Area = { x: number; y: number; width: number; height: number };

function markPrices(mark: Mark): number[] {
  switch (mark.kind) {
    case "flag": return [mark.price];
    case "label": return [mark.anchor.price];
    case "bracket": return [mark.pLow, mark.pMid, mark.pHigh];
    case "segment": return mark.paneEdge === "both" ? [] : [mark.p0, mark.p1];
    default: return [mark.p0, mark.p1];
  }
}

function setDash(ctx: CanvasRenderingContext2D, dash: SegmentMark["dash"]) {
  ctx.setLineDash(dash === "solid" ? [] : dash === "dashed" ? [4, 3] : [1, 3]);
}

function strokeLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawFlag(ctx: CanvasRenderingContext2D, mark: FlagMark, x: number, y: number) {
  ctx.beginPath();
  if (mark.shape === "dot") {
    ctx.arc(x, y, mark.hollow ? 3 : 4, 0, 2 * Math.PI);
    ctx.stroke();
  } else if (mark.shape === "cross") {
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
  } else {
    const direction = mark.shape.endsWith("_up") ? -1 : 1;
    ctx.moveTo(x, y + direction * 6);
    ctx.lineTo(x + 4, y - direction * 3);
    ctx.lineTo(x - 4, y - direction * 3);
    ctx.closePath();
    if (mark.hollow || mark.basis === "inferred") ctx.stroke();
    else ctx.fill();
  }
}

export class PositionBoxPrimitive implements ISeriesPrimitive<Time> {
  private attachment?: SeriesAttachedParameter<Time>;
  private marks: readonly Mark[] = [];
  private theme?: ChartTheme;
  private priceRange: AutoscaleInfo | null = null;
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target, true) }) },
    { zOrder: () => "normal", renderer: () => ({ draw: (target) => this.draw(target, false) }) },
  ];

  attached(param: SeriesAttachedParameter<Time>) { this.attachment = param; }
  detached() { this.attachment = undefined; }
  paneViews() { return this.views; }
  autoscaleInfo() { return this.priceRange; }

  update(marks: readonly Mark[], theme: ChartTheme) {
    if (this.marks !== marks) {
      this.marks = marks;
      const prices = marks.flatMap(markPrices);
      this.priceRange = prices.length
        ? { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } } : null;
    }
    this.theme = theme;
    this.attachment?.requestUpdate();
  }

  private draw(target: CanvasRenderingTarget2D, fills: boolean) {
    const { attachment, theme } = this;
    if (!attachment || !theme) return;
    const scale = attachment.chart.timeScale();
    const x = (t: number) => scale.timeToCoordinate(Math.floor(t / 1000) as UTCTimestamp);
    const y = (p: number) => attachment.series.priceToCoordinate(p);
    const halfBar = Math.max(3, scale.options().barSpacing / 2);
    const color = (tone: FlagMark["tone"], text = false) =>
      tone === "profit" ? (text ? theme.profitText : theme.profit)
        : tone === "risk" ? (text ? theme.lossText : theme.risk)
          : tone === "entry" ? theme.textPrimary : theme.textMuted;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize: pane }) => {
      const text = (label: string, atX: number, atY: number) => {
        if (!label) return;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const width = ctx.measureText(label).width;
        ctx.fillText(label, Math.max(2, Math.min(atX, pane.width - width - 2)),
          Math.min(pane.height - 7, Math.max(7, atY)));
      };
      const bounds = (xa: number, xb: number, ya: number, yb: number): Area | null => {
        const left = Math.max(0, Math.round(Math.min(xa, xb) - halfBar));
        const right = Math.min(pane.width, Math.round(Math.max(xa, xb) + halfBar));
        const top = Math.max(0, Math.round(Math.min(ya, yb)));
        const bottom = Math.min(pane.height, Math.max(top + 1, Math.round(Math.max(ya, yb))));
        return right > left && bottom > top && Math.max(ya, yb) >= 0
          ? { x: left, y: top, width: right - left, height: bottom - top } : null;
      };

      const paint = (mark: Mark) => {
        if (mark.kind === "flag" || mark.kind === "label" || mark.kind === "bracket") {
          const atX = x(mark.kind === "label" ? mark.anchor.t : mark.t);
          const atY = y(mark.kind === "label" ? mark.anchor.price : mark.kind === "bracket" ? mark.pMid : mark.price);
          if (atX == null || atY == null || atX < 0 || atX > pane.width) return;
          if (mark.kind === "bracket") {
            const low = y(mark.pLow);
            const high = y(mark.pHigh);
            if (low == null || high == null) return;
            const bx = Math.min(pane.width - 5, atX + halfBar + 5);
            ctx.strokeStyle = theme.textMuted;
            ctx.fillStyle = theme.textPrimary;
            ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
            setDash(ctx, "dotted");
            strokeLine(ctx, bx, low, bx, high);
            setDash(ctx, "solid");
            for (const cap of [low, atY, high]) strokeLine(ctx, bx - 3, cap, bx + 3, cap);
            const width = Math.max(ctx.measureText(mark.labels.low).width, ctx.measureText(mark.labels.high).width);
            const labelX = bx + width + 7 <= pane.width ? bx + 6 : bx - width - 6;
            text(mark.labels.low, labelX, low + (low - high < 13 ? 7 : 0));
            text(mark.labels.high, labelX, high - (low - high < 13 ? 7 : 0));
            return;
          }
          if (atY < 0 || atY > pane.height) return;
          if (mark.kind === "label") {
            text(mark.text, atX + 5, atY - 8);
            return;
          }
          ctx.fillStyle = ctx.strokeStyle = color(mark.tone, !!mark.finding);
          ctx.lineWidth = 1.25;
          if (mark.basis === "inferred") setDash(ctx, "dotted");
          drawFlag(ctx, mark, atX, atY);
          ctx.fillStyle = theme.textPrimary;
          const flagText = mark.shape === "cross" && mark.text === "✕" ? "" : mark.text;
          const approximate = mark.approximate || (mark.basis === "inferred" && !!mark.text);
          const label = approximate && !flagText.startsWith("≈") ? `≈ ${flagText}`.trimEnd() : flagText;
          const width = ctx.measureText(label).width;
          text(label, atX + width + 8 <= pane.width ? atX + 7 : atX - width - 7, atY < 14 ? atY + 10 : atY - 8);
          return;
        }

        const edge = mark.kind === "segment" ? mark.paneEdge : undefined;
        const x0 = edge === "left" ? EDGE_INSET : edge === "both" ? 0 : x(mark.t0);
        const x1 = edge === "right" ? pane.width - EDGE_INSET : edge === "both" ? pane.width : x(mark.t1);
        const y0 = y(mark.p0);
        const y1 = y(mark.p1);
        if (x0 == null || x1 == null || y0 == null || y1 == null) return;
        if (mark.kind === "segment") {
          if (edge && (x1 - x0 < 6 || y0 < 0 || y0 > pane.height)) return;
          if (mark.faint) ctx.globalAlpha *= edge === "both" ? 0.4 : 0.5;
          ctx.lineWidth = mark.width ?? 1;
          setDash(ctx, mark.basis === "inferred" ? "dotted" : mark.dash);
          if (x0 === x1 && y0 === y1) strokeLine(ctx, x0 - halfBar, y0, x1 + halfBar, y1);
          else strokeLine(ctx, x0, y0, x1, y1);
          return;
        }

        const area = bounds(x0, x1, y0, y1);
        if (!area) return;
        const { x: left, y: top, width, height } = area;
        if (mark.kind === "hatch") {
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();
          ctx.globalAlpha *= mark.faint ? 0.25 : 0.55;
          setDash(ctx, mark.basis === "inferred" ? "dotted" : "solid");
          for (let dx = -height; dx < width; dx += 6) {
            strokeLine(ctx, left + dx, top + height, left + dx + height, top);
          }
          ctx.restore();
          if (mark.label) {
            ctx.fillStyle = theme.lossText;
            text(mark.label, left + 5, top + height / 2);
          }
        } else if (!fills) {
          ctx.fillStyle = theme.textMuted;
          if (mark.label && width >= ctx.measureText(mark.label).width + 8 && height >= 13) {
            text(mark.label, left + width - ctx.measureText(mark.label).width - 4, top + height / 2);
          }
        } else {
          ctx.globalAlpha *= theme.boxOpacity * (mark.opacityMultiplier ?? 1);
          if (mark.layer === "plan") ctx.globalAlpha *= PLAN_FILL_RATIO;
          if (mark.layer === "archived") ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.1);
          if (mark.layer === "plan" && mark.style === "dotted") {
            setDash(ctx, "dotted");
            for (let dy = 0.5; dy < height; dy += 3) strokeLine(ctx, left, top + dy, left + width, top + dy);
          } else {
            ctx.fillRect(left, top, width, height);
          }
          if (mark.layer === "archived") {
            ctx.globalAlpha = 0.65;
            ctx.strokeStyle = theme.textMuted;
            setDash(ctx, "dotted");
            ctx.strokeRect(left, top, width, height);
          }
        }
      };

      for (const mark of this.marks) {
        if (fills && mark.kind !== "zone") continue;
        if (!fills && mark.kind === "zone" && !mark.label) continue;
        ctx.save();
        ctx.lineWidth = 1;
        ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
        if ("tone" in mark) ctx.fillStyle = ctx.strokeStyle = color(mark.tone);
        if (mark.approximate) ctx.globalAlpha = 0.72;
        paint(mark);
        ctx.restore();
      }
    });
  }
}
