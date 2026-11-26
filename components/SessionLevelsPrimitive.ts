// LV-2: computed levels as 1 px rays with right-edge price pills (docs/12 §5 LV-08/LV-09, docs/24 §5).
// Canvas only (Invariant 1), colours from theme tokens (Invariant 5). Levels never feed autoscale, so a
// distant level does not compress the price scale; offscreen levels are simply not drawn. Pills come ranked
// (`levelPills`: the trade's own prices, then planned, then nearest the entry) and are laid out every paint at
// the current scale (`layoutPills`), so zoom and resize re-run it. A pill that does not fit is dropped and its
// rays draw faint; the View tooltip still lists the level.
// LB-5/LB-6 (`levelLabels: "tap"`, the default): no pills, rays only, and at most three price-only axis tags for
// the groups nearest the entry. A tap on a ray is read by `hitTestLevel`.
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";
// Relative with extension so node tests and the Chrome check can load this file directly.
import { layoutPills } from "../lib/label-stack.ts";
import { hitLevel, selectAxisTagGroups } from "../lib/level-hit-test.ts";
import type { LevelHit } from "../lib/level-hit-test.ts";
import { formatPrice } from "../lib/format.ts";
import type { LevelLine, LevelPill, LevelRole, LevelZone } from "@/lib/chart-levels";
import type { ChartTheme } from "@/lib/theme";
import type { LevelLabelsMode } from "@/lib/prefs-sanitize";
import type { IndicatorLineStyle } from "@/lib/indicator-kit";

const FONT = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
const PILL_HEIGHT = 16;
const PILL_PAD = 5;
const RIGHT_INSET = 2;
// 11px ui-monospace advances about 0.6em per glyph. Used to reserve the pill column before it paints.
const PILL_CHAR_PX = 6.6;
// Gap kept between the last bar and the pill column (OD-55a).
const PILL_GAP_PX = 8;
// Rays end this far past the last bar (LB-4).
const RAY_OVERSHOOT_PX = 4;
// Pill background opacity when the theme does not carry `--level-label-bg-alpha` (LB-2).
const PILL_BG_ALPHA = 0.95;
// Off-pane axis tags park here so lightweight-charts' own label placement ignores them.
const OFF_PANE = -1000;

/** Width of one pill as `draw` lays it out, for a label of `label` text. */
export function levelPillWidthPx(label: string) {
  return Math.ceil(label.length * PILL_CHAR_PX) + PILL_PAD * 2 + 3;
}

/** Width of the widest pill in the column, so `rightOffset` can reserve it before anything paints. */
export function levelPillColumnPx(labels: readonly string[]) {
  return labels.reduce((widest, label) => Math.max(widest, levelPillWidthPx(label)), 0);
}

/** OD-55a: bars of `rightOffset` that keep the pill column clear of the last bar. Zero when no pill shows. */
export function computeLevelRightOffsetBars(pillCount: number, pillWidthPx: number, barSpacing: number) {
  return pillCount > 0 && barSpacing > 0 ? Math.ceil((pillWidthPx + PILL_GAP_PX) / barSpacing) : 0;
}

function pillColor(theme: ChartTheme, pill: Pick<LevelPill, "role" | "tone">) {
  if (pill.tone) return pill.tone === "risk" ? theme.risk : pill.tone === "profit" ? theme.profit : pill.tone === "entry" ? theme.textPrimary : theme.textMuted;
  return roleColor(theme, pill.role);
}

function roleColor(theme: ChartTheme, role: LevelRole) {
  return role === "resistance" ? theme.levelResistance
    : role === "support" ? theme.levelSupport
      : role === "adr" ? theme.levelAdr : theme.levelNeutral;
}

