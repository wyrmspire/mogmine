// FB-1 (docs/design-2026-11-24/05 §4): pure ±5-minute fill-to-bar matching. No DOM, React or I/O.
// A voice- or API-logged fill that is a minute or two off is matched to the nearby bar whose range
// really holds its price. This only says which bar a fill traded in. It never changes the stored
// entry_time or exit_time (AGENTS §6.5: the stored time is the trader's history, the match is computed).
import { DEFAULT_TICK_TOLERANCE_TICKS, alignToBar, fillInsideBar } from "./trades.ts";
import type { Candle, Timeframe } from "./trades.ts";

export type FillMatch =
  | { kind: "stated"; barTime: number }
  | { kind: "shifted"; barTime: number; statedBarTime: number; offsetMin: number }
  | { kind: "outside"; barTime: number }
  | { kind: "no-bars" };

export interface MatchFillOptions {
  /** Search half-width in minutes for 1m bars. Coarser bars search one bar each side. Default 5. */
  windowMin?: number;
  /** Ties: the earlier bar for an entry, the later bar for an exit. Default "entry". */
  role?: "entry" | "exit";
  /** UTC ms lower bound on the matched bar open (inclusive). */
  notBefore?: number;
  /** UTC ms upper bound on the matched bar open (inclusive). */
  notAfter?: number;
  /** Bar length in minutes: 1, 5, 15 or 60. Default 1. */
  barMinutes?: number;
}

const TIMEFRAME_BY_MINUTES: Partial<Record<number, Timeframe>> = { 1: "1m", 5: "5m", 15: "15m", 60: "1h" };
const MINUTE_MS = 60_000;

/**
 * Match one fill to the bar it traded in. `bars` must be sorted ascending by time.
 *
 * 1. The stated bar (or the nearby bar `alignToBar` resolves when the stated bar is missing, OD-28)
 *    contains the price exactly: `stated`.
 * 2. Otherwise the bar nearest in time within the window whose exact range holds the price: `shifted`.
 * 3. Otherwise the stated bar holds the price within the usual 4-tick tolerance: `stated`.
 * 4. Otherwise `outside`.
 */
export function matchFill(
  bars: readonly Candle[],
  statedInstant: number | string,
  price: number,
  symbol: string,
  opts: MatchFillOptions = {},
): FillMatch {
  const { windowMin = 5, role = "entry", notBefore = -Infinity, notAfter = Infinity, barMinutes = 1 } = opts;
  const stated = typeof statedInstant === "string" ? Date.parse(statedInstant) : statedInstant;
  const timeframe = TIMEFRAME_BY_MINUTES[barMinutes];
  if (!bars.length || !timeframe || !Number.isFinite(stated) || !Number.isFinite(price)) return { kind: "no-bars" };

  const alignment = alignToBar(bars.map((bar) => bar.time), stated, timeframe);
  if (alignment.kind === "unresolved") return { kind: "no-bars" };
  const baseTime = alignment.barTime;
  const baseBar = bars.find((bar) => bar.time === baseTime);
  if (!baseBar) return { kind: "no-bars" };

  const inRange = (time: number) => time >= notBefore && time <= notAfter;
  const baseInRange = inRange(baseTime);
  if (baseInRange && fillInsideBar(price, baseBar, symbol, 0)) return { kind: "stated", barTime: baseTime };

  const windowMs = (barMinutes === 1 ? windowMin : barMinutes) * MINUTE_MS;
  let winner: Candle | undefined;
  for (const bar of bars) {
    const distance = Math.abs(bar.time - baseTime);
    if (distance === 0 || distance > windowMs || !inRange(bar.time) || !fillInsideBar(price, bar, symbol, 0)) continue;
    if (!winner) {
      winner = bar;
      continue;
    }
    const best = Math.abs(winner.time - baseTime);
    const earlier = role !== "exit";
    if (distance < best || (distance === best && (earlier ? bar.time < winner.time : bar.time > winner.time))) winner = bar;
  }
  if (winner) {
    return {
      kind: "shifted",
      barTime: winner.time,
      statedBarTime: baseTime,
      offsetMin: Math.round((winner.time - baseTime) / MINUTE_MS),
    };
  }

  if (baseInRange && fillInsideBar(price, baseBar, symbol, DEFAULT_TICK_TOLERANCE_TICKS)) return { kind: "stated", barTime: baseTime };
  return { kind: "outside", barTime: baseTime };
}

/**
 * Match an entry and, when the trade is closed, its exit. The exit is searched from the matched
 * entry bar onward. If a shifted entry lands after the exit's stated bar and pushes the exit out,
 * the entry is re-matched with `notAfter` set to that stated exit bar, so entry never sits after exit.
 */
export function matchTradeFills(
  bars: readonly Candle[],
  entryInstant: number | string,
  entryPrice: number,
  exitInstant: number | string | null | undefined,
  exitPrice: number | null | undefined,
  symbol: string,
  barMinutes = 1,
): { entry: FillMatch; exit: FillMatch | null } {
  let entry = matchFill(bars, entryInstant, entryPrice, symbol, { role: "entry", barMinutes });
  if (exitInstant == null || exitPrice == null) return { entry, exit: null };

  // Only a bar the entry actually traded in bounds the exit. An unmatched entry has no bar to bound it.
  const boundOf = (match: FillMatch) => (match.kind === "stated" || match.kind === "shifted" ? match.barTime : undefined);
  const matchExit = (notBefore?: number) => matchFill(bars, exitInstant, exitPrice, symbol, { role: "exit", barMinutes, notBefore });
  let exit = matchExit(boundOf(entry));
  if (entry.kind === "shifted" && exit.kind === "outside" && entry.barTime > exit.barTime) {
    entry = matchFill(bars, entryInstant, entryPrice, symbol, { role: "entry", barMinutes, notAfter: exit.barTime });
    exit = matchExit(boundOf(entry));
  }
  return { entry, exit };
}
