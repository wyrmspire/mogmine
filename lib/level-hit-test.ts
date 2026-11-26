// LB-5/LB-6 (docs/03 §3): tap-to-read levels and the price-axis tags for `levelLabels: "tap"`. Pure, no DOM or Canvas.
import type { LevelLine, LevelZone } from "./chart-levels.ts";
import type { LevelPill } from "./chart-levels.ts";
export type { LevelZone } from "./chart-levels.ts";

export interface LevelHit {
  kind: "group" | "zone";
  /** The ray's price, or the zone's midpoint. */
  price: number;
  /** CSS y of the ray, or the zone's centre. */
  y: number;
  /** CSS x of the tap. */
  x: number;
  /** Every merged member within `GROUP_TICKS` of the ray (or every line inside the zone). */
  lines: LevelLine[];
  zone?: LevelZone;
}

/** A tap this close (CSS px) to a ray counts as on it (LB-6). */
export const LEVEL_HIT_TOLERANCE_PX = 10;

/** Lines within this many ticks form one merged group. Matches `MERGE_TICKS` in `level-pills.ts` (a test checks it). */
const GROUP_TICKS = 4;

/** Axis tags shown at most in `"tap"` mode (D-D). */
export const AXIS_TAG_MAX = 3;

/**
 * Pick up to `maxCount` (default 3) merged level groups nearest `entryPrice`, excluding trade-anchor pills
 * (`pill.tone != null`). Ties keep the order the pills came in.
 */
export function selectAxisTagGroups(pills: readonly LevelPill[], entryPrice: number, maxCount = AXIS_TAG_MAX): LevelPill[] {
  return pills
    .filter((pill) => pill.tone == null)
    .map((pill, index) => ({ pill, index, distance: Math.abs(pill.price - entryPrice) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, Math.max(0, maxCount))
    .map(({ pill }) => pill);
}

/**
 * Hit-test a tap at CSS `(x, y)` against visible rays and zones. A ray counts when `|y - priceToY(price)| <= tolerancePx`
 * and, when `raySpanX` is given, `x` is inside the span it returns (null means not drawn). The nearest ray wins and
 * returns its whole merged group. With no ray in range, a zone whose band holds `y` wins.
 */
export function hitLevel(
  lines: readonly LevelLine[],
  zones: readonly LevelZone[],
  point: { x: number; y: number },
  project: {
    priceToY: (price: number) => number | null;
    raySpanX?: (line: LevelLine) => { x0: number; x1: number } | null;
    zoneSpanX?: (zone: LevelZone) => { x0: number; x1: number } | null;
  },
  tolerancePx = LEVEL_HIT_TOLERANCE_PX,
): LevelHit | null {
  let best: { line: LevelLine; y: number; distance: number } | null = null;
  for (const line of lines) {
    const y = project.priceToY(line.price);
    if (y == null || !Number.isFinite(y)) continue;
    const distance = Math.abs(point.y - y);
    if (distance > tolerancePx) continue;
    if (project.raySpanX) {
      const span = project.raySpanX(line);
      if (!span || point.x < span.x0 || point.x > span.x1) continue;
    }
    if (!best || distance < best.distance) best = { line, y, distance };
  }
  if (best) {
    const anchor = best.line.price_ticks;
    return {
      kind: "group", price: best.line.price, y: best.y, x: point.x,
      lines: lines.filter((line) => Math.abs(line.price_ticks - anchor) <= GROUP_TICKS),
    };
  }
  for (const zone of zones) {
    const top = project.priceToY(zone.priceHigh);
    const bottom = project.priceToY(zone.priceLow);
    if (top == null || bottom == null) continue;
    const yTop = Math.min(top, bottom);
    const yBottom = Math.max(top, bottom);
    if (point.y < yTop || point.y > yBottom) continue;
    if (project.zoneSpanX) {
      const span = project.zoneSpanX(zone);
      if (!span || point.x < span.x0 || point.x > span.x1) continue;
    }
    return {
      kind: "zone", price: (zone.priceLow + zone.priceHigh) / 2, y: (yTop + yBottom) / 2, x: point.x,
      lines: zone.lines?.length ? zone.lines : lines.filter((line) => line.price >= zone.priceLow && line.price <= zone.priceHigh),
      zone,
    };
  }
  return null;
}

/** What a tap on the chart does. Priority: neighbour trade box, then level ray or zone, then dismiss (docs/03 §3). */
export type TapAction =
  | { kind: "neighbour"; tradeId: string }
  | { kind: "level"; hit: LevelHit }
  | { kind: "dismiss" };

export function resolveTapAction(neighbourTradeId: string | null, levelHit: LevelHit | null): TapAction {
  if (neighbourTradeId) return { kind: "neighbour", tradeId: neighbourTradeId };
  if (levelHit) return { kind: "level", hit: levelHit };
  return { kind: "dismiss" };
}
