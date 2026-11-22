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
