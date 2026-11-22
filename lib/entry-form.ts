// Price-first trade entry (owner feedback 2026-11-20, docs/20). Pure: no DOM, no storage.
// The form leads with side and prices; times come pre-filled and are set with native date and
// time pickers. This module owns the draft shape, its defaults, the time maths and the tick steppers.

import { fromZonedInput, toZonedInput } from "./time.ts";
import { isExitReason, snapToTick, specFor, tickDecimals, toTicks } from "./trades.ts";
import type { TradeDirection, TradeExitReason, TradeStatus } from "./trades.ts";

export interface EntryDraft {
  /** `open`: still running, no exit yet (R-03b). */
  status: TradeStatus;
  /** The trader set the entry time by hand: switching to Still open keeps it, and the bar finder never overwrites it. */
  entryEdited?: boolean;
  /** The trader set the exit time by hand: the bar finder never overwrites it. */
  exitEdited?: boolean;
  /** The trader picked the date by hand. */
  dateEdited?: boolean;
  symbol: string;
  direction: TradeDirection;
  quantity: string;
  entryPrice: string;
  /** Ignored while `status` is `open`. */
  exitPrice: string;
  /** Optional. How the trade ended: Target · Stop · Trailed · Breakeven · Market (docs/15 §3, issue #36 G1). */
  exitReason?: TradeExitReason | null;
  /** Optional. Saved as the stop and frozen as the initial stop (R-10). */
  stopPrice: string;
  /** Optional. Saved as the planned target. */
  targetPrice: string;
  /** The account the trade is logged to (docs/21). Undefined until the trader picks: the account used last. */
  accountId?: string | null;
  /** Entry date, `YYYY-MM-DD`, wall clock in the display zone. */
  date: string;
  /** Entry time, `HH:mm`, wall clock in the display zone. */
  entryClock: string;
  /** Exit time, `HH:mm`. Earlier than the entry time means the next calendar day (an overnight hold). */
  exitClock: string;
  /** Optional. One-tap feeling at entry (docs/19 §4, OD-39 c). */
  entryMoodSpoke?: string | null;
}

/** Minutes the default entry sits before the default exit for a closed trade. */
export const DEFAULT_HOLD_MINUTES = 30;

/** `YYYY-MM-DDTHH:mm` → `{ date, clock }`. Empty parts for anything else. */
export function splitZonedInput(value: string): { date: string; clock: string } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value ?? "");
  return match ? { date: match[1], clock: match[2] } : { date: "", clock: "" };
}

/** Wall-clock date and time of `instant` in `zone`. */
export function zonedParts(instant: Date, zone: string) {
  return splitZonedInput(toZonedInput(instant, zone));
}

/** A new draft: closed, long, 1 MES, entry 30 minutes ago and exit now, on the entry's date. */
export function freshEntryDraft(now: Date, zone: string): EntryDraft {
  const entry = zonedParts(new Date(now.getTime() - DEFAULT_HOLD_MINUTES * 60_000), zone);
  const exit = zonedParts(now, zone);
  return {
    status: "closed", symbol: "MES", direction: "LONG", quantity: "1",
    entryPrice: "", exitPrice: "", exitReason: null, stopPrice: "", targetPrice: "",
    date: entry.date, entryClock: entry.clock, exitClock: exit.clock,
    entryMoodSpoke: null,
  };
}

/**
 * A draft kept by an older build (datetime-local `entryTime` / `exitTime`, no stop or target) in the
 * current shape, so nothing typed is lost across an update. A current draft is returned as is.
 */
export function upgradeDraft(raw: unknown, now: Date, zone: string): EntryDraft {
  const fresh = freshEntryDraft(now, zone);
  if (!raw || typeof raw !== "object") return fresh;
  const old = raw as Partial<EntryDraft> & { entryTime?: string; exitTime?: string };
  const text = (value: unknown, fallback: string) => (typeof value === "string" ? value : fallback);
  const entry = old.entryTime ? splitZonedInput(old.entryTime) : null;
  const exit = old.exitTime ? splitZonedInput(old.exitTime) : null;
  return {
    status: old.status === "open" ? "open" : "closed",
    entryEdited: old.entryEdited === true,
    exitEdited: old.exitEdited === true,
    dateEdited: old.dateEdited === true,
    symbol: text(old.symbol, fresh.symbol),
    direction: old.direction === "SHORT" ? "SHORT" : "LONG",
    quantity: text(old.quantity, fresh.quantity),
    entryPrice: text(old.entryPrice, ""),
    exitPrice: text(old.exitPrice, ""),
    exitReason: isExitReason(old.exitReason) ? old.exitReason : null,
    stopPrice: text(old.stopPrice, ""),
    targetPrice: text(old.targetPrice, ""),
    ...(old.accountId === null || typeof old.accountId === "string" ? { accountId: old.accountId } : {}),
    date: text(old.date, entry?.date || fresh.date),
    entryClock: text(old.entryClock, entry?.clock || fresh.entryClock),
    exitClock: text(old.exitClock, exit?.clock || fresh.exitClock),
    entryMoodSpoke: typeof old.entryMoodSpoke === "string" ? old.entryMoodSpoke : null,
  };
}

