// The one formatting module (docs/08 §13). No component formats a number on its own.
import { specFor, tickDecimals } from "./trades.ts";

const MINUS = "−"; // true minus

function signOf(value: number) {
  return value < 0 ? MINUS : "+";
}

/** `$20.00` with no sign, for a size such as risk (docs/20). `—` when unknown. */
export function formatUsdAmount(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `+$325.00`, `−$110.00`, `—` when the trade cannot be priced. */
export function formatMoney(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${signOf(value)}$${abs}`;
}

/** Display decimals for a symbol. Display only: no money is computed from this. Unknown symbols get two. */
function displayDecimals(symbol: string) {
  return Math.max(2, tickDecimals(specFor(symbol)?.tickSize ?? 0.01));
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
  return value.toFixed(displayDecimals(symbol));
}

/** `+13.00 pts`, `—` when the trade cannot be priced. */
export function formatPoints(points: number | null, symbol = "MES") {
  if (points == null || !Number.isFinite(points)) return "—";
  return `${signOf(points)}${Math.abs(points).toFixed(displayDecimals(symbol))} pts`;
}

/** `4.00 pts` with no sign, for a distance such as entry to stop (docs/20). `—` when unknown. */
export function formatPointDistance(points: number | null, symbol = "MES") {
  if (points == null || !Number.isFinite(points)) return "—";
  return `${Math.abs(points).toFixed(displayDecimals(symbol))} pts`;
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

/** An account balance from integer cents: `$50,150.00`, `−$120.00`. No plus sign: a balance is not a result. */
export function formatBalance(cents: number | null) {
  if (cents == null || !Number.isFinite(cents)) return "—";
  const abs = (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? MINUS : ""}$${abs}`;
}

/** A change in integer cents, signed: `+$150.00`, `−$75.00`. */
export function formatCents(cents: number | null) {
  return cents == null ? "—" : formatMoney(cents / 100);
}
