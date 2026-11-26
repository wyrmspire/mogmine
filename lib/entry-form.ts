// Price-first trade entry (owner feedback 2026-11-20, docs/20). Pure: no DOM, no storage.
// The form leads with side and prices; times come pre-filled and are set with native date and
// time pickers. This module owns the draft shape, its defaults, the time maths and the tick steppers.

import { DEFAULT_TIME_ZONE, formatDateTime, fromZonedInput, toZonedInput } from "./time.ts";
import { formatPrice } from "./format.ts";
import { isValidStatedRiskR } from "./r-size.ts";
import { canonicalSymbol, closeTradePatch, isExitReason, isStopMoveWidening, isWholeQuantity, snapToTick, specFor, stopPatch, tickDecimals, toTicks } from "./trades.ts";
import type { Candle, StopMove, TradeDirection, TradeRecord, TradeExitReason, TradeStatus } from "./trades.ts";
import { partialsTradeMetrics } from "./partials-record.ts";
import type { PartialsTradeMetrics } from "./partials-record.ts";
import type { PartialExit, PartialTarget } from "./partials-record.ts";

/** One optional split target (issue #38): a planned exit price and the contracts it takes. */
export interface DraftPartialTarget { price: string; qty: string }
/** One optional partial exit (issue #38): a scale-out fill, or a leg of a closed trade that left in pieces. */
export interface DraftPartialExit { price: string; clock: string; qty: string; reason?: TradeExitReason | null }

/** One optional "I moved my stop" row in manual entry (issue #36 G2): the new stop price and its clock. */
export interface DraftStopMove { price: string; clock: string }

export interface EntryDraft {
  /** Reused when a blocked-storage save is retried, so recovery cannot create a duplicate trade. */
  pendingTradeId?: string;
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
  /** Optional. What the trader said the trade risked, in R: "0.25", "0.5", "1" or other. "" when unstated (04 §4). */
  statedRiskR?: string;
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
  /** Optional. "I moved my stop" rows, in the order typed. Empty when the stop never moved. */
  stopMoves?: DraftStopMove[];
  /** Optional. Quick tags the trader accepted, e.g. "Moved Stop" (UX-33: accepted by a tap, never automatic). */
  quickTags?: string[];
  /** Optional. Split targets (issue #38: T1, T2 …), in the order typed. */
  partialTargets?: DraftPartialTarget[];
  /** Optional. Partial exits (issue #38), in the order typed. On a closed trade they must add up to Contracts. */
  partialExits?: DraftPartialExit[];
}

/** Clock drift allowed before a trade time counts as in the future (Q-11, 02 §2.3). */
export const FUTURE_ALLOWANCE_MS = 5 * 60_000;

/** UX-09: a typo'd date (tomorrow) is refused. Pure: the caller passes `now`. Open trades have no exit to check. */
export function validateFutureTimes(entryMs: number, exitMs: number | null, nowMs = Date.now(), zone = DEFAULT_TIME_ZONE): { entry?: string; exit?: string } {
  const errors: { entry?: string; exit?: string } = {};
  if (Number.isFinite(entryMs) && entryMs > nowMs + FUTURE_ALLOWANCE_MS) errors.entry = `This entry is in the future (${formatDateTime(entryMs, zone)}). Check the date.`;
  if (exitMs != null && Number.isFinite(exitMs) && exitMs > nowMs + FUTURE_ALLOWANCE_MS) errors.exit = `This exit is in the future (${formatDateTime(exitMs, zone)}). Check the date.`;
  return errors;
}

