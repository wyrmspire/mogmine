/**
 * Pure statistics, bucket-edge and ET-clock helpers for the attribution engine (SL-9). No state, no I/O.
 */
import type { Distribution } from "./types.ts";

/** Shrinkage strength: acts as if this many average trades were added (SLQ-10). */
export const SHRINK_K = 10;

const Z95 = 1.959963984540054;

/** Wilson score interval, 95%. Null when n is 0. */
export function wilsonInterval(wins: number, n: number): readonly [number, number] | null {
  if (n <= 0) return null;
  const p = wins / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [clamp01(centre - half), clamp01(centre + half)];
}

/** Shrunk average: (n × avg + k × overall) ÷ (n + k). */
export function shrunkAverage(n: number, avg: number, overall: number): number {
  return (n * avg + SHRINK_K * overall) / (n + SHRINK_K);
}

export function mean(xs: readonly number[]): number | null {
  return xs.length > 0 ? xs.reduce((sum, x) => sum + x, 0) / xs.length : null;
}

export function median(xs: readonly number[]): number | null {
  return quantile([...xs].sort((a, b) => a - b), 0.5);
}

/** Linear interpolation between order statistics (type 7). `sorted` must be ascending. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(xs: readonly number[]): Distribution {
  const sorted = [...xs].sort((a, b) => a - b);
  return { p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.5), p75: quantile(sorted, 0.75) };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});

/** "HH:MM" of the 30-minute ET bucket containing `time` (UTC ms). DST-correct via Intl. */
export function etHalfHourLabel(time: number): string {
  const parts = Object.fromEntries(etClock.formatToParts(new Date(time)).map((p) => [p.type, p.value]));
  const minute = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  const floored = Math.floor(minute / 30) * 30;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(floored / 60))}:${pad(floored % 60)}`;
}

/** Bucket edges at the 1/3 and 2/3 quantiles of this run's values. */
export function terciles(values: readonly number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return [quantile(sorted, 1 / 3) ?? 0, quantile(sorted, 2 / 3) ?? 0];
}

/** Bucket j holds values with edges[j-1] ≤ v < edges[j]; the first starts below, the last ends above. */
export function rangeLabel(edges: readonly number[], j: number): string {
  if (edges.length === 0) return "all";
  if (j === 0) return `< ${fmt(edges[0])}`;
  if (j === edges.length) return `≥ ${fmt(edges[edges.length - 1])}`;
  return `${fmt(edges[j - 1])}–${fmt(edges[j])}`;
}

export function fmt(x: number): string {
  return String(Math.round(x * 100) / 100);
}

