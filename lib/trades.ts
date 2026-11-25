// Core trade types and money math. Pure: no I/O, no DOM.
// Names follow docs/06 (interim canonical under OD-1).

import { insideBarTimes } from "./session.ts";
import { isValidRSizeCents, isValidStatedRiskR, riskCents } from "./r-size.ts";
import type { TradingAccount } from "./accounts.ts";
import type { Prefs } from "./prefs-sanitize.ts";
export { expectedInsideBarTimes } from "./session.ts";

export type TradeDirection = "LONG" | "SHORT";

/** Optional account R sizes and prefs for account-R consumers (RS-3a). Omit both to use the default R size. */
export interface RSizeOptions {
  accounts?: readonly Pick<TradingAccount, "id" | "r_size_cents">[];
  prefs?: Partial<Pick<Prefs, "riskBudgetUsd">> | null;
}
export type TradeStyle = "scalp" | "session_90m" | "investment";
export type Timeframe = "1m" | "5m" | "15m" | "1h";
export type ReviewStatus = "new" | "tagged" | "reviewed";
/** `open`: no exit yet, both exit fields are null (R-03, docs/09 §8). Only these two values. */
export type TradeStatus = "open" | "closed";
export type CandleSource = "Yahoo Finance" | "Demo fixture";

export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h"];
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60 };
/** Fewest bars a fitted trade window shows (owner, 2026-11-15: raised from 30). */
export const MIN_FITTED_BARS = 45;

export interface Candle {
  /** Bar open time, UTC milliseconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PriceRange {
  minValue: number;
  maxValue: number;
}

/** Extend an autoscale range with every finite required price. */
export function includeInPriceRange(base: PriceRange | null, required: Array<number | null | undefined>): PriceRange | null {
  const prices = required.filter((value): value is number => value != null && Number.isFinite(value));
  if (!prices.length) return base;
  return {
    minValue: Math.min(base?.minValue ?? Infinity, ...prices),
    maxValue: Math.max(base?.maxValue ?? -Infinity, ...prices),
  };
}

/** One checklist rule, frozen on the trade when the playbook is chosen (UX-50). */
export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

/** A single stated stop-movement event (price + time) (docs/15 §3, issue #36 G2). */
export interface StopMove {
  /** The new stop loss price. */
  price: number;
  /** When the stop was moved (UTC ISO-8601 string). */
  time: string;
}

export function isStopMove(value: unknown): value is StopMove {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as StopMove).price === "number" &&
    Number.isFinite((value as StopMove).price) &&
    typeof (value as StopMove).time === "string" &&
    Number.isFinite(Date.parse((value as StopMove).time))
  );
}

