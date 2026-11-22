// Canvas display-list painter. Marks arrive in price and UTC bar-open coordinates.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  AutoscaleInfo, IPrimitivePaneView, ISeriesPrimitive, PrimitiveHoveredItem, SeriesAttachedParameter, Time, UTCTimestamp,
} from "lightweight-charts";
import { separateLabels } from "../lib/label-stack.ts";
import type { ChartTheme } from "../lib/theme.ts";
import type { FlagMark, Mark, SegmentMark } from "../lib/trade-marks.ts";
import type { NeighbourTradeProjection } from "../lib/neighbour-trades.ts";

export interface ArchivedBoxRect {
  tradeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure hit-testing helper checking pointer coordinates (x, y) against rendered
 * layer === "archived" box rectangles (#40, K-UI).
 * Returns the matching tradeId or null.
 *
 * When rects overlap, searches in reverse order so the topmost (most recently drawn)
 * rect takes precedence. Handles boundary touches, zero/negative dimensions, and tolerances.
 */
export function hitTestArchivedBoxes(
  x: number,
  y: number,
  rects: readonly ArchivedBoxRect[] | null | undefined,
  tolerance = 0,
): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !rects || rects.length === 0) {
    return null;
  }
  const tol = Math.max(0, Number.isFinite(tolerance) ? tolerance : 0);
  for (let i = rects.length - 1; i >= 0; i--) {
    const rect = rects[i];
    if (!rect || !rect.tradeId) continue;
    const minX = Math.min(rect.x, rect.x + rect.width) - tol;
    const maxX = Math.max(rect.x, rect.x + rect.width) + tol;
    const minY = Math.min(rect.y, rect.y + rect.height) - tol;
    const maxY = Math.max(rect.y, rect.y + rect.height) + tol;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
      return rect.tradeId;
    }
  }
  return null;
}

export const hitTestArchivedMark = hitTestArchivedBoxes;

