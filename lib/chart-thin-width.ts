/** Small, DOM-free geometry helpers for charts zoomed to roughly one CSS pixel per bar. */

export const THIN_BAR_SPACING_PX = 1;
export const THIN_HIT_TOLERANCE_PX = 6;

export function safeDevicePixelRatio(value: number | undefined | null): number {
  return Number.isFinite(value) && value! > 0 ? value! : 1;
}

export function nearestBarIndex(x: number, barXs: readonly number[], tolerance = THIN_HIT_TOLERANCE_PX): number | null {
  if (!Number.isFinite(x) || !barXs.length) return null;
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < barXs.length; index += 1) {
    const barX = barXs[index];
    if (!Number.isFinite(barX)) continue;
    const next = Math.abs(x - barX);
    if (next < distance) { distance = next; best = index; }
  }
  return best >= 0 && distance <= Math.max(0, tolerance) ? best : null;
}

export function nearestBarIndexAtTime(timeMs: number, barTimes: readonly number[]): number | null {
  if (!Number.isFinite(timeMs) || !barTimes.length) return null;
  let low = 0;
  let high = barTimes.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = barTimes[middle];
    if (candidate === timeMs) return middle;
    if (candidate < timeMs) low = middle + 1;
    else high = middle - 1;
  }
  if (low <= 0) return 0;
  if (low >= barTimes.length) return barTimes.length - 1;
  return timeMs - barTimes[low - 1] <= barTimes[low] - timeMs ? low - 1 : low;
}

export function finiteCssPoint(point: { x: number; y: number } | null | undefined) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}