/** UX-09 warning (Q-10): a typed price more than 1% outside the day's bar range. A warning only: saving is never blocked. */
export function checkPriceAgainstDayRange(price: number | null, symbol: string, dayBars: readonly Pick<Candle, "low" | "high">[]): string | null {
  if (price == null || !Number.isFinite(price) || dayBars.length === 0) return null;
  const dayLow = Math.min(...dayBars.map((bar) => bar.low));
  const dayHigh = Math.max(...dayBars.map((bar) => bar.high));
  if (price >= dayLow * 0.99 && price <= dayHigh * 1.01) return null;
  return `${formatPrice(price, symbol)} is far from where ${canonicalSymbol(symbol) ?? symbol} traded that day (${formatPrice(dayLow, symbol)}–${formatPrice(dayHigh, symbol)}). Typo?`;
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

const isDraftRow = (value: unknown): value is { price: string; qty: string; clock?: unknown; reason?: unknown } =>
  !!value && typeof value === "object" && typeof (value as { price?: unknown }).price === "string" && typeof (value as { qty?: unknown }).qty === "string";

function isDraftStopMove(value: unknown): value is DraftStopMove {
  const move = value as Partial<DraftStopMove> | null;
  return move != null && typeof move === "object" && typeof move.price === "string" && typeof move.clock === "string";
}

/** A new draft: closed, long, 1 MES, entry 30 minutes ago and exit now, on the entry's date. */
export function freshEntryDraft(now: Date, zone: string): EntryDraft {
  const entry = zonedParts(new Date(now.getTime() - DEFAULT_HOLD_MINUTES * 60_000), zone);
  const exit = zonedParts(now, zone);
  return {
    status: "closed", symbol: "MES", direction: "LONG", quantity: "1",
    entryPrice: "", exitPrice: "", exitReason: null, stopPrice: "", targetPrice: "", statedRiskR: "",
    date: entry.date, entryClock: entry.clock, exitClock: exit.clock,
    entryMoodSpoke: null, stopMoves: [], quickTags: [],
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
    ...(typeof old.pendingTradeId === "string" ? { pendingTradeId: old.pendingTradeId } : {}),
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
    statedRiskR: text(old.statedRiskR, ""),
    ...(old.accountId === null || typeof old.accountId === "string" ? { accountId: old.accountId } : {}),
    date: text(old.date, entry?.date || fresh.date),
    entryClock: text(old.entryClock, entry?.clock || fresh.entryClock),
    exitClock: text(old.exitClock, exit?.clock || fresh.exitClock),
    entryMoodSpoke: typeof old.entryMoodSpoke === "string" ? old.entryMoodSpoke : null,
    stopMoves: Array.isArray(old.stopMoves) ? (old.stopMoves as unknown[]).filter(isDraftStopMove).map(({ price, clock }) => ({ price, clock })) : [],
    quickTags: Array.isArray(old.quickTags) ? old.quickTags.filter((tag: unknown): tag is string => typeof tag === "string") : [],
    ...(Array.isArray(old.partialTargets) ? { partialTargets: (old.partialTargets as unknown[]).filter(isDraftRow).map(({ price, qty }) => ({ price, qty })) } : {}),
    ...(Array.isArray(old.partialExits) ? { partialExits: (old.partialExits as unknown[]).filter(isDraftRow).map((row) => ({ price: row.price, qty: row.qty, clock: typeof row.clock === "string" ? row.clock : "", reason: isExitReason(row.reason) ? row.reason : null })) } : {}),
  };
}

/** A durable save clears the form; a session-only save keeps an idempotent draft for retry. */
export function entryDraftAfterSave(draft: EntryDraft, tradeId: string, saved: boolean): EntryDraft | null {
  return saved ? null : { ...draft, pendingTradeId: tradeId };
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

/** The stated risk text as a number: null when unstated (""), NaN when the text is not a number (see `statedRiskError`). */
export function statedRiskRFrom(text: string | undefined): number | null {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** Why a stated risk is refused, or undefined. Unstated is fine; otherwise 0.01 to 10 R, at most two decimals. */
export function statedRiskError(text: string | undefined): string | undefined {
  const value = statedRiskRFrom(text);
  if (value == null) return undefined;
  return isValidStatedRiskR(value) ? undefined : "Stated risk must be 0.01 to 10 R, up to two decimals";
}

/**
 * The stop that risks `riskRValue` of an account R size, for one trade (04 §4 "Use stop"). Dollars are
 * `rSizeCents × riskRValue`; points are dollars ÷ (quantity × $/pt). The stop lands on the tick grid on the
 * risk side, rounded away from entry, so the risk is never smaller than the stated one. Null when any input
 * is invalid, when the entry is off the tick grid, or when the stop would equal the entry.
 */
export function suggestedStopFromRiskR(entryPrice: number, direction: TradeDirection, symbol: string, quantity: number, rSizeCents: number, riskRValue: number): number | null {
  const spec = specFor(symbol);
  if (!spec || !isWholeQuantity(quantity) || !Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isFinite(rSizeCents) || rSizeCents <= 0 || !Number.isFinite(riskRValue) || riskRValue <= 0) return null;
  if (toTicks(entryPrice, symbol) == null) return null;
  const usd = (rSizeCents / 100) * riskRValue;
  const points = usd / (quantity * spec.pointValueUsd);
  const ticks = Math.ceil(points / spec.tickSize - 1e-9);
  if (!(ticks > 0)) return null;
  const distance = ticks * spec.tickSize;
  const stop = Number((direction === "SHORT" ? entryPrice + distance : entryPrice - distance).toFixed(tickDecimals(spec.tickSize)));
  return stop > 0 && stop !== entryPrice ? stop : null;
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

// ── "I moved my stop" rows (issue #36 G2, R-10, SM-3) ─────────────────────────────────────────────

export interface ResolvedStopMoves {
  /** The first row problem, shown inline and blocking save. Null when every filled row is valid. */
  error: string | null;
  /** Time-sorted stop moves for the saved trade. Empty when no row is filled. */
  moves: StopMove[];
  /** The stop the trade is left at: the last move, or the initial stop when none. */
  workingStopPrice: number | null;
  /** True when a move sits farther on the risk side than the initial stop or the move before it. */
  widened: boolean;
}

/**
 * Validate the optional stop-move rows. Blank rows are ignored. A filled row needs the initial stop
 * first, a tick-grid price, and a clock read on `date` (the next day when earlier than the entry clock,
 * as `entryTimes` reads the exit) that falls within [entry, exit]. Pure.
 */
export function resolveDraftStopMoves(params: {
  stopMoves: readonly DraftStopMove[]; initialStopPrice: number | null; entryPrice: number | null; direction: TradeDirection;
  symbol: string; date: string; entryMs: number; exitMs: number | null; zone: string;
}): ResolvedStopMoves {
  const { stopMoves, initialStopPrice, direction, symbol, date, entryMs, exitMs, zone } = params;
  const rows = stopMoves.filter((row) => row.price.trim() !== "" || row.clock.trim() !== "");
  const fail = (error: string): ResolvedStopMoves => ({ error, moves: [], workingStopPrice: initialStopPrice, widened: false });
  if (rows.length === 0) return { error: null, moves: [], workingStopPrice: initialStopPrice, widened: false };
  if (initialStopPrice == null) return fail("Enter the initial stop first");
  if (!Number.isFinite(entryMs)) return fail("Pick the entry time first");
  const entryClock = zonedParts(new Date(entryMs), zone).clock;
  const moves: StopMove[] = [];
  for (const row of rows) {
    const price = priceOrNull(row.price);
    if (price == null || !Number.isFinite(price) || !(price > 0) || toTicks(price, symbol) == null) return fail("Enter the moved stop on the tick grid");
    if (!/^\d{2}:\d{2}$/.test(row.clock)) return fail("Pick the time the stop moved");
    const at = fromZonedInput(`${addCalendarDays(date, row.clock < entryClock ? 1 : 0)}T${row.clock}`, zone).getTime();
    if (!Number.isFinite(at)) return fail("Pick the time the stop moved");
    if (at < entryMs) return fail("A stop move cannot be before the entry");
    if (exitMs != null && at > exitMs) return fail("A stop move cannot be after the exit");
    moves.push({ price, time: new Date(at).toISOString() });
  }
  moves.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  let prior = initialStopPrice;
  let widened = false;
  for (const move of moves) {
    if (isStopMoveWidening(prior, move.price, direction, symbol)) widened = true;
    prior = move.price;
  }
  return { error: null, moves, workingStopPrice: moves[moves.length - 1]?.price ?? initialStopPrice, widened };
}

/**
 * The stop fields a saved trade gets. No moves: the stop as before (R-10 freezes the first one). With
 * moves: the stop is frozen at entry, and the trade is left at the last move (SM-3: stop_loss_price === last move).
 */
export function entryStopFields(stopPrice: number | null, resolved: Pick<ResolvedStopMoves, "moves" | "workingStopPrice">, entryIso: string, nowIso: string): Partial<TradeRecord> {
  if (resolved.moves.length === 0) return stopPatch({ initial_stop_price: null }, stopPrice, nowIso);
  return { initial_stop_price: stopPrice, initial_stop_set_at: entryIso, stop_loss_price: resolved.workingStopPrice, stop_moves: resolved.moves };
}

// ── Split targets and partial exits (issue #38, docs/15 §2.3–2.4, docs/26 §4) ───────────────────

export interface ResolvedPartials {
  /** First row problem, shown inline and blocking save. Null when valid. */
  error: string | null;
  /** A partial-exit row is filled: the single Exit price and time are replaced by the legs. */
  legged: boolean;
  targets: PartialTarget[];
  exits: PartialExit[];
  /** Weighted-average exit price (tick grid) and latest leg time, when the legs close every contract. */
  exitPrice: number | null;
  exitTime: string | null;
  /** Exact multi-lot metrics (docs/15 §2.4) when the legs close every contract. */
  metrics: PartialsTradeMetrics | null;
}

const filledRow = (row: { price: string; qty: string; clock?: string }) => row.price.trim() !== "" || row.qty.trim() !== "" || (row.clock ?? "").trim() !== "";

/**
 * Validate the optional split targets and partial exits (blank rows ignored). Quantities cannot exceed Contracts; a
 * closed trade's exits must add up to Contracts exactly, which sets its exit price and time. Pure.
 */
export function resolveDraftPartials(params: { draft: EntryDraft; entryPrice: number | null; quantity: number; isOpenDraft: boolean; entryMs: number; zone: string }): ResolvedPartials {
  const { draft, entryPrice, quantity, isOpenDraft, entryMs, zone } = params;
  const targetRows = (draft.partialTargets ?? []).filter(filledRow);
  const exitRows = (draft.partialExits ?? []).filter(filledRow);
  const legged = !isOpenDraft && exitRows.length > 0;
  const empty = { legged, targets: [], exits: [], exitPrice: null, exitTime: null, metrics: null };
  const fail = (error: string): ResolvedPartials => ({ ...empty, error });
  if (targetRows.length === 0 && exitRows.length === 0) return { ...empty, error: null };
  if (!isWholeQuantity(quantity)) return fail("Enter the contracts first");
  if (entryPrice == null || !Number.isFinite(entryPrice)) return fail("Enter the entry price first");
  if (exitRows.length > 0 && !Number.isFinite(entryMs)) return fail("Pick the entry time first");
  const sign = draft.direction === "SHORT" ? -1 : 1;
  const targets: PartialTarget[] = [];
  for (const [index, row] of targetRows.entries()) {
    const label = `Target T${index + 1}`;
    const price = priceOrNull(row.price);
    const qty = Number(row.qty);
    if (price == null || !Number.isFinite(price) || toTicks(price, draft.symbol) == null) return fail(`${label} needs a price on the tick grid`);
    if ((price - entryPrice) * sign <= 0) return fail(`${label} must sit on the reward side of entry`);
    if (!isWholeQuantity(qty)) return fail(`${label} needs a whole quantity of 1 or more`);
    targets.push({ key: `t${index + 1}`, price, qty });
  }
  const targetQty = targets.reduce((sum, target) => sum + target.qty, 0);
  if (targetQty > quantity) return fail(`Target contracts (${targetQty}) cannot exceed Contracts (${quantity})`);
  const exits: PartialExit[] = [];
  for (const [index, row] of exitRows.entries()) {
    const label = `Partial exit ${index + 1}`;
    const price = priceOrNull(row.price);
    const qty = Number(row.qty);
    if (!/^\d{2}:\d{2}$/.test(row.clock ?? "")) return fail(`${label} needs a time`);
    const at = fromZonedInput(`${addCalendarDays(draft.date, row.clock < draft.entryClock ? 1 : 0)}T${row.clock}`, zone).getTime();
    if (!Number.isFinite(at) || at < entryMs) return fail(`${label} cannot be before the entry`);
    if (price == null || !Number.isFinite(price) || toTicks(price, draft.symbol) == null) return fail(`${label} needs a price on the tick grid`);
    if (!isWholeQuantity(qty)) return fail(`${label} needs a whole quantity of 1 or more`);
    exits.push({ time: new Date(at).toISOString(), price, qty, ...(row.reason ? { reason: row.reason } : {}) });
  }
  exits.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const exitQty = exits.reduce((sum, leg) => sum + leg.qty, 0);
  if (exitQty > quantity) return fail(`Partial exits (${exitQty}) cannot exceed Contracts (${quantity})`);
  if (legged && exitQty !== quantity) return fail(`Partial exit quantities (${exitQty}) must equal Contracts (${quantity}), or switch status to Still open`);
  if (!legged || exitQty !== quantity) return { error: null, legged, targets, exits, exitPrice: null, exitTime: null, metrics: null };
  const exitPrice = snapToTick(exits.reduce((sum, leg) => sum + leg.price * leg.qty, 0) / quantity, draft.symbol);
  if (exitPrice == null) return fail("Partial exit prices must sit on the tick grid");
  const exitTime = exits.reduce((latest, leg) => (Date.parse(leg.time) > Date.parse(latest) ? leg.time : latest), exits[0].time);
  const stop = priceOrNull(draft.stopPrice);
  const metrics = partialsTradeMetrics({
    symbol: draft.symbol, direction: draft.direction, quantity, entry_price: entryPrice, exit_price: exitPrice, status: "closed",
    entry_time: new Date(entryMs).toISOString(), exit_time: exitTime, initial_stop_price: stop, stop_loss_price: stop, partial_exits: exits, partial_targets: targets,
  });
  return { error: null, legged, targets, exits, exitPrice, exitTime, metrics };
}

/** Contracts an open trade still holds after its partial exits. */
export function remainingOpenQty(trade: Pick<TradeRecord, "quantity" | "partial_exits">): number {
  return trade.quantity - (trade.partial_exits ?? []).reduce((sum, leg) => sum + leg.qty, 0);
}

/**
 * The patch for closing `exitQty` contracts of an open trade (issue #38). Less than what is open: stays open with
 * one more leg. The last lot: a single close is `closeTradePatch`; several legs close at their weighted average.
 * Null when `exitQty` is out of 1..open contracts.
 */
export function scaleOutTradePatch(trade: TradeRecord, exitIso: string, exitPrice: number, exitQty: number, reason: TradeExitReason | null): Partial<TradeRecord> | null {
  const remainingQty = remainingOpenQty(trade);
  if (!isWholeQuantity(exitQty) || exitQty > remainingQty) return null;
  const leg: PartialExit = { time: exitIso, price: exitPrice, qty: exitQty, ...(reason ? { reason } : {}) };
  const nextExits = [...(trade.partial_exits ?? []), leg];
  if (exitQty < remainingQty) return { partial_exits: nextExits, status: "open", exit_time: null, exit_price: null };
  if (nextExits.length === 1) return closeTradePatch(trade, exitIso, exitPrice, reason);
  const average = snapToTick(nextExits.reduce((sum, item) => sum + item.price * item.qty, 0) / trade.quantity, trade.symbol);
  if (average == null) return null;
  const latest = nextExits.reduce((a, item) => (Date.parse(item.time) > Date.parse(a) ? item.time : a), exitIso);
  return { ...closeTradePatch(trade, latest, average, reason), partial_exits: nextExits };
}
