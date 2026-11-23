// Label stacking for chart pills (LV-2, docs/12 §5 LV-09). No imports, so the Chrome check can load it.

/**
 * Resolve label collisions: labels never shrink, they stack (LV-09). Input is each label's wanted
 * centre in pixels. Output keeps input order. A label that moved more than a pixel needs a leader tick.
 */
export function stackLabels(wanted: readonly number[], height: number, top: number, bottom: number): number[] {
  const order = wanted.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y || a.index - b.index);
  const placed = order.map(({ y }) => y);
  const min = top + height / 2;
  const max = bottom - height / 2;
  for (let i = 0; i < placed.length; i += 1) placed[i] = Math.max(placed[i], i ? placed[i - 1] + height : min);
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    placed[i] = Math.min(placed[i], i < placed.length - 1 ? placed[i + 1] - height : max);
  }
  // Too many labels for the pane: keep them inside from the top, overflow stays below the fold.
  for (let i = 0; i < placed.length; i += 1) placed[i] = Math.max(placed[i], i ? placed[i - 1] + height : min);
  const result = new Array<number>(wanted.length);
  order.forEach(({ index }, i) => { result[index] = placed[i]; });
  return result;
}

/** A text label as drawn: left edge, width and wanted vertical centre, in pixels. */
export interface PlacedLabel {
  x: number;
  width: number;
  y: number;
}

/**
 * Chart text labels that would print on top of each other (UX-a: `≈ SL` over `MAE ≈ −5.00 pts`).
 * Labels whose boxes overlap, directly or through a chain, form a group; each group is stacked with
 * `stackLabels`. Labels that touch nothing keep their wanted position. Output keeps input order.
 */
export function separateLabels(labels: readonly PlacedLabel[], height: number, top: number, bottom: number): number[] {
  const parent = labels.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const overlaps = (a: PlacedLabel, b: PlacedLabel) =>
    a.x < b.x + b.width && b.x < a.x + a.width && Math.abs(a.y - b.y) < height;
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      if (overlaps(labels[i], labels[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  labels.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });
  const result = labels.map((label) => label.y);
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const stacked = stackLabels(members.map((index) => labels[index].y), height, top, bottom);
    members.forEach((index, i) => { result[index] = stacked[i]; });
  }
  return result;
}

/** A right-edge pill to lay out: its price's y in pixels and its rank (lower keeps its pill first). */
export interface PillSlot {
  y: number;
  rank: number;
}

/**
 * Lay out right-edge level pills (docs/08 UX-21, docs/12 LV-09). Pills never shrink and never overlap; to stay
 * readable, at most `max` pills draw (and never more than half the pane's rows), and none may sit more than
 * `maxShift` px from its price. While a stacked pill drifts too far, the least important pill that had to move
 * is dropped and the rest are stacked again. Output keeps input order: a centre y, or null for a dropped pill.
 */
export function layoutPills(
  slots: readonly PillSlot[], height: number, top: number, bottom: number,
  options: { max?: number; maxShift?: number } = {},
): (number | null)[] {
  const rows = Math.max(1, Math.floor((bottom - top) / (height * 2)));
  const max = Math.min(options.max ?? 8, rows);
  const maxShift = options.maxShift ?? height * 2.5;
  let kept = slots
    .map((slot, index) => ({ ...slot, index }))
    .filter((slot) => Number.isFinite(slot.y) && slot.y >= top && slot.y <= bottom)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max);
  for (;;) {
    const placed = stackLabels(kept.map((slot) => slot.y), height, top, bottom);
    const moved = kept.filter((slot, k) => Math.abs(placed[k] - slot.y) > 0.5);
    if (!kept.some((slot, k) => Math.abs(placed[k] - slot.y) > maxShift) || kept.length <= 1) {
      const result = new Array<number | null>(slots.length).fill(null);
      kept.forEach((slot, k) => { result[slot.index] = placed[k]; });
      return result;
    }
    const drop = moved.reduce((worst, slot) => (slot.rank > worst.rank || (slot.rank === worst.rank && slot.index > worst.index) ? slot : worst));
    kept = kept.filter((slot) => slot !== drop);
  }
}
