// LB-B2 (docs/03 §3 LB-6/LB-7, D-E): pure non-DOM helpers for the session level popover card,
// keyboard disclosure list, and <= 4 labelled group Trade Card PNG export.
import { formatPrice } from "./format.ts";
import { MERGE_TICKS, type LevelPill } from "./level-pills.ts";
import type { LevelLine } from "./chart-levels.ts";
import type { LevelHit } from "./level-hit-test.ts";

/** The card closes itself after this long (LB-6). */
export const LEVEL_CARD_DISMISS_MS = 6000;
/** Trade Card export draws at most this many labelled level groups (D-E). */
export const EXPORT_LEVEL_GROUPS = 4;
/** Keeps the card clear of the top OHLC HUD readout (`.chart-hud`, top 8px). */
export const LEVEL_CARD_HUD_PX = 32;
export const LEVEL_CARD_EDGE_PX = 4;
const OFFSET_X_PX = 12;

export interface LevelCardMember {
  name: string;
  price: string;
  /** `computed`, `planned`, or both when a merged line mixes the two. */
  source: string;
  /** Set for a settlement proxy (the ray is dashed). */
  tag: string | null;
}

export interface LevelCardView {
  title: string;
  price: string;
  members: LevelCardMember[];
}

/** `PDL / ADR Low` reads as `PDL · ADR Low` in the card. */
export const displayLevelNames = (names: string) => names.replace(/ \/ /g, " · ");

function sourceOf(line: LevelLine): string {
  const planned = line.keys.some((key) => key.startsWith("plan:"));
  const computed = line.keys.some((key) => !key.startsWith("plan:"));
  if (planned && computed) return "planned + computed";
  return planned ? "planned" : "computed";
}

/** The card's text for a hit: every merged member with its exact price, source, and proxy tag. */
export function formatLevelCardData(hit: LevelHit, symbol: string): LevelCardView {
  return {
    title: hit.zone ? displayLevelNames(hit.zone.label) : "Session level",
    price: formatPrice(hit.price, symbol),
    members: hit.lines.map((line) => ({
      name: displayLevelNames(line.names),
      price: formatPrice(line.price, symbol),
      source: sourceOf(line),
      tag: line.proxy ? "proxy" : null,
    })),
  };
}

/**
 * Where the card's top-left corner goes: beside the tap, kept inside the frame by `LEVEL_CARD_EDGE_PX` and below the HUD band.
 * Shrinks toward the frame's edge when the card is larger than the frame (never a negative position).
 */
export function clampPopoverPosition(
  anchor: { x: number; y: number },
  cardSize: { width: number; height: number },
  frameSize: { width: number; height: number },
  hudHeight = LEVEL_CARD_HUD_PX,
): { left: number; top: number } {
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
  const left = clamp(anchor.x + OFFSET_X_PX, LEVEL_CARD_EDGE_PX, frameSize.width - cardSize.width - LEVEL_CARD_EDGE_PX);
  const top = clamp(anchor.y - cardSize.height / 2, Math.max(LEVEL_CARD_EDGE_PX, hudHeight), frameSize.height - cardSize.height - LEVEL_CARD_EDGE_PX);
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * D-E: the level pills an export draws. The trade's key level (when set) comes first, then the merged level groups
 * nearest the entry. Entry, stop and target pills are never exported. At most `maxGroups` in total.
 */
export function selectExportLevelPills(
  pills: readonly LevelPill[],
  entryPrice: number,
  keyLevelPrice: number | null,
  maxGroups = EXPORT_LEVEL_GROUPS,
): LevelPill[] {
  if (maxGroups <= 0) return [];
  const key = keyLevelPrice == null ? undefined : pills.find((pill) => pill.tone === "key" && pill.price === keyLevelPrice);
  const groups = pills
    .filter((pill) => pill.tone == null)
    .map((pill, index) => ({ pill, index, distance: Math.abs(pill.price - entryPrice) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ pill }) => pill);
  return [...(key ? [key] : []), ...groups.slice(0, maxGroups - (key ? 1 : 0))];
}

/**
 * A hit for a list row: the ray at `tick` and the merged group around it, placed at the given `x`.
 * Null when the ray is not on the pane (`priceToY` returns null).
 */
export function levelHitForTick(
  lines: readonly LevelLine[],
  tick: number,
  x: number,
  priceToY: (price: number) => number | null,
): LevelHit | null {
  const anchor = lines.find((line) => line.price_ticks === tick);
  if (!anchor) return null;
  const y = priceToY(anchor.price);
  if (y == null || !Number.isFinite(y)) return null;
  return {
    kind: "group", price: anchor.price, y, x,
    lines: lines.filter((line) => Math.abs(line.price_ticks - tick) <= MERGE_TICKS),
  };
}
