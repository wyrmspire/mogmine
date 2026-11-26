// Partial-lot envelopes (docs/design-2026-11-24/08 §5, §7.3 UX-E3). Pure geometry: no canvas access.
// Adjacent or overlapping same-tone `actual` lot zones become one envelope: non-overlapping fill slices that
// share ONE vertical gradient, a far-edge rule at the farthest exit, and 1 px separators at intermediate exits.
import type { FlagMark } from "./trade-marks.ts";
import { CHART_TOKENS } from "./chart-paint.ts";
import type { PaintRect } from "./chart-paint.ts";

export type LotTone = FlagMark["tone"];

/** One projected `actual` lot zone. `y0` is the entry price and `y1` the exit price, in media pixels. */
export interface ActualLotZone {
  tone: LotTone;
  rect: PaintRect;
  y0: number;
  y1: number;
  label?: string;
  approximate?: boolean;
  /** Only used for single-lot envelopes, so a lone partial lot keeps its qty / max fill strength. */
  opacityMultiplier?: number;
}

/** A horizontal segment in media pixels, spanning `x0` to `x1` at height `y`. */
export interface LotSegment { y: number; x0: number; x1: number; alpha: number }

export interface LotEnvelope {
  tone: LotTone;
  /** Bounding box of every lot in the group. */
  rect: PaintRect;
  /** Non-overlapping fill rectangles whose union is the group's footprint. */
  slices: PaintRect[];
  /** Gradient runs from `entryY` (nearFactor) to `farY` (farFactor). */
  entryY: number;
  farY: number;
  opacityMultiplier: number;
  lots: number;
  label?: string;
  approximate: boolean;
  /** Outer far-edge rules at the farthest exit price(s). */
  farEdges: LotSegment[];
  /** Interior 1 px lot exit separators, one per lot whose exit is not the far price. */
  separators: LotSegment[];
}

/** Lot separators are solid and fainter than the far-edge rule (08 §7.3). */
export const LOT_SEPARATOR_ALPHA = 0.65;

const right = (rect: PaintRect) => rect.x + rect.width;
const bottom = (rect: PaintRect) => rect.y + rect.height;

/** Splits zones of one tone into groups where each zone overlaps or touches (`a.right >= b.left - 1`) the group. */
function groupByTone(zones: readonly ActualLotZone[]): ActualLotZone[][] {
  const groups: ActualLotZone[][] = [];
  const sorted = zones.map((zone, index) => ({ zone, index })).sort((a, b) => a.zone.rect.x - b.zone.rect.x || a.index - b.index);
  const byTone = new Map<LotTone, { groups: ActualLotZone[][]; reach: number[] }>();
  for (const { zone } of sorted) {
    let state = byTone.get(zone.tone);
    if (!state) byTone.set(zone.tone, (state = { groups: [], reach: [] }));
    const last = state.groups.length - 1;
    if (last >= 0 && zone.rect.x <= state.reach[last] + 1) {
      state.groups[last].push(zone);
      state.reach[last] = Math.max(state.reach[last], right(zone.rect));
    } else {
      state.groups.push([zone]);
      state.reach.push(right(zone.rect));
    }
  }
  for (const state of byTone.values()) groups.push(...state.groups);
  return groups;
}

/** Column slices: per x-interval between breakpoints, the merged vertical runs of the lots covering it. */
function columnSlices(lots: readonly ActualLotZone[]): PaintRect[] {
  const xs = [...new Set(lots.flatMap((lot) => [lot.rect.x, right(lot.rect)]))].sort((a, b) => a - b);
  const slices: PaintRect[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const [left, end] = [xs[i], xs[i + 1]];
    const runs = lots
      .filter((lot) => lot.rect.x <= left && right(lot.rect) >= end)
      .map((lot) => [lot.rect.y, bottom(lot.rect)] as const)
      .sort((a, b) => a[0] - b[0]);
    const merged: (readonly [number, number])[] = [];
    for (const run of runs) {
      const last = merged.at(-1);
      if (last && run[0] <= last[1]) merged[merged.length - 1] = [last[0], Math.max(last[1], run[1])];
      else merged.push(run);
    }
    for (const [top, far] of merged) slices.push({ x: left, y: top, width: end - left, height: far - top });
  }
  // Stitch neighbouring columns that share a vertical run, so a flat scale-out stays one rectangle.
  return slices.reduce<PaintRect[]>((out, slice) => {
    const last = out.at(-1);
    if (last && last.y === slice.y && last.height === slice.height && right(last) === slice.x) {
      out[out.length - 1] = { ...last, width: last.width + slice.width };
    } else out.push(slice);
    return out;
  }, []);
}

function buildEnvelope(lots: readonly ActualLotZone[]): LotEnvelope {
  const tone = lots[0].tone;
  const left = Math.min(...lots.map((lot) => lot.rect.x));
  const top = Math.min(...lots.map((lot) => lot.rect.y));
  const rightEdge = Math.max(...lots.map((lot) => right(lot.rect)));
  const bottomEdge = Math.max(...lots.map((lot) => bottom(lot.rect)));
  const rect = { x: left, y: top, width: rightEdge - left, height: bottomEdge - top };
  const label = lots.find((lot) => lot.label)?.label;
  const approximate = lots.some((lot) => lot.approximate);
  const span = (lot: ActualLotZone, y: number, alpha: number): LotSegment => ({
    y, x0: lot.rect.x, x1: right(lot.rect), alpha,
  });

  if (lots.length === 1) {
    const [lot] = lots;
    return {
      tone, rect: { ...lot.rect }, slices: [{ ...lot.rect }], entryY: lot.y0, farY: lot.y1,
      opacityMultiplier: lot.opacityMultiplier ?? 1, lots: 1, label, approximate,
      farEdges: [span(lot, lot.y1, CHART_TOKENS.zone.edgeActual)], separators: [],
    };
  }

  // The entry is the earliest lot's entry; the far price is the exit furthest from it.
  const entryY = lots[0].y0;
  const farY = lots.reduce((far, lot) => (Math.abs(lot.y1 - entryY) > Math.abs(far - entryY) ? lot.y1 : far), lots[0].y1);
  return {
    tone, rect, slices: columnSlices(lots), entryY, farY, opacityMultiplier: 1, lots: lots.length, label, approximate,
    farEdges: lots.filter((lot) => lot.y1 === farY).map((lot) => span(lot, farY, CHART_TOKENS.zone.edgeActual)),
    separators: lots.filter((lot) => lot.y1 !== farY).map((lot) => span(lot, lot.y1, LOT_SEPARATOR_ALPHA)),
  };
}

/** Groups same-tone `actual` lot zones into envelopes. Single lots pass through unchanged. */
export function buildActualLotEnvelopes(zones: readonly ActualLotZone[]): LotEnvelope[] {
  return groupByTone(zones).map(buildEnvelope);
}