export function sanitizeStopMoves(moves: unknown): StopMove[] {
  if (!Array.isArray(moves)) return [];
  return moves
    .filter(isStopMove)
    .map((m) => ({ price: m.price, time: m.time }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** One-tap exit reason (docs/15 §3, issue #36 G1). */
export type TradeExitReason = "target" | "stop" | "trail" | "breakeven" | "manual";

export const EXIT_REASONS: ReadonlyArray<{ value: TradeExitReason; label: string; flag: string }> = [
  { value: "target", label: "Target", flag: "TP" },
  { value: "stop", label: "Stop", flag: "SL" },
  { value: "trail", label: "Trailed", flag: "TRAIL" },
  { value: "breakeven", label: "Breakeven", flag: "BE" },
  { value: "manual", label: "Market", flag: "MKT" },
];

export function isExitReason(value: unknown): value is TradeExitReason {
  return typeof value === "string" && EXIT_REASONS.some((r) => r.value === value);
}

export interface TradeRecord {
  id: string;
  user_id: string;
  /** The account this trade was taken in (docs/21). Null: not assigned; it counts toward no account total. */
  account_id: string | null;
  symbol: string;
  yahoo_ticker: string;
  direction: TradeDirection;
  trade_style: TradeStyle;
  /** `open` ⇔ `exit_time === null` ⇔ `exit_price === null` (enforced by `normalizeTrade`). */
  status: TradeStatus;
  entry_time: string;
  /** Null while the trade is open (R-03). Never a stand-in such as `""` or the entry. */
  exit_time: string | null;
  entry_price: number;
  /** Null while the trade is open (R-03). Never `0` or the entry price. */
  exit_price: number | null;
  /**
   * How the trade ended (docs/15 §3, issue #36 G1). One tap: Target · Stop · Trailed · Breakeven · Market.
   * Null on open trades or when unstated on manual entry (then inferred where exit equals stop/target).
   */
  exit_reason?: TradeExitReason | null;
  stop_loss_price: number | null;
  /**
   * The first stop this trade ever had, frozen when it was set (R-10). Later edits move
   * `stop_loss_price` only. Null until a stop is first set; records saved before R-10 stay null —
   * their initial stop is unknown and is never back-filled from `stop_loss_price`.
   */
  initial_stop_price: number | null;
  /** When `initial_stop_price` was captured (ISO). Null with it. */
  initial_stop_set_at: string | null;
  /**
   * Stated stop-movement rows (price + time) feeding the stepped stop path (docs/15 §3, issue #36 G2).
   * Optional; empty or undefined means no stop moves recorded.
   */
  stop_moves?: StopMove[];
  planned_target_price: number | null;
  key_level_price: number | null;
  quantity: number;
  /** Free-text review note (Simple Mode). */
  note: string;
  review_status: ReviewStatus;
  playbook_id: string | null;
  quick_tags: string[];
  checklist_state: ChecklistItem[];
  pre_trade_thesis: string;
  management_notes: string;
  post_exit_notes: string;
  flagged: boolean;
  /** Blind review answer, given before the outcome was shown (docs/13 BET-03). */
  take_again: "yes" | "smaller" | "pass" | null;
  take_again_at: string | null;
  /** Fixture or tool-made trade. Never counted in statistics (docs/10 §5). */
  is_sample: boolean;
  /** ~40 closes around the trade for list thumbnails, so lists never load candles (B-42). */
  sparkline: number[];
  /** Where the candles last came from. The candle cache is the live truth; this is a hint for lists. */
  candle_source?: CandleSource;
  /**
   * Version of the sample fixture this record was built from (issue #62). Undefined on records stored
   * before this field existed. Real trades never set it.
   */
  fixture_version?: number;
  /**
   * True once a trader changes an annotation (note, checklist, tags, playbook, thesis, management or
   * post-exit notes). A later fixture refresh keeps such annotations (issue #62). Undefined on records
   * stored before this field existed.
   */
  annotations_modified?: boolean;
  /** R size in whole cents, frozen when the trade was saved (04 §3.3, D-B). Null on older records: resolved at read time. */
  r_size_cents?: number | null;
  /** The risk the trader said, as a share of R (e.g. 0.25). Typed input, never computed. Null when not stated. */
  stated_risk_r?: number | null;
  /** Actual initial-stop dollars risked in integer cents. Recomputed on every normalize; a client value that differs is refused. */
  risk_cents?: number | null;
}

export const DEFAULT_OWNER_USER_ID = "demo-owner";

export interface FuturesContractSpec {
  tickSize: number;
  pointValueUsd: number;
  yahooTicker: string;
}

export const FUTURES_SPECS: Record<string, FuturesContractSpec> = {
  MES: { tickSize: 0.25, pointValueUsd: 5, yahooTicker: "MES=F" },
  ES: { tickSize: 0.25, pointValueUsd: 50, yahooTicker: "ES=F" },
  MNQ: { tickSize: 0.25, pointValueUsd: 2, yahooTicker: "MNQ=F" },
  NQ: { tickSize: 0.25, pointValueUsd: 20, yahooTicker: "NQ=F" },
  MYM: { tickSize: 1, pointValueUsd: 0.5, yahooTicker: "YM=F" },
  M2K: { tickSize: 0.1, pointValueUsd: 5, yahooTicker: "RTY=F" },
  MGC: { tickSize: 0.1, pointValueUsd: 10, yahooTicker: "GC=F" },
  MCL: { tickSize: 0.01, pointValueUsd: 100, yahooTicker: "CL=F" },
};

/** Upper-case a known contract (`mes` → `MES`), or null for anything not in FUTURES_SPECS. */
export function canonicalSymbol(symbol: string): string | null {
  const key = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  return Object.prototype.hasOwnProperty.call(FUTURES_SPECS, key) ? key : null;
}

/** The contract's spec, or null for an unknown symbol. There is no fallback spec (issue #50). */
export function specFor(symbol: string): FuturesContractSpec | null {
  const key = canonicalSymbol(symbol);
  return key ? FUTURES_SPECS[key] : null;
}

/** Contract quantity must be a whole number of 1 or more. Anything else prices as null. */
export function isWholeQuantity(quantity: number) {
  return Number.isInteger(quantity) && quantity > 0;
}

const TICK_TOLERANCE = 1e-6;

/**
 * Price as an integer number of ticks, or null when the price is not finite, the symbol is
 * unknown, or the price is off the tick grid. Off-tick prices are never rounded here: an
 * imported fill keeps its exact value, and the validator rejects it before it is saved (B-31).
 */
export function toTicks(priceValue: number, symbol: string): number | null {
  const spec = specFor(symbol);
  if (!spec || !Number.isFinite(priceValue)) return null;
  const ticks = priceValue / spec.tickSize;
  const rounded = Math.round(ticks);
  return Math.abs(ticks - rounded) <= TICK_TOLERANCE ? rounded : null;
}

/** Snap a price to the contract's tick grid. An explicit choice by the caller, never implicit (issue #50). */
export function snapToTick(priceValue: number, symbol: string): number | null {
  const spec = specFor(symbol);
  if (!spec || !Number.isFinite(priceValue)) return null;
  const decimals = tickDecimals(spec.tickSize);
  return Number((Math.round(priceValue / spec.tickSize) * spec.tickSize).toFixed(decimals));
}

export function tickDecimals(tickSize: number) {
  const text = String(tickSize);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Dollars per tick per contract, in integer cents, or null for an unknown symbol. */
export function tickValueCents(symbol: string): number | null {
  const spec = specFor(symbol);
  return spec ? Math.round(spec.tickSize * spec.pointValueUsd * 100) : null;
}

type Priced = Pick<TradeRecord, "symbol" | "direction" | "entry_price" | "exit_price" | "quantity">;

/** +1 for a long, −1 for a short, null for anything else. */
function sideSign(direction: string): 1 | -1 | null {
  return direction === "LONG" ? 1 : direction === "SHORT" ? -1 : null;
}

/**
 * Signed ticks captured per contract: positive when the trade made money.
 * Null when a price is non-finite or off-tick, the symbol is unknown, the quantity
 * is not a whole number of 1 or more, or the direction is not LONG or SHORT (issue #50, #63).
 */
export function tradeTicks(trade: Priced): number | null {
  // An open trade has no result yet: no unrealised P&L from delayed bars (OD-38, B-30).
  if (trade.exit_price == null || !isWholeQuantity(trade.quantity)) return null;
  const sign = sideSign(trade.direction);
  const entry = toTicks(trade.entry_price, trade.symbol);
  const exit = toTicks(trade.exit_price, trade.symbol);
  if (sign == null || entry == null || exit == null) return null;
  return (exit - entry) * sign;
}

/** Signed points captured per contract, or null when the trade cannot be priced. */
export function tradePoints(trade: Priced): number | null {
  const spec = specFor(trade.symbol);
  const ticks = tradeTicks(trade);
  if (!spec || ticks == null) return null;
  return Number((ticks * spec.tickSize).toFixed(tickDecimals(spec.tickSize)));
}

/** Gross P&L in dollars, computed in integer ticks and cents. Null for an invalid trade, never a plausible number. */
export function tradePnl(trade: Priced): number | null {
  const ticks = tradeTicks(trade);
  const cents = tickValueCents(trade.symbol);
  if (ticks == null || cents == null || !isWholeQuantity(trade.quantity)) return null;
  return (ticks * trade.quantity * cents) / 100;
}

type Stops = { stop_loss_price?: number | null; initial_stop_price?: number | null };
/** Ticks from entry to `stop` on the risk side, or null (no stop, invalid price, wrong side, zero; issue #50). */
function riskTicksTo(trade: Priced, stop: number | null | undefined): number | null {
  const sign = sideSign(trade.direction), entry = toTicks(trade.entry_price, trade.symbol);
  const ticks = stop == null ? null : toTicks(stop, trade.symbol);
  const risk = sign == null || entry == null || ticks == null ? null : (entry - ticks) * sign;
  return risk != null && risk > 0 ? risk : null;
}

/** The stop R is measured against (R-10): the initial stop when it is on the risk side, else the current one. */
export function riskStopPrice(trade: Priced & Stops): number | null {
  if (riskTicksTo(trade, trade.initial_stop_price) != null) return trade.initial_stop_price!;
  return riskTicksTo(trade, trade.stop_loss_price) != null ? trade.stop_loss_price! : null;
}
const stopRiskTicks = (trade: Priced & Stops) => riskTicksTo(trade, riskStopPrice(trade));

/** Initial risk in dollars, or null without a valid stop. */
export function initialRiskUsd(trade: Priced & Pick<TradeRecord, "stop_loss_price"> & Stops): number | null {
  const riskTicks = stopRiskTicks(trade);
  const cents = tickValueCents(trade.symbol);
  if (riskTicks == null || cents == null || !isWholeQuantity(trade.quantity)) return null;
  return (riskTicks * trade.quantity * cents) / 100;
}

/**
 * Captured ticks ÷ the trade's own initial risk ticks (`riskStopPrice`). This is the stop-width ratio ("× risk"),
 * NOT account R: account R is `resultR` in `lib/r-size.ts` (04 §3.1, D-A). `null` without a valid stop.
 */
export function riskMultiple(trade: Priced & Pick<TradeRecord, "stop_loss_price"> & Stops): number | null {
  const riskTicks = stopRiskTicks(trade);
  const ticks = tradeTicks(trade);
  if (riskTicks == null || ticks == null || !isWholeQuantity(trade.quantity)) return null;
  return ticks / riskTicks;
}

/**
 * The patch for setting or changing a trade's stop (R-10). The first stop a trade ever has is
 * also frozen as its initial stop, stamped with `now` (ISO). Once an initial stop exists this
 * returns a `stop_loss_price`-only patch, so no later edit — including a backup restore of the
 * same trade — ever overwrites it.
 */
export function stopPatch(
  trade: Pick<TradeRecord, "initial_stop_price">,
  price: number | null,
  now: string,
): Partial<TradeRecord> {
  if (price == null || trade.initial_stop_price != null) return { stop_loss_price: price };
  return { stop_loss_price: price, initial_stop_price: price, initial_stop_set_at: now };
}

/** Stop-width ratio against the frozen initial stop (R-10): the same math as `riskMultiple`, on `initial_stop_price`. */
export function initialRiskMultiple(trade: Priced & Pick<TradeRecord, "initial_stop_price">): number | null {
  return trade.initial_stop_price == null ? null : riskMultiple({ ...trade, stop_loss_price: trade.initial_stop_price });
}

/**
 * A backup restore never overwrites an initial stop the device already holds for the same trade
 * (R-10 "Do not"). Returns `incoming` with the device's frozen pair when there is one.
 */
export function keepInitialStop(incoming: TradeRecord, existing: Pick<TradeRecord, "id" | "initial_stop_price" | "initial_stop_set_at"> | undefined): TradeRecord {
  if (!existing || existing.id !== incoming.id || existing.initial_stop_price == null) return incoming;
  if (incoming.initial_stop_price === existing.initial_stop_price && incoming.initial_stop_set_at === existing.initial_stop_set_at) return incoming;
  return { ...incoming, initial_stop_price: existing.initial_stop_price, initial_stop_set_at: existing.initial_stop_set_at };
}

/**
 * A backup restore never overwrites the R size a trade already froze on this device (04 §5.6). An incoming
 * record with no `r_size_cents` takes the device's frozen value; the same id is required.
 */
export function keepFrozenRSize(incoming: TradeRecord, existing: Pick<TradeRecord, "id" | "r_size_cents"> | undefined): TradeRecord {
  if (!existing || existing.id !== incoming.id || existing.r_size_cents == null || incoming.r_size_cents != null) return incoming;
  return { ...incoming, r_size_cents: existing.r_size_cents };
}

/**
 * Check if moving a stop from prevPrice to nextPrice widens risk (moves away from entry).
 * LONG: nextPrice < prevPrice (moving down increases risk).
 * SHORT: nextPrice > prevPrice (moving up increases risk).
 */
export function isStopMoveWidening(
  prevPrice: number,
  nextPrice: number,
  direction: TradeDirection,
  symbol?: string,
): boolean {
  const sign = sideSign(direction);
  if (sign == null) return false;
  const spec = symbol ? specFor(symbol) : null;
  const prevTicks = spec ? toTicks(prevPrice, symbol!) : null;
  const nextTicks = spec ? toTicks(nextPrice, symbol!) : null;
  if (prevTicks != null && nextTicks != null) {
    return (nextTicks - prevTicks) * sign < 0;
  }
  return (nextPrice - prevPrice) * sign < 0;
}

/**
 * Check if a stop price sits at or beyond entry on the winning side, locking profit.
 * LONG: stopPrice >= entryPrice.
 * SHORT: stopPrice <= entryPrice.
 */
export function isStopMoveLockingProfit(
  entryPrice: number,
  stopPrice: number,
  direction: TradeDirection,
  symbol?: string,
): boolean {
  const sign = sideSign(direction);
  if (sign == null) return false;
  const spec = symbol ? specFor(symbol) : null;
  const entryTicks = spec ? toTicks(entryPrice, symbol!) : null;
  const stopTicks = spec ? toTicks(stopPrice, symbol!) : null;
  if (entryTicks != null && stopTicks != null) {
    return (stopTicks - entryTicks) * sign >= 0;
  }
  return (stopPrice - entryPrice) * sign >= 0;
}

/**
 * Check whether any stop movement in the trade widened risk.
 * Examines stated stop moves if present; otherwise inspects legacy initial-to-current stop difference.
 */
export function hasWidenedStop(
  trade: Pick<TradeRecord, "direction" | "entry_price"> &
    Partial<Pick<TradeRecord, "symbol" | "initial_stop_price" | "stop_loss_price" | "stop_moves">>,
): boolean {
  const moves = trade.stop_moves;
  if (moves && moves.length > 0) {
    let current = trade.initial_stop_price ?? trade.entry_price;
    for (const move of moves) {
      if (isStopMoveWidening(current, move.price, trade.direction, trade.symbol)) {
        return true;
      }
      current = move.price;
    }
    return false;
  }
  if (
    trade.initial_stop_price != null &&
    trade.stop_loss_price != null &&
    trade.stop_loss_price !== trade.initial_stop_price
  ) {
    return isStopMoveWidening(trade.initial_stop_price, trade.stop_loss_price, trade.direction, trade.symbol);
  }
  return false;
}

export const MOVED_STOP_TAG = "Moved Stop";

/**
 * Suggest quick tags based on trade execution facts (UX-33: AI suggests, trader decides).
 * If the stop was widened and "Moved Stop" is not yet in quick_tags, suggests ["Moved Stop"].
 * Pure selector: NEVER mutates or auto-applies to trade.quick_tags.
 */
export function suggestedQuickTags(
  trade: Pick<TradeRecord, "direction" | "entry_price" | "quick_tags"> &
    Partial<Pick<TradeRecord, "symbol" | "initial_stop_price" | "stop_loss_price" | "stop_moves">>,
  derived?: { stop_widened?: boolean },
): string[] {
  const widened = derived?.stop_widened ?? hasWidenedStop(trade);
  const suggestions: string[] = [];
  if (widened && !trade.quick_tags.includes(MOVED_STOP_TAG)) {
    suggestions.push(MOVED_STOP_TAG);
  }
  return suggestions;
}

/**
 * Trader-initiated action to accept a suggested tag into quick_tags (UX-33).
 */
export function acceptSuggestedTagPatch(
  trade: Pick<TradeRecord, "quick_tags">,
  tag: string,
): Pick<TradeRecord, "quick_tags"> {
  if (trade.quick_tags.includes(tag)) {
    return { quick_tags: [...trade.quick_tags] };
  }
  return { quick_tags: [...trade.quick_tags, tag] };
}

/**
 * The patch for adding a stated stop move (price + time) to a trade (docs/15 §3, issue #36 G2, R-10).
 * - If no stop existed before, freezes this stop as initial_stop_price (R-10).
 * - If an initial stop already exists, keeps initial_stop_price frozen and updates stop_loss_price
 *   and appends the move to stop_moves.
 */
export function addStopMovePatch(
  trade: Pick<TradeRecord, "initial_stop_price" | "stop_loss_price"> &
    Partial<Pick<TradeRecord, "stop_moves">>,
  price: number,
  moveTime: string,
): Pick<TradeRecord, "stop_loss_price" | "stop_moves"> &
  Partial<Pick<TradeRecord, "initial_stop_price" | "initial_stop_set_at">> {
  const newMove: StopMove = { price, time: moveTime };
  const moves = sanitizeStopMoves([...(trade.stop_moves ?? []), newMove]);

  if (trade.initial_stop_price == null) {
    return {
      stop_loss_price: price,
      initial_stop_price: price,
      initial_stop_set_at: moveTime,
      stop_moves: moves,
    };
  }

  return {
    stop_loss_price: price,
    stop_moves: moves,
  };
}

/**
 * The patch for removing a stated stop move by index.
 * Reverts stop_loss_price to the previous stop move or to initial_stop_price.
 * Keeps initial_stop_price frozen (R-10).
 */
export function removeStopMovePatch(
  trade: Pick<TradeRecord, "initial_stop_price"> &
    Partial<Pick<TradeRecord, "stop_moves">>,
  index: number,
): Pick<TradeRecord, "stop_loss_price" | "stop_moves"> {
  const currentMoves = trade.stop_moves ?? [];
  const nextMoves = currentMoves.filter((_, i) => i !== index);
  const lastMove = nextMoves.at(-1);
  const nextStop = lastMove ? lastMove.price : trade.initial_stop_price;
  return {
    stop_loss_price: nextStop ?? null,
    stop_moves: nextMoves,
  };
}

/**
 * The patch for updating a stated stop move row by index.
 * Keeps initial_stop_price frozen (R-10).
 */
export function updateStopMovePatch(
  trade: Pick<TradeRecord, "initial_stop_price"> &
    Partial<Pick<TradeRecord, "stop_moves">>,
  index: number,
  updated: StopMove,
): Pick<TradeRecord, "stop_loss_price" | "stop_moves"> {
  const currentMoves = [...(trade.stop_moves ?? [])];
  if (index >= 0 && index < currentMoves.length) {
    currentMoves[index] = updated;
  }
  const moves = sanitizeStopMoves(currentMoves);
  const lastMove = moves.at(-1);
  const nextStop = lastMove ? lastMove.price : trade.initial_stop_price;
  return {
    stop_loss_price: nextStop ?? null,
    stop_moves: moves,
  };
}

/**
 * Replace all stop moves on a trade with a new list of moves.
 * Updates stop_loss_price to the last move's price (or initial_stop_price if empty).
 * Keeps initial_stop_price frozen (R-10).
 */
export function recordStopMovesPatch(
  trade: Pick<TradeRecord, "initial_stop_price">,
  moves: StopMove[],
): Pick<TradeRecord, "stop_loss_price" | "stop_moves"> {
  const sanitized = sanitizeStopMoves(moves);
  const lastMove = sanitized.at(-1);
  const nextStop = lastMove ? lastMove.price : trade.initial_stop_price;
  return {
    stop_loss_price: nextStop ?? null,
    stop_moves: sanitized,
  };
}

/** A trade with both exit fields set. The chart draws only these until R-03c. */
export type ClosedTradeRecord = TradeRecord & { status: "closed"; exit_time: string; exit_price: number };

/** Narrow to a closed trade: both exit fields present. */
export function isClosed(trade: TradeRecord): trade is ClosedTradeRecord {
  return trade.status === "closed" && trade.exit_time != null && trade.exit_price != null;
}

/** True while the trade has no exit (R-03). */
export function isOpen(trade: Pick<TradeRecord, "exit_time"> & Partial<Pick<TradeRecord, "status">>) {
  return trade.status === "open" || trade.exit_time == null;
}

/** Seconds held. An open trade is measured up to `now`. */
export function holdSeconds(trade: Pick<TradeRecord, "entry_time" | "exit_time">, now = Date.now()) {
  const exit = trade.exit_time == null ? now : Date.parse(trade.exit_time);
  return Math.max(1, Math.round((exit - Date.parse(trade.entry_time)) / 1000));
}

/** Style from the hold. An open trade (null exit) is classified by its hold so far, up to `now`. */
export function classifyTrade(entry: string, exit: string | null, now = Date.now()): TradeStyle {
  const elapsedMs = (exit == null ? now : Date.parse(exit)) - Date.parse(entry);
  if (elapsedMs < 15 * 60 * 1000) return "scalp";
  if (elapsedMs <= 2 * 60 * 60 * 1000) return "session_90m";
  return "investment";
}

/** Pick an initial timeframe that puts ordinary intraday holds in roughly 8–40 trade bars. */
export function defaultTimeframe(holdDurationSeconds: number): Timeframe {
  if (holdDurationSeconds <= 40 * 60) return "1m";
  if (holdDurationSeconds <= 3 * 60 * 60) return "5m";
  if (holdDurationSeconds <= 10 * 60 * 60) return "15m";
  return "1h";
}

export function aggregateCandles(candles: Candle[], timeframe: Timeframe): Candle[] {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  if (minutes === 1) return candles;
  const bucketMs = minutes * 60_000;
  const result: Candle[] = [];
  for (const bar of candles) {
    const time = Math.floor(bar.time / bucketMs) * bucketMs;
    const current = result.at(-1);
    if (!current || current.time !== time) result.push({ ...bar, time });
    else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return result;
}

/**
 * How an instant lines up with the available bars (issue #51).
 * - `containing`: the bar that contains the instant exists.
 * - `nearby`: that bar is missing, but another bar opens within the tolerance below.
 * - `unresolved`: no bar is close enough. Callers treat this as missing, never as a bar far away.
 */
export type BarAlignment =
  | { kind: "containing"; barTime: number }
  | { kind: "nearby"; barTime: number; gapMs: number }
  | { kind: "unresolved" };

/**
 * Nearby tolerance: up to three bars, and never more than 30 minutes of clock time. The cap is
 * what keeps a snap from crossing a weekend, holiday or multi-hour gap, so a fill from Monday
 * cannot land on Friday's last candle. It is a clock cap, not an exchange calendar.
 */
export const NEARBY_BAR_TOLERANCE_BARS = 3;
export const NEARBY_BAR_TOLERANCE_MS = 30 * 60_000;

/**
 * Align `instant` (UTC ms) to the sorted bar open `times`. Exact containment wins. Otherwise the
 * nearest bar counts only within the tolerance; ties go to the earlier bar.
 */
export function alignToBar(times: readonly number[], instant: number, timeframe: Timeframe): BarAlignment {
  if (!times.length || !Number.isFinite(instant)) return { kind: "unresolved" };
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const open = Math.floor(instant / barMs) * barMs;
  // Lower bound: the first index whose bar opens at or after `open`.
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < open) lo = mid + 1;
    else hi = mid;
  }
  if (lo < times.length && times[lo] === open) return { kind: "containing", barTime: open };
  const before = lo > 0 ? times[lo - 1] : undefined;
  const after = lo < times.length ? times[lo] : undefined;
  let nearest: number | undefined;
  if (before !== undefined && after !== undefined) nearest = Math.abs(before - open) <= Math.abs(after - open) ? before : after;
  else nearest = before ?? after;
  if (nearest === undefined) return { kind: "unresolved" };
  const gapMs = Math.abs(nearest - open);
  const toleranceMs = Math.min(NEARBY_BAR_TOLERANCE_BARS * barMs, NEARBY_BAR_TOLERANCE_MS);
  return gapMs <= toleranceMs ? { kind: "nearby", barTime: nearest, gapMs } : { kind: "unresolved" };
}

/** Open time of the bar that contains `instant` or a nearby bar within tolerance (B-23). Null when unresolved (issue #51). */
export function snapToBar(times: number[], instant: number, timeframe: Timeframe): number | null {
  const alignment = alignToBar(times, instant, timeframe);
  return alignment.kind === "unresolved" ? null : alignment.barTime;
}

export interface TradeBarAlignment {
  entryBar: number;
  exitBar: number;
  /** True when entry or exit was snapped to a nearby bar rather than a containing bar (issue #64 / OD-28). */
  approximate: boolean;
}

/**
 * Align both entry and exit timestamps to bars.
 * Returns null when either fill is unresolved (farther than tolerance).
 * `approximate` is true when either fill was aligned to a nearby bar instead of a containing bar.
 */
export function alignTradeToBars(
  times: number[],
  entryTime: string | number,
  exitTime: string | number,
  timeframe: Timeframe,
): TradeBarAlignment | null {
  const entryMs = typeof entryTime === "string" ? Date.parse(entryTime) : entryTime;
  const exitMs = typeof exitTime === "string" ? Date.parse(exitTime) : exitTime;
  if (!Number.isFinite(entryMs) || !Number.isFinite(exitMs)) return null;
  const entryAlign = alignToBar(times, entryMs, timeframe);
  const exitAlign = alignToBar(times, exitMs, timeframe);
  if (entryAlign.kind === "unresolved" || exitAlign.kind === "unresolved") {
    return null;
  }
  return {
    entryBar: entryAlign.barTime,
    exitBar: exitAlign.barTime,
    approximate: entryAlign.kind === "nearby" || exitAlign.kind === "nearby",
  };
}

export interface FittedWindow {
  /** UTC milliseconds. */
  start: number;
  /** UTC milliseconds. */
  end: number;
  beforeBars: number;
  holdBars: number;
  afterBars: number;
  visibleBars: number;
}

/**
 * Fit a trade from its own duration: 30% of the view before entry, 50% in the
 * trade, and 20% after exit. This is continuous; stored style never affects it.
 */
export function fitWindow(entryTime: string, exitTime: string, timeframe: Timeframe, minimumBars = MIN_FITTED_BARS): FittedWindow {
  const entry = Date.parse(entryTime);
  const holdMs = Math.max(1000, Date.parse(exitTime) - entry);
  const barMs = TIMEFRAME_MINUTES[timeframe] * 60_000;
  const holdBars = holdMs / barMs;
  const visibleBars = Math.max(holdBars * 2, minimumBars);
  const contextBars = visibleBars - holdBars;
  const beforeBars = contextBars * 0.6;
  const afterBars = contextBars * 0.4;
  return {
    start: entry - beforeBars * barMs,
    end: entry + holdMs + afterBars * barMs,
    beforeBars,
    holdBars,
    afterBars,
    visibleBars,
  };
}

/** Number of bars a logical range covers. Lightweight Charts uses `to - from` as the visible width. */
export function visibleLogicalBars(range: { from: number; to: number }): number {
  return Math.max(0, range.to - range.from);
}

/**
 * Opening chart range: the standard trade window (`fitWindow`), with modest
 * lead-in and after-exit context, at `max(45, the trade's own window)`.
 * No extra zoom-out multiplier. Clamped to the loaded candles. The range width
 * is `to - from`; to show every loaded bar, `to` is `barCount` (not `barCount - 1`),
 * so 45 loaded candles still yield 45 visible bars.
 */
export function defaultVisibleRange(
  baseFitRange: { from: number; to: number },
  barCount: number,
  minBars = MIN_FITTED_BARS,
): { from: number; to: number } {
  const fittedBars = Math.max(1, visibleLogicalBars(baseFitRange));
  const targetBars = Math.max(minBars, fittedBars);
  const maxTo = Math.max(0, barCount);

  if (barCount <= targetBars) {
    return { from: 0, to: maxTo };
  }

  const extraBars = targetBars - fittedBars;
  const extraBefore = Math.round(extraBars * 0.6);
  const extraAfter = extraBars - extraBefore;

  let from = baseFitRange.from - extraBefore;
  let to = baseFitRange.to + extraAfter;

  if (from < 0) {
    to = Math.min(maxTo, to - from);
    from = 0;
  }
  if (to > maxTo) {
    from = Math.max(0, from - (to - maxTo));
    to = maxTo;
  }

  if (visibleLogicalBars({ from, to }) < minBars && barCount >= minBars) {
    if (from === 0) {
      to = Math.min(maxTo, minBars);
    } else if (to === maxTo) {
      from = Math.max(0, maxTo - minBars);
    } else {
      to = Math.min(maxTo, from + minBars);
    }
  }

  return { from, to };
}

export type ExcursionCoverage = "complete" | "partial";

export interface Excursions {
  /** Worst price against the position during the hold. */
  maePrice: number;
  /** Best price in favour of the position during the hold. */
  mfePrice: number;
  /**
   * `complete` when every expected fully-inside bar is present and contiguous.
   * `partial` when at least two inside bars exist but the hold has gaps.
   * Unavailable (fewer than two inside bars) is represented by a null return.
   */
  coverage: ExcursionCoverage;
}

/**
 * MAE and MFE from bars that are fully inside the hold.
 *
 * A candle establishes its OHLC, not the order of its prices or the timing of a
 * fill inside that candle (issue #47). Fill timing comes from the execution
 * timestamps: a bar is counted only when `bar.time >= entry` and
 * `bar.time + barMs <= exit`. Matching the fill price to the bar's open or
 * close is never used as evidence that the fill happened at that instant.
 *
 * When fewer than two fully-inside bars exist, this returns null so callers
 * can show "—". When two or more exist but an expected bar is missing, the
 * result is still computed from what is present and marked `coverage: "partial"`
 * so the UI can show ≈ / partial rather than a complete measurement.
 */
export function excursions(
  trade: Pick<TradeRecord, "direction" | "entry_time" | "exit_time" | "entry_price"> & Partial<Pick<TradeRecord, "exit_price" | "symbol">>,
  candles: Candle[],
  barMinutes = 1,
): Excursions | null {
  // An open trade has no exit to measure up to (R-03); its excursions are not a result yet.
  if (trade.exit_time == null) return null;
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit <= entry || barMinutes <= 0) return null;
  const barMs = barMinutes * 60_000;
  const expected = insideBarTimes(entry, exit, barMs, trade.symbol);
  const entryBarTime = Math.floor(entry / barMs) * barMs;

  const byTime = new Map<number, Candle>();
  for (const bar of candles) {
    if (bar.time > entryBarTime && bar.time + barMs <= exit && !byTime.has(bar.time)) byTime.set(bar.time, bar);
  }
  const complete = expected.flatMap((time) => {
    const bar = byTime.get(time);
    return bar ? [bar] : [];
  });
  const coverage: ExcursionCoverage = complete.length === expected.length ? "complete" : "partial";
  const fillPrices = trade.exit_price == null ? [trade.entry_price] : [trade.entry_price, trade.exit_price];
  return excursionsFromBars(trade.direction, complete, fillPrices, coverage);
}

/** Measure excursions from fully inside bars and known execution prices. */
export function excursionsFromBars(
  direction: TradeDirection,
  complete: Candle[],
  fillPrices: number[],
  coverage: ExcursionCoverage,
): Excursions | null {
  if (complete.length < 2 || !fillPrices.length) return null;
  let high = fillPrices[0];
  let low = fillPrices[0];
  for (const price of fillPrices) {
    high = Math.max(high, price);
    low = Math.min(low, price);
  }
  for (const bar of complete) {
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
  }

  return direction === "LONG" ? { maePrice: low, mfePrice: high, coverage } : { maePrice: high, mfePrice: low, coverage };
}

/**
 * Planned reward ÷ initial risk (shown as `R:R`), or null without a stop and target, or when the stop or
 * target is on the wrong side (or at the entry) (issue #50, #63).
 */
export function plannedRewardRisk(trade: Priced & Pick<TradeRecord, "stop_loss_price" | "planned_target_price"> & Stops): number | null {
  if (trade.planned_target_price == null || !isWholeQuantity(trade.quantity)) return null;
  const riskTicks = stopRiskTicks(trade);
  const sign = sideSign(trade.direction);
  const entry = toTicks(trade.entry_price, trade.symbol);
  const target = toTicks(trade.planned_target_price, trade.symbol);
  if (riskTicks == null || sign == null || entry == null || target == null) return null;
  const rewardTicks = (target - entry) * sign;
  if (rewardTicks <= 0) return null;
  return rewardTicks / riskTicks;
}

/**
 * A scratch is a result within 0.1R or 2 ticks of the entry, whichever is larger.
 * Without a valid stop, the threshold is 2 ticks. A trade that cannot be priced or
 * has invalid quantity is never a scratch (issue #63).
 */
export function isScratch(trade: Priced & Stops) {
  const captured = tradeTicks(trade);
  if (captured == null) return false;
  const riskTicks = stopRiskTicks(trade) ?? 0;
  const threshold = Math.max(riskTicks > 0 ? 0.1 * riskTicks : 0, 2);
  return Math.abs(captured) <= threshold;
}

/** Exit flag text: TP or SL when the exit price equals that planned level, otherwise none. */
export function exitFlagReason(trade: Pick<TradeRecord, "symbol" | "exit_price" | "stop_loss_price" | "planned_target_price">): "TP" | "SL" | null {
  if (trade.exit_price == null) return null;
  const exit = toTicks(trade.exit_price, trade.symbol);
  if (exit == null) return null;
  if (trade.planned_target_price != null && exit === toTicks(trade.planned_target_price, trade.symbol)) return "TP";
  if (trade.stop_loss_price != null && exit === toTicks(trade.stop_loss_price, trade.symbol)) return "SL";
  return null;
}

/** ~`points` closes from just before the entry to just after the exit. */
export function buildSparkline(trade: Pick<TradeRecord, "entry_time" | "exit_time">, candles: Candle[], points = 40) {
  // An open trade has no exit to frame yet; its thumbnail comes with R-03c.
  if (trade.exit_time == null) return [];
  const entry = Date.parse(trade.entry_time);
  const exit = Date.parse(trade.exit_time);
  const pad = Math.max(10 * 60_000, (exit - entry) * 0.6);
  const window = candles.filter((bar) => bar.time >= entry - pad && bar.time <= exit + pad);
  if (window.length < 2) return [];
  const step = Math.max(1, window.length / points);
  const result: number[] = [];
  for (let index = 0; index < window.length; index += step) result.push(window[Math.floor(index)].close);
  const last = window[window.length - 1].close;
  if (result[result.length - 1] !== last) result.push(last);
  return result;
}

export const DEFAULT_TICK_TOLERANCE_TICKS = 4;

/** Whether a fill price sits inside its bar, with a tolerance in ticks (B-12).
 * A missing bar is not a pass: return false so callers do not treat absence as alignment (issue #60).
 */
export function fillInsideBar(priceValue: number, bar: Candle | undefined, symbol: string, toleranceTicks = DEFAULT_TICK_TOLERANCE_TICKS) {
  if (!bar) return false;
  const tickSize = specFor(symbol)?.tickSize ?? 0;
  const fillTicks = toTicks(priceValue, symbol);
  if (fillTicks != null && Number.isInteger(toleranceTicks)) {
    // Keep off-grid bar prices on the conservative side of each tick boundary.
    const lowTicks = toTicks(bar.low, symbol) ?? Math.ceil(bar.low / tickSize);
    const highTicks = toTicks(bar.high, symbol) ?? Math.floor(bar.high / tickSize);
    return fillTicks >= lowTicks - toleranceTicks && fillTicks <= highTicks + toleranceTicks;
  }
  const tolerance = tickSize * toleranceTicks;
  return priceValue >= bar.low - tolerance && priceValue <= bar.high + tolerance;
}

/** Share of checklist rules followed, or null when the trade has no checklist (UX-51). */
export function adherence(trade: Pick<TradeRecord, "checklist_state">) {
  const total = trade.checklist_state.length;
  if (!total) return null;
  const followed = trade.checklist_state.filter((item) => item.checked).length;
  return { followed, total, ratio: followed / total };
}

/** `new`: nothing captured. `tagged`: a playbook, tags, notes, checklist or blind review. `reviewed` is set by the trader. */
export function deriveReviewStatus(
  trade: Pick<TradeRecord, "review_status"> &
    Partial<
      Pick<
        TradeRecord,
        | "playbook_id"
        | "quick_tags"
        | "note"
        | "pre_trade_thesis"
        | "management_notes"
        | "post_exit_notes"
        | "checklist_state"
        | "take_again"
      >
    >,
): ReviewStatus {
  if (trade.review_status === "reviewed") return "reviewed";
  const hasEvidence = Boolean(
    trade.playbook_id ||
      trade.quick_tags?.length ||
      trade.note?.trim() ||
      trade.pre_trade_thesis?.trim() ||
      trade.management_notes?.trim() ||
      trade.post_exit_notes?.trim() ||
      trade.checklist_state?.length ||
      trade.take_again != null,
  );
  return hasEvidence ? "tagged" : "new";
}

export function candleCacheKey(trade: Pick<TradeRecord, "id" | "symbol"> & Partial<Pick<TradeRecord, "yahoo_ticker">>) {
  const ticker = specFor(trade.symbol)?.yahooTicker || trade.yahoo_ticker || trade.symbol;
  return `${trade.id}:${ticker}`;
}

export function candleSignature(trade: Pick<TradeRecord, "symbol" | "entry_time" | "exit_time"> & Partial<Pick<TradeRecord, "yahoo_ticker">>) {
  const ticker = specFor(trade.symbol)?.yahooTicker || trade.yahoo_ticker || trade.symbol;
  // `open` in place of the exit, so closing the trade changes the signature and reloads candles (R-03).
  return `${trade.symbol}|${ticker}|${trade.entry_time}|${trade.exit_time ?? "open"}`;
}

/**
 * Stable text for the trader-written annotations (issue #62). Two records with the same key show the
 * same notes, tags, playbook and checklist ticks. Checklist rows compare by id, label and checked state.
 */
export function annotationKey(trade: Partial<Pick<TradeRecord, "note" | "quick_tags" | "checklist_state" | "playbook_id" | "pre_trade_thesis" | "management_notes" | "post_exit_notes">>) {
  return JSON.stringify([
    trade.note ?? "",
    trade.quick_tags ?? [],
    (trade.checklist_state ?? []).map((item) => [item.id, item.label, item.checked === true]),
    trade.playbook_id ?? null,
    trade.pre_trade_thesis ?? "",
    trade.management_notes ?? "",
    trade.post_exit_notes ?? "",
  ]);
}

/**
 * Fill in fields added after a record was stored, so old device data keeps loading. A record with no
 * `status` is `closed` (every record saved before R-03 has an exit). Throws when the status and the exit
 * fields disagree: `open` ⇔ `exit_time === null` ⇔ `exit_price === null`.
 */
export function normalizeTrade(raw: Partial<TradeRecord> & Pick<TradeRecord, "id" | "symbol" | "direction" | "entry_time" | "exit_time" | "entry_price" | "exit_price">): TradeRecord {
  const status: TradeStatus = raw.status ?? "closed";
  if (status !== "open" && status !== "closed") throw new Error(`Trade ${raw.id}: unknown status`);
  const noExitTime = raw.exit_time == null;
  const noExitPrice = raw.exit_price == null;
  if (status === "open" ? !(noExitTime && noExitPrice) : (noExitTime || noExitPrice)) {
    throw new Error(`Trade ${raw.id}: status ${status} does not match its exit fields`);
  }
  const isSample = raw.is_sample === true;
  const validSource = raw.candle_source === "Yahoo Finance" || (raw.candle_source === "Demo fixture" && isSample);
  const hadNonMarketCandles = raw.candle_source != null && !validSource;
  // `mes` and `MES` share one spec. An unknown symbol is kept as typed, and its money shows as null.
  const symbol = canonicalSymbol(raw.symbol) ?? raw.symbol;
  const canonicalTicker = specFor(symbol)?.yahooTicker;
  const trade: TradeRecord = {
    user_id: DEFAULT_OWNER_USER_ID,
    account_id: null,
    yahoo_ticker: canonicalTicker || raw.yahoo_ticker || symbol,
    trade_style: classifyTrade(raw.entry_time, raw.exit_time),
    stop_loss_price: null,
    initial_stop_price: null,
    initial_stop_set_at: null,
    planned_target_price: null,
    key_level_price: null,
    quantity: 1,
    note: "",
    review_status: "new",
    playbook_id: null,
    quick_tags: [],
    checklist_state: [],
    pre_trade_thesis: "",
    management_notes: "",
    post_exit_notes: "",
    flagged: false,
    take_again: null,
    take_again_at: null,
    is_sample: false,
    sparkline: [],
    exit_reason: null,
    ...raw,
    status,
  };
  trade.symbol = symbol;
  if (canonicalTicker) trade.yahoo_ticker = canonicalTicker;
  // Only a missing quantity defaults to 1. A stored 0 or 1.5 stays visible, and its money reads as null.
  if (trade.quantity == null) trade.quantity = 1;
  if (trade.account_id === undefined) trade.account_id = null;
  trade.exit_reason = status === "open" ? null : isExitReason(raw.exit_reason) ? raw.exit_reason : null;
  if (raw.stop_moves !== undefined) {
    trade.stop_moves = sanitizeStopMoves(raw.stop_moves);
  }
  if (!validSource) trade.candle_source = undefined;
  if (hadNonMarketCandles) trade.sparkline = [];
  // R size (04 §3.3): a stored value survives only when it is a valid whole-cent amount. risk_cents is always recomputed.
  trade.r_size_cents = isValidRSizeCents(raw.r_size_cents) ? raw.r_size_cents : null;
  trade.stated_risk_r = isValidStatedRiskR(raw.stated_risk_r) ? Number(raw.stated_risk_r.toFixed(2)) : null;
  trade.risk_cents = riskCents(trade);
  trade.review_status = deriveReviewStatus(trade);
  return trade;
}

export type TradeInputField = "symbol" | "quantity" | "entry_price" | "exit_price" | "stop_loss_price" | "planned_target_price" | "key_level_price";
export type TradeInputErrors = Partial<Record<TradeInputField, string>>;

export interface TradeExecutionInput {
  symbol: string;
  direction: TradeDirection;
  quantity: number;
  /** NaN means the field is empty or not a number. */
  entry_price: number;
  /** NaN means empty. `null` means the trade is still open, so there is no exit to check (R-03). */
  exit_price: number | null;
  stop_loss_price: number | null;
  planned_target_price: number | null;
  key_level_price: number | null;
}

const PRICE_NAMES: Record<Exclude<TradeInputField, "symbol" | "quantity">, string> = {
  entry_price: "Entry price",
  exit_price: "Exit price",
  stop_loss_price: "Stop",
  planned_target_price: "Target",
  key_level_price: "Key level",
};

/**
 * Check an execution before it is saved (issue #50). Returns no entries for a trade the money
 * functions can price. Nothing is rounded: an off-tick price is an error, so the trader sees the exact
 * number they typed or the importer kept. Times are checked by the caller, which owns the time zone.
 */
export function validateTradeInput(input: TradeExecutionInput): TradeInputErrors {
  const errors: TradeInputErrors = {};
  const spec = specFor(input.symbol);
  if (!spec) errors.symbol = `${input.symbol} is not a supported contract`;
  if (!isWholeQuantity(input.quantity)) errors.quantity = "Enter a whole number of contracts, 1 or more";

  const priceError = (field: keyof typeof PRICE_NAMES, value: number): string | undefined => {
    const name = PRICE_NAMES[field];
    if (!Number.isFinite(value)) return `Enter the ${name.toLowerCase()}`;
    if (spec && toTicks(value, input.symbol) == null) return `${name} must sit on a ${spec.tickSize} tick for ${canonicalSymbol(input.symbol)}`;
    return undefined;
  };
  const entryError = priceError("entry_price", input.entry_price);
  const exitError = input.exit_price == null ? undefined : priceError("exit_price", input.exit_price);
  if (entryError) errors.entry_price = entryError;
  if (exitError) errors.exit_price = exitError;

  const sign = sideSign(input.direction);
  const entry = input.entry_price;
  if (input.stop_loss_price != null) {
    const stopError = priceError("stop_loss_price", input.stop_loss_price);
    if (stopError) errors.stop_loss_price = stopError;
    else if (sign != null && Number.isFinite(entry) && (input.stop_loss_price - entry) * sign >= 0) {
      errors.stop_loss_price = input.direction === "LONG" ? "A long's stop sits below the entry" : "A short's stop sits above the entry";
    }
  }
  if (input.planned_target_price != null) {
    const targetError = priceError("planned_target_price", input.planned_target_price);
    if (targetError) errors.planned_target_price = targetError;
    else if (sign != null && Number.isFinite(entry) && (input.planned_target_price - entry) * sign <= 0) {
      errors.planned_target_price = input.direction === "LONG" ? "A long's target sits above the entry" : "A short's target sits below the entry";
    }
  }
  if (input.key_level_price != null) {
    const keyError = priceError("key_level_price", input.key_level_price);
    if (keyError) errors.key_level_price = keyError;
  }
  return errors;
}

export type CloseTradeErrors = Partial<Record<"exit_time" | "exit_price", string>>;

/**
 * Check the exit typed to close an open trade (R-03b). Same price rules as the entry form
 * (`validateTradeInput`), and the exit must come after the entry. `exitPrice` null means empty.
 */
export function validateClose(
  trade: Pick<TradeRecord, "symbol" | "direction" | "quantity" | "entry_time" | "entry_price">,
  exitTime: Date,
  exitPrice: number | null,
): CloseTradeErrors {
  const errors: CloseTradeErrors = {};
  const priceErrors = validateTradeInput({
    symbol: trade.symbol, direction: trade.direction, quantity: trade.quantity,
    entry_price: trade.entry_price, exit_price: exitPrice ?? Number.NaN,
    stop_loss_price: null, planned_target_price: null, key_level_price: null,
  });
  if (exitPrice == null || !(exitPrice > 0)) errors.exit_price = "Enter the exit price";
  else if (priceErrors.exit_price) errors.exit_price = priceErrors.exit_price;
  if (Number.isNaN(exitTime.getTime())) errors.exit_time = "Enter the exit time";
  else if (exitTime.getTime() <= Date.parse(trade.entry_time)) errors.exit_time = "The exit must be after the entry";
  return errors;
}

/** The patch that closes an open trade: status, both exit fields, optional exit reason, and the style from the real hold (R-03b, G1). */
export function closeTradePatch(
  trade: Pick<TradeRecord, "entry_time">,
  exitTime: string,
  exitPrice: number,
  exitReason?: TradeExitReason | null,
): Pick<TradeRecord, "status" | "exit_time" | "exit_price" | "trade_style"> & Partial<Pick<TradeRecord, "exit_reason">> {
  const patch: Pick<TradeRecord, "status" | "exit_time" | "exit_price" | "trade_style"> & Partial<Pick<TradeRecord, "exit_reason">> = {
    status: "closed",
    exit_time: exitTime,
    exit_price: exitPrice,
    trade_style: classifyTrade(trade.entry_time, exitTime),
  };
  if (exitReason !== undefined) {
    patch.exit_reason = exitReason;
  }
  return patch;
}

/** Tags that record a broken process, whatever the trade made. */
export const VIOLATION_TAGS = ["Chased Entry", "Moved Stop", "Revenge"];

/** How the trade was executed: `clean` (every rule followed, no violation), `broken`, or unknown. */
export function processRead(trade: Pick<TradeRecord, "checklist_state" | "quick_tags">): "clean" | "broken" | null {
  const score = adherence(trade);
  const violated = trade.quick_tags.some((tag) => VIOLATION_TAGS.includes(tag));
  if (violated || (score && score.followed < score.total)) return "broken";
  return score ? "clean" : null;
}
