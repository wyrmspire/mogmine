// Price-axis stretch (owner feedback 2026-11-20, docs/20 §3). Pure: no DOM, no chart library.
// A vertical drag on the price axis stretches or compresses the price scale around its centre,
// like TradingView: drag down = compress (more price fits), drag up = stretch (less price, taller candles).

export interface PriceSpan {
  /** Bottom of the visible price range. */
  from: number;
  /** Top of the visible price range. Always above `from`. */
  to: number;
}

/** How strongly a drag works: a drag the full pane height multiplies the span by e^STRETCH_PER_PANE (~7×). */
export const STRETCH_PER_PANE = 2;
/** A drag shorter than this many pixels is a tap, not a stretch. */
export const STRETCH_DEAD_ZONE_PX = 3;
/** Tightest span, in ticks: the axis never zooms in to less than this. */
export const MIN_SPAN_TICKS = 8;
/** Widest span, in ticks (1000 points on MES). */
export const MAX_SPAN_TICKS = 4000;

/**
 * The price range after a vertical drag of `dyPx` (positive = finger moved down) on an axis
 * `paneHeightPx` tall, starting from `start`. The centre stays put. The span is clamped to
 * [`MIN_SPAN_TICKS`, `MAX_SPAN_TICKS`] ticks. Returns `start` unchanged for a non-finite input
 * or a drag inside the dead zone.
 */
export function stretchPriceRange(start: PriceSpan, dyPx: number, paneHeightPx: number, tickSize: number): PriceSpan {
  const span = start.to - start.from;
  if (![start.from, start.to, dyPx, paneHeightPx, tickSize].every(Number.isFinite) || span <= 0 || tickSize <= 0) return start;
  if (Math.abs(dyPx) < STRETCH_DEAD_ZONE_PX) return start;
  const factor = Math.exp((dyPx / Math.max(1, paneHeightPx)) * STRETCH_PER_PANE);
  const nextSpan = Math.min(MAX_SPAN_TICKS * tickSize, Math.max(MIN_SPAN_TICKS * tickSize, span * factor));
  const centre = (start.from + start.to) / 2;
  return { from: centre - nextSpan / 2, to: centre + nextSpan / 2 };
}

/** A mouse wheel over the axis stretches too: one notch (deltaY 100) acts like a 30 px drag. */
export function wheelToDragPx(deltaY: number): number {
  return Number.isFinite(deltaY) ? deltaY * 0.3 : 0;
}

export interface TapPoint {
  /** Milliseconds, any clock. */
  time: number;
  x: number;
  y: number;
}

export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 24;

/** Two taps close in time and place: resets the axis to auto-fit. */
export function isDoubleTap(previous: TapPoint | null, next: TapPoint): boolean {
  if (!previous) return false;
  const dt = next.time - previous.time;
  return dt >= 0 && dt <= DOUBLE_TAP_MS && Math.hypot(next.x - previous.x, next.y - previous.y) <= DOUBLE_TAP_PX;
}