/** `YYYY-MM-DD` plus `days` calendar days. Empty for an invalid date. */
export function addCalendarDays(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "";
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return utc.toISOString().slice(0, 10);
}

export interface EntryTimes {
  /** Invalid Date when the date or time is missing. */
  entry: Date;
  /** Null for an open trade. Invalid Date when the time is missing. */
  exit: Date | null;
  /** The exit clock is earlier than the entry clock, so the exit is read as the next day. */
  exitNextDay: boolean;
}

/**
 * Read the draft's date and clocks as instants in `zone`. One date covers both fills; an exit time
 * earlier than the entry time is the next calendar day (futures trade overnight). Equal clocks stay
 * on the same day, so the form's "exit must be after the entry" rule still catches them.
 */
export function entryTimes(draft: Pick<EntryDraft, "status" | "date" | "entryClock" | "exitClock">, zone: string): EntryTimes {
  const entry = fromZonedInput(`${draft.date}T${draft.entryClock}`, zone);
  if (draft.status === "open") return { entry, exit: null, exitNextDay: false };
  const exitNextDay = /^\d{2}:\d{2}$/.test(draft.exitClock) && /^\d{2}:\d{2}$/.test(draft.entryClock) && draft.exitClock < draft.entryClock;
  const exitDate = exitNextDay ? addCalendarDays(draft.date, 1) : draft.date;
  return { entry, exit: fromZonedInput(`${exitDate}T${draft.exitClock}`, zone), exitNextDay };
}

/** Price text → number, or null for an empty field. "abc" is NaN, so the validator reports it. */
export const priceOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

/**
 * One tick-stepper press: move `text` by `steps` ticks of the contract. An empty field starts from
 * `seed` (the entry price, for stop, target and exit), so `−` on an empty stop gives entry − 1 tick.
 * An off-tick price is snapped first: the stepper is an explicit choice to move onto the grid.
 * Returns `text` unchanged when there is nothing to step from or the result would not be above 0.
 */
export function stepPriceText(text: string, steps: number, symbol: string, seed = ""): string {
  const spec = specFor(symbol);
  if (!spec || !Number.isFinite(steps)) return text;
  const own = priceOrNull(text);
  const seeded = priceOrNull(seed);
  const base = own != null && Number.isFinite(own) ? own : own == null && seeded != null && Number.isFinite(seeded) ? seeded : null;
  if (base == null) return text;
  const snapped = toTicks(base, symbol) != null ? base : snapToTick(base, symbol);
  const ticks = snapped == null ? null : toTicks(snapped, symbol);
  if (ticks == null) return text;
  const next = (ticks + Math.trunc(steps)) * spec.tickSize;
  if (!(next > 0)) return text;
  return next.toFixed(tickDecimals(spec.tickSize));
}


// ── Times from the bars (OD-41 (5), docs/20 §2.2) ───────────────────────────────────────────────

/** The bars window for a picked date: 00:00 to 24:00 on that date in the display zone, UTC ms. */
export function dayWindow(date: string, zone: string): { from: number; to: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const from = fromZonedInput(`${date}T00:00`, zone).getTime();
  const to = fromZonedInput(`${addCalendarDays(date, 1)}T00:00`, zone).getTime();
  return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
}

/** Minimal view of `InferResult` the form needs, so this module does not depend on the finder. */
export interface TimeSuggestion {
  entryTime: number | null;
  exitTime: number | null;
}

/**
 * The draft patch that fills the time pickers from a suggestion. A time the trader set by hand is
 * never overwritten; `force` (the trader tapped "Use") overwrites and hands both back to the finder.
 */
export function suggestionPatch(draft: Pick<EntryDraft, "status" | "entryEdited" | "exitEdited" | "entryClock" | "exitClock">, suggestion: TimeSuggestion, zone: string, force = false): Partial<EntryDraft> {
  const patch: Partial<EntryDraft> = {};
  if (suggestion.entryTime != null && (force || !draft.entryEdited)) {
    patch.entryClock = zonedParts(new Date(suggestion.entryTime), zone).clock;
    if (force) patch.entryEdited = false;
  }
  if (draft.status !== "open" && suggestion.exitTime != null && (force || !draft.exitEdited)) {
    patch.exitClock = zonedParts(new Date(suggestion.exitTime), zone).clock;
    if (force) patch.exitEdited = false;
  }
  return patch;
}