const PLAN_FILL_RATIO = 0.28;
const EDGE_INSET = 4;
/** Line height for chart labels (10–11 px monospace); labels closer than this are stacked apart. */
const LABEL_HEIGHT = 12;
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
  private archivedRects: ArchivedBoxRect[] = [];
  private neighbourTrades?: readonly NeighbourTradeProjection[];
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target, true) }) },
    { zOrder: () => "normal", renderer: () => ({ draw: (target) => this.draw(target, false) }) },
  ];

  attached(param: SeriesAttachedParameter<Time>) { this.attachment = param; }
  detached() {
    this.attachment = undefined;
    this.archivedRects = [];
  }
  paneViews() { return this.views; }
  autoscaleInfo() { return this.priceRange; }

  setNeighbourTrades(trades?: readonly NeighbourTradeProjection[]) {
    this.neighbourTrades = trades;
  }

  getArchivedRects(): readonly ArchivedBoxRect[] {
    return this.archivedRects;
  }

  /**
   * Hit test implementation matching lightweight-charts ISeriesPrimitive interface.
   * Returns a PrimitiveHoveredItem containing the neighbour tradeId in externalId,
   * with cursorStyle: 'pointer' so the chart displays a pointer cursor on hover.
   */
  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const tradeId = hitTestArchivedBoxes(x, y, this.archivedRects);
    if (!tradeId) return null;
    return {
      externalId: tradeId,
      zOrder: "normal",
      cursorStyle: "pointer",
    };
  }

  /** Direct helper returning the hit tradeId string or null */
  hitTestTradeId(x: number, y: number): string | null {
    return hitTestArchivedBoxes(x, y, this.archivedRects);
  }

  update(marks: readonly Mark[], theme: ChartTheme, neighbourTrades?: readonly NeighbourTradeProjection[]) {
    if (this.marks !== marks) {
      this.marks = marks;
      const prices = marks.flatMap(markPrices);
      this.priceRange = prices.length
        ? { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } } : null;
    }
    this.theme = theme;
    if (neighbourTrades !== undefined) {
      this.neighbourTrades = neighbourTrades;
    }
    this.attachment?.requestUpdate();
  }

  private resolveNeighbourTradeId(mark: Mark): string | null {
    const anyMark = mark as { tradeId?: string; trade_id?: string; id?: string };
    if (anyMark.tradeId) return anyMark.tradeId;
    if (anyMark.trade_id) return anyMark.trade_id;
    if (anyMark.id) return anyMark.id;

    if (!this.neighbourTrades || this.neighbourTrades.length === 0) return null;
    if (mark.kind !== "zone" && mark.kind !== "segment") return null;

    for (const nb of this.neighbourTrades) {
      const nbEntryMs = Date.parse(nb.entryTime);
      const nbExitMs = nb.exitTime ? Date.parse(nb.exitTime) : nbEntryMs;
      const t0 = Math.min(nbEntryMs, nbExitMs);
      const t1 = Math.max(nbEntryMs, nbExitMs);

      const priceMatch = (mark.p0 === nb.entryPrice && mark.p1 === nb.exitPrice) ||
        (mark.p0 === nb.exitPrice && mark.p1 === nb.entryPrice) ||
        (mark.p0 === nb.entryPrice && (nb.exitPrice == null || mark.p1 === nb.entryPrice));
      const timeMatch = Math.abs(t0 - mark.t0) < 60_000 && Math.abs(t1 - mark.t1) < 60_000;

      if (priceMatch && timeMatch) {
        return nb.tradeId;
      }
    }
    return null;
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
      const recordedArchived: ArchivedBoxRect[] = [];
      // Labels are queued with the style they were asked for and drawn last, after overlapping ones
      // are stacked apart (UX-a), so a flag's text never prints on top of a bracket's.
      const queued: { label: string; x: number; y: number; width: number; fill: CanvasRenderingContext2D["fillStyle"]; font: string; alpha: number }[] = [];
      const text = (label: string, atX: number, atY: number) => {
        if (!label) return;
        const width = ctx.measureText(label).width;
        queued.push({
          label, width, fill: ctx.fillStyle, font: ctx.font, alpha: ctx.globalAlpha,
          x: Math.max(2, Math.min(atX, pane.width - width - 2)),
          y: Math.min(pane.height - 7, Math.max(7, atY)),
        });
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
          if (!fills && mark.layer === "archived") {
            const tradeId = this.resolveNeighbourTradeId(mark);
            if (tradeId) {
              const minX = Math.min(x0, x1) - halfBar;
              const maxX = Math.max(x0, x1) + halfBar;
              const segLeft = Math.max(0, Math.round(minX));
              const segRight = Math.min(pane.width, Math.round(maxX));
              if (segRight > segLeft) {
                this.archivedRects.push({
                  tradeId,
                  x: segLeft,
                  y: Math.max(0, Math.round(y0 - 4)),
                  width: segRight - segLeft,
                  height: 8,
                });
              }
            }
          }
          return;
        }

        const area = bounds(x0, x1, y0, y1);
        if (!area) return;
        const { x: left, y: top, width, height } = area;
        if (fills && mark.kind === "zone" && mark.layer === "archived") {
          const tradeId = this.resolveNeighbourTradeId(mark);
          if (tradeId) {
            recordedArchived.push({ tradeId, x: left, y: top, width, height });
          }
        }
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

      if (fills) {
        this.archivedRects = recordedArchived;
      }

      if (!queued.length) return;
      const ys = separateLabels(queued, LABEL_HEIGHT, 0, pane.height);
      queued.forEach((item, index) => {
        ctx.save();
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = item.font;
        ctx.fillStyle = item.fill;
        ctx.globalAlpha = item.alpha;
        ctx.fillText(item.label, item.x, ys[index]);
        ctx.restore();
      });
    });
  }
}