export class SessionLevelsPrimitive implements ISeriesPrimitive<Time> {
  private attachment?: SeriesAttachedParameter<Time>;
  private lines: readonly LevelLine[] = [];
  private zones: readonly LevelZone[] = [];
  private pills: readonly LevelPill[] = [];
  private theme?: ChartTheme;
  private barMs = 60_000;
  private lastBarTime: number | null = null;
  private mode: LevelLabelsMode = "tap";
  private symbol = "MES";
  private entryPrice: number | null = null;
  private lineStyle: IndicatorLineStyle = "solid";
  private lineWidth = 1;
  private colorOverride: string | null = null;
  private labels = true;
  // Both layers sit under candles and wicks (LB-1): the pills never cover a bar.
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target, "rays") }) },
    { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target, "labels") }) },
  ];

  attached(param: SeriesAttachedParameter<Time>) { this.attachment = param; }
  detached() { this.attachment = undefined; }
  paneViews() { return this.views; }
  /** Never widen the price scale for a level: distant levels must not compress the trade (docs/12 §5). */
  autoscaleInfo() { return null; }

  /**
   * `barMs` is the displayed bar size: a level's start time snaps to the bar that holds it (B-23).
   * `pills` defaults to one pill per line, in order. `mode` defaults to `"tap"` (LB-5): no pills, and up to
   * three price-only axis tags for the groups nearest `entryPrice`. `"always"` draws the right-edge pills instead.
   */
  update(lines: readonly LevelLine[], theme: ChartTheme, barMs: number, pills?: readonly LevelPill[], options: {
    lastBarTime?: number | null; mode?: LevelLabelsMode; symbol?: string; entryPrice?: number | null; zones?: readonly LevelZone[];
    lineStyle?: IndicatorLineStyle; lineWidth?: number; color?: string | null; labels?: boolean;
  } = {}) {
    this.lines = lines;
    this.zones = options.zones ?? [];
    // Rays stop at the last bar (LB-4). Null keeps the full-width ray.
    this.lastBarTime = options.lastBarTime ?? null;
    this.pills = pills ?? lines.map((line, rank) => ({
      price: line.price, label: line.label, role: line.role, tone: null, rank, lineTicks: [line.price_ticks],
    }));
    this.mode = options.mode ?? "tap";
    this.symbol = options.symbol ?? "MES";
    this.entryPrice = options.entryPrice ?? null;
    this.lineStyle = options.lineStyle ?? "solid";
    this.lineWidth = options.lineWidth ?? 1;
    this.colorOverride = options.color ?? null;
    this.labels = options.labels !== false;
    this.theme = theme;
    this.barMs = barMs;
    this.attachment?.requestUpdate();
  }

  /** LB-6: price-only tags for the merged groups nearest the entry, at most three. Empty in `"always"` mode. */
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const { attachment, theme } = this;
    if (!this.labels || this.mode !== "tap" || !attachment || !theme || this.entryPrice == null) return [];
    const paneHeight = attachment.chart.paneSize().height;
    return selectAxisTagGroups(this.pills, this.entryPrice).map((group): ISeriesPrimitiveAxisView => {
      const coordinate = () => attachment.series.priceToCoordinate(group.price) ?? OFF_PANE;
      return {
        coordinate,
        text: () => formatPrice(group.price, this.symbol),
        textColor: () => theme.levelLabelText,
        backColor: () => roleColor(theme, group.role),
        visible: () => { const y = coordinate(); return y >= 0 && y <= paneHeight; },
        tickVisible: () => true,
      };
    });
  }

  /** The level under a tap at CSS `(x, y)`: a ray within 10 px (and across its drawn span), or a zone. Null when none. */
  hitTestLevel(x: number, y: number): LevelHit | null {
    const { attachment } = this;
    if (!attachment || !this.labels) return null;
    const pane = attachment.chart.paneSize();
    return hitLevel(this.lines, this.zones, { x, y }, {
      priceToY: (price) => {
        const raw = attachment.series.priceToCoordinate(price);
        return raw == null || raw < 0 || raw > pane.height ? null : raw;
      },
      raySpanX: (line) => this.raySpan(line, pane.width),
      zoneSpanX: (zone) => this.timeSpan(zone.startAt ?? null, zone.endAt, pane.width),
    });
  }

  /** Where a ray is drawn across the pane: from its start bar (or the left edge) to the last bar + 4 px. Null when empty. */
  private timeSpan(startAt: number | null, endAt: number | null | undefined, paneWidth: number): { x0: number; x1: number } | null {
    const { attachment } = this;
    if (!attachment) return null;
    const scale = attachment.chart.timeScale();
    const end = endAt ?? this.lastBarTime;
    const lastBarX = end != null ? scale.timeToCoordinate(Math.floor(end / 1000) as UTCTimestamp) : null;
    const x1 = lastBarX != null ? Math.min(paneWidth, Math.round(lastBarX + RAY_OVERSHOOT_PX)) : paneWidth;
    let x0 = 0;
    if (startAt != null) {
      const bar = Math.floor(startAt / this.barMs) * this.barMs;
      const x = scale.timeToCoordinate(Math.floor(bar / 1000) as UTCTimestamp);
      // The forming bar is off the loaded data: draw from the edge rather than guess (B-23).
      if (x != null) x0 = Math.max(0, Math.min(paneWidth, x));
    }
    return x1 <= x0 ? null : { x0, x1 };
  }

  private raySpan(line: LevelLine, paneWidth: number) { return this.timeSpan(line.startAt, line.endAt, paneWidth); }

  private paintColor(color: string | undefined, role: LevelRole) {
    const theme = this.theme!;
    if (!color || color === "theme:role") return roleColor(theme, role);
    if (color.startsWith("#")) return color;
    const key = color.slice(6);
    if (key === "adr") return theme.levelAdr;
    if (key === "support") return theme.levelSupport;
    if (key === "resistance") return theme.levelResistance;
    if (key === "neutral") return theme.levelNeutral;
    if (key === "gold") return theme.goldMid;
    if (key === "vwap") return theme.vwap;
    if (key === "ema") return theme.ema200 ?? theme.goldMid;
    return roleColor(theme, role);
  }

  private draw(target: CanvasRenderingTarget2D, layer: "rays" | "labels") {
    const { attachment, theme } = this;
    if (!attachment || !theme || (!this.lines.length && !this.pills.length && !this.zones.length)) return;
    // Tap mode draws no pills (LB-6): the labels layer is empty, and no ray fades for a collision.
    const tap = this.mode === "tap";
    if ((tap || !this.labels) && layer === "labels") return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize: pane }) => {
      const pills = this.pills.flatMap((pill) => {
        const y = attachment.series.priceToCoordinate(pill.price);
        return y == null || y < 0 || y > pane.height ? [] : [{ pill, y: Math.round(y) + 0.5 }];
      });
      // Laid out at this paint's scale. Rays of a dropped pill draw faint.
      const placed = layoutPills(pills.map(({ pill, y }) => ({ y, rank: pill.rank })), PILL_HEIGHT + 1, 0, pane.height);
      const faint = new Set(pills.flatMap(({ pill }, index) => (placed[index] == null ? pill.lineTicks : [])));
      ctx.save();
      ctx.font = FONT;
      if (layer === "rays") {
        for (const zone of this.zones) {
          const top = attachment.series.priceToCoordinate(zone.priceHigh);
          const bottom = attachment.series.priceToCoordinate(zone.priceLow);
          const span = this.timeSpan(zone.startAt ?? null, zone.endAt, pane.width);
          if (top == null || bottom == null || !span) continue;
          const color = this.paintColor(zone.color, zone.role);
          ctx.globalAlpha = zone.fillOpacity ?? 0.14;
          ctx.fillStyle = color;
          ctx.fillRect(span.x0, Math.min(top, bottom), span.x1 - span.x0, Math.max(1, Math.abs(bottom - top)));
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = color;
          ctx.lineWidth = zone.lineWidth ?? 1;
          ctx.setLineDash(zone.lineStyle === "dashed" ? [4, 4] : zone.lineStyle === "dotted" ? [1, 3] : []);
          ctx.strokeRect(span.x0 + 0.5, Math.min(top, bottom) + 0.5, Math.max(0, span.x1 - span.x0 - 1), Math.max(1, Math.abs(bottom - top) - 1));
        }
        for (const line of this.lines) {
          const raw = attachment.series.priceToCoordinate(line.price);
          if (raw == null || raw < 0 || raw > pane.height) continue;
          const span = this.raySpan(line, pane.width);
          if (!span) continue;
          const y = Math.round(raw) + 0.5;
          const faded = !tap && faint.has(line.price_ticks);
          // Settlement levels (PDC, 3 PM close, settle) are quiet dotted neutral rays (Q-7).
          const settlement = line.settlement === true;
          ctx.globalAlpha = faded ? 0.3 : settlement ? 0.6 : 0.8;
          ctx.lineWidth = line.lineWidth ?? this.lineWidth;
          ctx.strokeStyle = this.colorOverride ?? (settlement ? theme.levelNeutral : this.paintColor(line.color, line.role));
          const style = line.lineStyle ?? this.lineStyle;
          ctx.setLineDash(settlement || style === "dotted" ? [1, 3] : line.proxy || style === "dashed" ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(span.x0, y);
          ctx.lineTo(span.x1, y);
          ctx.stroke();
        }
      } else {
        pills.forEach(({ pill, y }, index) => {
          const at = placed[index];
          if (at == null) return;
          const width = Math.ceil(ctx.measureText(pill.label).width) + PILL_PAD * 2 + 3;
          const right = pane.width - RIGHT_INSET;
          const left = right - width;
          const top = Math.round(at - PILL_HEIGHT / 2);
          const color = pillColor(theme, pill);
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          if (Math.abs(at - y) > 1) {
            // Leader tick back to the true price when the pill was stacked away from it.
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(left - 6, y);
            ctx.lineTo(left, at);
            ctx.stroke();
          }
          ctx.globalAlpha = theme.levelLabelBgAlpha ?? PILL_BG_ALPHA;
          ctx.fillStyle = theme.surface;
          ctx.fillRect(left, top, width, PILL_HEIGHT);
          ctx.globalAlpha = 1;
          if (pill.tone) {
            // The trade's own prices: outlined tags, so they read apart from level pills.
            ctx.strokeStyle = color;
            ctx.strokeRect(left + 0.5, top + 0.5, width - 1, PILL_HEIGHT - 1);
          } else {
            ctx.fillStyle = color;
            ctx.fillRect(left, top, 3, PILL_HEIGHT);
          }
          ctx.fillStyle = theme.levelLabelText;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(pill.label, left + 3 + PILL_PAD, top + PILL_HEIGHT / 2 + 0.5);
        });
      }
      ctx.restore();
    });
  }
}
