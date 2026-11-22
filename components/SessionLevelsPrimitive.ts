// Canvas session levels painter (LV-2, docs/12 §3A, §4, §5 and docs/24 §3, §5).
// Draws computed point-in-time session levels as rays with right-edge pill labels.
// Invariant 1: Canvas ISeriesPrimitive only, never HTML divs.
// Invariant 5: Colors read dynamically from theme tokens (via ChartTheme).
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  AutoscaleInfo, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp,
} from "lightweight-charts";
import type { ComputedLevel } from "@/lib/levels";
import type { ChartTheme } from "@/lib/theme";

export type LevelRole = "resistance" | "support" | "adr" | "neutral";

export function levelRole(type: ComputedLevel["type"]): LevelRole {
  if (type.startsWith("adr_")) return "adr";
  if (type === "pdh" || type === "rth_high" || type === "onh" || type === "r1" || type === "r2" || type === "week_high") {
    return "resistance";
  }
  if (type === "pdl" || type === "rth_low" || type === "onl" || type === "s1" || type === "s2" || type === "week_low") {
    return "support";
  }
  return "neutral"; // globex_open, rth_open, rth_close, pdc, pp
}

export class SessionLevelsPrimitive implements ISeriesPrimitive<Time> {
  private attachment?: SeriesAttachedParameter<Time>;
  private levels: readonly ComputedLevel[] = [];
  private visible = true;
  private theme?: ChartTheme;
  private priceRange: AutoscaleInfo | null = null;
  private readonly views: readonly IPrimitivePaneView[] = [
    { zOrder: () => "bottom", renderer: () => ({ draw: (target) => this.draw(target) }) },
  ];

  attached(param: SeriesAttachedParameter<Time>) {
    this.attachment = param;
  }

  detached() {
    this.attachment = undefined;
  }

  paneViews() {
    return this.views;
  }

  autoscaleInfo() {
    return this.priceRange;
  }

  update(levels: readonly ComputedLevel[], visible: boolean, theme: ChartTheme) {
    if (this.levels !== levels) {
      this.levels = levels;
      const prices = levels.map((l) => l.price);
      this.priceRange = prices.length
        ? { priceRange: { minValue: Math.min(...prices), maxValue: Math.max(...prices) } }
        : null;
    }
    this.visible = visible;
    this.theme = theme;
    this.attachment?.requestUpdate();
  }

  private draw(target: CanvasRenderingTarget2D) {
    const { attachment, theme, visible, levels } = this;
    if (!attachment || !theme || !visible || levels.length === 0) return;

    const scale = attachment.chart.timeScale();
    const series = attachment.series;
    const timeToX = (iso?: string) => {
      if (!iso) return 0;
      const ms = Date.parse(iso);
      if (!Number.isFinite(ms)) return 0;
      const coord = scale.timeToCoordinate(Math.floor(ms / 1000) as UTCTimestamp);
      return coord != null ? Math.max(0, coord) : 0;
    };

    const roleColor = (role: LevelRole) => {
      switch (role) {
        case "resistance": return theme.levelResistance;
        case "support": return theme.levelSupport;
        case "adr": return theme.levelAdr;
        case "neutral": return theme.levelNeutral;
      }
    };

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize: pane }) => {
      ctx.save();
      ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";

      for (const lvl of levels) {
        const y = series.priceToCoordinate(lvl.price);
        if (y == null || y < -10 || y > pane.height + 10) continue;

        const role = levelRole(lvl.type);
        const color = roleColor(role);
        const startX = timeToX(lvl.formed_at);

        // 1. Ray: 1px line from formed_at (or left edge) to right edge
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash(lvl.label.includes("proxy") ? [4, 4] : []);
        ctx.moveTo(startX, Math.round(y) + 0.5);
        ctx.lineTo(pane.width, Math.round(y) + 0.5);
        ctx.stroke();

        // 2. Right-edge pill label: white monospace text on dark surface
        const labelText = `${lvl.price.toFixed(2)} ${lvl.label}`;
        const textWidth = ctx.measureText(labelText).width;
        const pillPadX = 5;
        const pillHeight = 16;
        const pillWidth = textWidth + pillPadX * 2;
        const pillX = pane.width - pillWidth - 2;
        const pillY = Math.max(2, Math.min(pane.height - pillHeight - 2, Math.round(y - pillHeight / 2)));

        ctx.fillStyle = theme.surface;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.fillRect(pillX, pillY, pillWidth, pillHeight);
        ctx.strokeRect(pillX + 0.5, pillY + 0.5, pillWidth - 1, pillHeight - 1);

        ctx.fillStyle = theme.levelLabelText;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(labelText, pillX + pillPadX, pillY + pillHeight / 2);
      }

      ctx.restore();
    });
  }
}
