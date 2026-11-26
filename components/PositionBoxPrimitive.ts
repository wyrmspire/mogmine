// Canvas display-list painter. Marks arrive in price and UTC bar-open coordinates.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  AutoscaleInfo, IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, PrimitiveHoveredItem, SeriesAttachedParameter, Time, UTCTimestamp,
} from "lightweight-charts";
import { CHART_TOKENS, CHIP_EXPORT_HEIGHT, DASH, chipWidth, crisp, dashFor, drawChip, drawFlag, strokeLine, subtractRects, withAlpha, zoneAlpha, zoneGradient } from "../lib/chart-paint.ts";
import type { PaintRect } from "../lib/chart-paint.ts";
import { createPositionAxisViews, extractTradeAxisTags, isRulerLabel, isRulerSegment } from "../lib/position-axis-views.ts";
import { separateLabels } from "../lib/label-stack.ts";
import type { ChartTheme } from "../lib/theme.ts";
import type { FlagMark, Mark, SegmentMark } from "../lib/trade-marks.ts";
import type { NeighbourTradeProjection } from "../lib/neighbour-trades.ts";
import { buildActualLotEnvelopes, type ActualLotZone } from "../lib/lot-envelope.ts";

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

const EDGE_INSET = 4;
type Area = PaintRect;
type Tone = FlagMark["tone"];
type Chip = { bg: string; fg: string };

function markPrices(mark: Mark): number[] {
  switch (mark.kind) {
    case "flag": return [mark.price];
    case "label": return [mark.anchor.price];
    case "bracket": return [mark.pLow, mark.pMid, mark.pHigh];
    case "segment": return mark.paneEdge === "both" ? [] : [mark.p0, mark.p1];
    default: return [mark.p0, mark.p1];
  }
}

/** Solid, planned dashes (6 4) or round-capped inferred dots (2 3). Dots are only for inferred values (08 §3.5). */
function setDash(ctx: CanvasRenderingContext2D, dash: SegmentMark["dash"]) {
  ctx.setLineDash(dashFor(dash));
  ctx.lineCap = dash === "dotted" ? "round" : "butt";
}

export class PositionBoxPrimitive implements ISeriesPrimitive<Time> {
  private attachment?: SeriesAttachedParameter<Time>;
  private marks: readonly Mark[] = [];
  private theme?: ChartTheme;
  private priceRange: AutoscaleInfo | null = null;
  private archivedRects: ArchivedBoxRect[] = [];
  private neighbourTrades?: readonly NeighbourTradeProjection[];
  private exporting = false;
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

  /** Trade Card export: chips at 18 px with 11.5 px text, crisp at 2× (08 §4.3). Called by UX-E4. */
  setExportMode(exporting = false) {
    this.exporting = exporting;
    this.attachment?.requestUpdate();
  }

