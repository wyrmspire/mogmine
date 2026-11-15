// The one formatting module (docs/08 §13). No component formats a number on its own.
import { specFor, tickDecimals } from "./trades.ts";

const MINUS = "−"; // true minus

function signOf(value: number) {
  return value < 0 ? MINUS : "+";
}

/** `+$325.00`, `−$110.00` */
export function formatMoney(value: number) {
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${signOf(value)}$${abs}`;
}

/** `+2.6R`, `−1.0R`, `—R` when there is no stop. Never `0.0R` for an unknown risk. */
export function formatR(r: number | null) {
  if (r == null || !Number.isFinite(r)) return "—R";
  const rounded = Math.round(r * 10) / 10;
  return `${signOf(rounded)}${Math.abs(rounded).toFixed(1)}R`;
}

/** Price at the contract's tick precision, `—` when missing. */
export function formatPrice(value: number | null | undefined, symbol = "MES") {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(Math.max(2, tickDecimals(specFor(symbol).tickSize)));
}

/** `+13.00 pts` */
export function formatPoints(points: number, symbol = "MES") {
  return `${signOf(points)}${Math.abs(points).toFixed(Math.max(2, tickDecimals(specFor(symbol).tickSize)))} pts`;
}

/** `+52 ticks` */
export function formatTicks(ticks: number) {
  const abs = Math.abs(ticks);
  return `${signOf(ticks)}${abs} ${abs === 1 ? "tick" : "ticks"}`;
}

/** Two units at most: `48s`, `42m 10s`, `42m`, `3h 05m`. */
export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${minutes}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** Prefix for estimated values (B-33). */
export function approx(text: string) {
  return `≈ ${text}`;
}

/** `67%`, or `—` when there is nothing to divide by. */
export function formatPercent(ratio: number | null) {
  return ratio == null || !Number.isFinite(ratio) ? "—" : `${Math.round(ratio * 100)}%`;
}