  /** The selected trade's entry, stop, target and exit as price-axis tags (D-V3). Archived neighbours are excluded. */
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const { attachment, theme } = this;
    if (!attachment || !theme) return [];
    return createPositionAxisViews(extractTradeAxisTags(this.marks, theme), (p) => attachment.series.priceToCoordinate(p), attachment.chart.paneSize().height);
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
    const zoneColor = (tone: Tone) => tone === "profit" ? theme.zoneReward
      : tone === "risk" ? theme.zoneRisk : tone === "entry" ? theme.entryLine : theme.labelMuted;
    const chipFor = (tone: Tone | "ghost"): Chip => (tone === "ghost" ? { bg: theme.chipGhost, fg: CHART_TOKENS.chip.ghostText }
      : tone === "profit" ? { bg: theme.chipReward, fg: CHART_TOKENS.chip.text }
        : tone === "risk" ? { bg: theme.chipRisk, fg: CHART_TOKENS.chip.text }
          : { bg: theme.chipNeutral, fg: CHART_TOKENS.chip.neutralText });
    // Words use the sans face, numbers the mono face (08 §4.3). Both come from --font-* via lib/theme.ts.
    // Export chips are 18 px tall with 11.5 px text; live chips are 16 px with 10.5 px (08 §4.3).
    const chipH = this.exporting ? CHIP_EXPORT_HEIGHT : CHART_TOKENS.chip.height;
    const chipHalf = chipH / 2;
    const chipPx = this.exporting ? 11.5 : 10.5;
    const chipFont = (label: string) => (/\d/.test(label) ? `500 ${chipPx}px ${theme.fontMono}` : `600 ${chipPx}px ${theme.fontSans}`);
    const dpr = target.useBitmapCoordinateSpace(({ verticalPixelRatio }) => verticalPixelRatio);

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize: pane }) => {
      const recordedArchived: ArchivedBoxRect[] = [];
      const measureChip = (label: string) => { ctx.font = chipFont(label); return chipWidth(ctx.measureText(label).width); };
      // Labels are queued with the style they were asked for and drawn last, after overlapping ones
      // are stacked apart (UX-a), so a flag's text never prints on top of a bracket's. Every label is a chip (08 §3.4).
      const queued: { label: string; x: number; y: number; width: number; chip: Chip; font: string; alpha: number }[] = [];
      const text = (label: string, atX: number, atY: number, chip: Chip) => {
        if (!label) return;
        const width = measureChip(label);
        queued.push({
          label, width, chip, font: chipFont(label), alpha: ctx.globalAlpha,
          x: Math.max(2, Math.min(atX, pane.width - width - 2)),
          y: Math.min(pane.height - chipHalf, Math.max(chipHalf, atY)),
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
      // Actual lots become envelopes first, so plan fills can be cut around them (08 §4.4, §5).
      const lotZones = this.marks.flatMap((mark): ActualLotZone[] => {
        if (mark.kind !== "zone" || mark.layer !== "actual") return [];
        const [xa, xb, ya, yb] = [x(mark.t0), x(mark.t1), y(mark.p0), y(mark.p1)];
        const rect = xa == null || xb == null || ya == null || yb == null ? null : bounds(xa, xb, ya, yb);
        return rect && ya != null && yb != null ? [{ tone: mark.tone, rect, y0: ya, y1: yb, label: mark.label, approximate: mark.approximate, opacityMultiplier: mark.opacityMultiplier }] : [];
      });
      const envelopes = buildActualLotEnvelopes(lotZones), actualRects = envelopes.flatMap((envelope) => envelope.slices);
      // Zone chips sit just outside the zone's right edge, flipping inside only at the price axis (08 §4.3).
      const zoneLabel = (label: string, tone: Tone, { x: left, y: top, width, height }: Area) => {
        const outside = left + width + 4;
        if (height >= 13) text(label, outside + measureChip(label) <= pane.width ? outside : left + width - 4 - measureChip(label), top + height / 2, chipFor(tone));
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
            ctx.save();
            ctx.globalAlpha *= CHART_TOKENS.line.bracketAlpha;
            setDash(ctx, "solid");
            strokeLine(ctx, bx, low, bx, high);
            for (const cap of [low, atY, high]) strokeLine(ctx, bx - 3, cap, bx + 3, cap);
            ctx.restore();
            const width = Math.max(measureChip(mark.labels.low), measureChip(mark.labels.high));
            const labelX = bx + width + 7 <= pane.width ? bx + 6 : bx - width - 6;
            text(mark.labels.low, labelX, low + (low - high < 13 ? 7 : 0), chipFor("ghost"));
            text(mark.labels.high, labelX, high - (low - high < 13 ? 7 : 0), chipFor("ghost"));
            return;
          }
          if (atY < 0 || atY > pane.height) return;
          if (mark.kind === "label") {
            if (isRulerLabel(mark)) {
              // R-ruler labels are quiet text at the box's left edge, not pills over candles (08 §5).
              ctx.globalAlpha *= 0.8;
              ctx.font = `10px ${theme.fontMono}`;
              ctx.fillStyle = theme.labelMuted;
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillText(mark.text, atX + 4, atY);
              return;
            }
            text(mark.text, atX + 5, atY - 8, chipFor(mark.tone));
            return;
          }
          // Chartbg halo first, so the flag separates from the candle behind it (08 §4.2).
          ctx.save();
          ctx.strokeStyle = theme.chartBg;
          ctx.lineWidth = 3;
          drawFlag(ctx, mark, atX, atY, true);
          ctx.restore();
          ctx.fillStyle = ctx.strokeStyle = zoneColor(mark.tone);
          ctx.lineWidth = 1.25;
          if (mark.basis === "inferred") setDash(ctx, "dotted");
          drawFlag(ctx, mark, atX, atY, false);
          const flagText = mark.shape === "cross" && mark.text === "✕" ? "" : mark.text;
          const approximate = mark.approximate || (mark.basis === "inferred" && !!mark.text);
          const label = approximate && !flagText.startsWith("≈") ? `≈ ${flagText}`.trimEnd() : flagText;
          const width = measureChip(label);
          text(label, atX + width + 8 <= pane.width ? atX + 7 : atX - width - 7, atY < 14 ? atY + 10 : atY - 8, chipFor(mark.tone));
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
          if (isRulerSegment(mark)) {
            // R-ruler lines: [2, 4] butt-capped dashes at 0.35 in labelMuted (08 §4.2).
            ctx.globalAlpha *= 0.35;
            ctx.strokeStyle = theme.labelMuted;
            ctx.lineCap = "butt";
            ctx.setLineDash([...DASH.ruler]);
          } else {
            if (mark.faint) ctx.globalAlpha *= edge === "both" ? 0.4 : 0.5;
            // Hairlines are 1 px at most (08 §4.2). Flat lines snap to the device pixel grid.
            ctx.lineWidth = Math.min(mark.width ?? 1, 1.25);
            setDash(ctx, mark.basis === "inferred" ? "dotted" : mark.dash);
          }
          const flat = y0 === y1;
          const ya = flat ? crisp(y0, dpr, ctx.lineWidth) : y0;
          if (x0 === x1 && flat) strokeLine(ctx, x0 - halfBar, ya, x1 + halfBar, ya);
          else strokeLine(ctx, x0, ya, x1, flat ? ya : y1);
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
          ctx.globalAlpha *= mark.faint ? 0.15 : 0.3;
          setDash(ctx, mark.basis === "inferred" ? "dotted" : "solid");
          for (let dx = -height; dx < width; dx += 5) {
            strokeLine(ctx, left + dx, top + height, left + dx + height, top);
          }
          ctx.restore();
          // A 1 px top and bottom edge stops the hatch reading as a loose pattern (08 §4.2).
          ctx.save();
          ctx.globalAlpha *= 0.6;
          for (const edgeY of [top, top + height]) strokeLine(ctx, left, crisp(edgeY, dpr), left + width, crisp(edgeY, dpr));
          ctx.restore();
          if (mark.label) text(mark.label, left + 5, top + height / 2, chipFor(mark.tone));
        } else if (!fills) {
          // The far price (target, stop or exit) gets a 1 px edge rule: solid for actual, planned dashes for plan.
          if (mark.layer === "plan" && mark.style === "dotted") {
            ctx.save();
            ctx.globalAlpha *= 0.5;
            ctx.setLineDash([...DASH.cancelled]);
            ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
            ctx.restore();
          } else if (mark.layer === "plan") {
            ctx.save();
            ctx.globalAlpha *= CHART_TOKENS.zone.edgePlan;
            setDash(ctx, "dashed");
            const edgeY = crisp(y1, dpr);
            strokeLine(ctx, left, edgeY, left + width, edgeY);
            ctx.restore();
          }
          if (mark.label) zoneLabel(mark.label, mark.tone, area);
        } else {
          // Zone fills: one tier per area. Actual zones fade from entry to far price; plan fills are flat and
          // are cut out wherever an actual zone sits, so no two translucent fills stack (08 §3.3).
          const strength = theme.boxOpacity * (mark.opacityMultiplier ?? 1) * ctx.globalAlpha;
          const color = zoneColor(mark.tone);
          ctx.globalAlpha = 1;
          if (mark.layer === "archived") {
            ctx.fillStyle = withAlpha(color, Math.min(strength, CHART_TOKENS.zone.archivedMaxAlpha));
            ctx.fillRect(left, top, width, height);
            ctx.save();
            ctx.globalAlpha = 0.45;
            ctx.strokeStyle = theme.labelMuted;
            ctx.setLineDash([...DASH.archived]);
            ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);
            ctx.restore();
          } else {
            const factor = mark.style === "dotted" ? CHART_TOKENS.zone.cancelledFactor : CHART_TOKENS.zone.planFactor;
            ctx.fillStyle = withAlpha(color, zoneAlpha(factor, strength));
            for (const piece of subtractRects({ x: left, y: top, width, height }, actualRects)) {
              ctx.fillRect(piece.x, piece.y, piece.width, piece.height);
            }
          }
        }
      };

      for (const mark of this.marks) {
        if ((fills && mark.kind !== "zone") || (mark.kind === "zone" && mark.layer === "actual")) continue; // envelopes below
        ctx.save();
        ctx.lineWidth = 1;
        if ("tone" in mark) ctx.fillStyle = ctx.strokeStyle = zoneColor(mark.tone);
        if (mark.approximate) ctx.globalAlpha = 0.72;
        paint(mark);
        ctx.restore();
      }

      // Envelopes (08 §5): one shared gradient fill, a 1 px far edge and lot separators. No per-lot opacity steps.
      ctx.save(); ctx.lineWidth = 1;
      for (const env of envelopes) {
        const base = env.approximate ? 0.72 : 1;
        ctx.globalAlpha = base; ctx.strokeStyle = zoneColor(env.tone);
        if (fills) {
          const strength = theme.boxOpacity * env.opacityMultiplier * base;
          ctx.fillStyle = zoneGradient(ctx, env.entryY, env.farY, zoneColor(env.tone), zoneAlpha(CHART_TOKENS.zone.nearFactor, strength), zoneAlpha(CHART_TOKENS.zone.farFactor, strength));
          for (const s of env.slices) ctx.fillRect(s.x, s.y, s.width, s.height);
        } else {
          if (env.label) zoneLabel(env.label, env.tone, env.rect);
          for (const seg of [...env.farEdges, ...env.separators]) { ctx.globalAlpha = base * seg.alpha; strokeLine(ctx, seg.x0, crisp(seg.y, dpr), seg.x1, crisp(seg.y, dpr)); }
        }
      }
      ctx.restore();

      if (fills) {
        this.archivedRects = recordedArchived;
      }

      if (!queued.length) return;
      const ys = separateLabels(queued, chipH + 2, 0, pane.height);
      queued.forEach((item, index) => {
        ctx.save();
        ctx.globalAlpha = item.alpha;
        // A chip pushed more than 2 px from its anchor gets a crisp leader back to it (08 §4.3).
        if (Math.abs(ys[index] - item.y) > 2) {
          ctx.globalAlpha = item.alpha * 0.6; ctx.strokeStyle = item.chip.bg; ctx.lineWidth = 1;
          strokeLine(ctx, item.x - 5, crisp(item.y, dpr), item.x, crisp(ys[index], dpr));
          ctx.globalAlpha = item.alpha;
        }
        drawChip(ctx, item.x, ys[index] - chipHalf, item.width, chipH, CHART_TOKENS.chip.radius, item.chip.bg);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.font = item.font;
        ctx.fillStyle = item.chip.fg;
        ctx.fillText(item.label, item.x + CHART_TOKENS.chip.padX, ys[index]);
        ctx.restore();
      });
    });
  }
}
