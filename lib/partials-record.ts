// Partial exits and partial targets stored on a TradeRecord (issue #38, docs/26 §4, docs/15 §2.3–2.4 & §3.6).
// Pure: no I/O. Sanitizers keep shape-valid items only; `validateTradePartials` enforces the trade-level rules
// (ticks, sides, times, quantities) that the command layer refuses with `invalid`.
// Money runs through `calculatePartials` in integer ticks and cents (Guardrail 4).

import { isWholeQuantity, riskStopPrice, toTicks } from "./trades.ts";
import type { TradeRecord } from "./trades.ts";
import { calculatePartials } from "./partials.ts";
import type { PartialExit, PartialTarget } from "./partials.ts";

export type { PartialExit, PartialTarget } from "./partials.ts";

type Loose = Record<string, unknown>;

const isObject = (raw: unknown): raw is Loose => !!raw && typeof raw === "object" && !Array.isArray(raw);
const isTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isPrice = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isQty = (value: unknown): value is number => typeof value === "number" && isWholeQuantity(value);

const isExitLike = (raw: unknown): raw is Loose & PartialExit =>
  isObject(raw) && isTime(raw.time) && isPrice(raw.price) && isQty(raw.qty);

const isTargetLike = (raw: unknown): raw is Loose & PartialTarget =>
  isObject(raw) && typeof raw.key === "string" && raw.key.trim() !== "" && isPrice(raw.price) && isQty(raw.qty);

/** One partial exit with only the optional fields that are present and well typed. Null when the core fields fail. */
function exitLeg(raw: unknown): PartialExit | null {
  if (!isExitLike(raw)) return null;
  const leg: PartialExit = { time: raw.time, price: raw.price, qty: raw.qty };
  if (typeof raw.id === "string") leg.id = raw.id;
  if (typeof raw.seq === "number") leg.seq = raw.seq;
  if (typeof raw.reason === "string") leg.reason = raw.reason;
  if (typeof raw.targetKey === "string") leg.targetKey = raw.targetKey;
  if (typeof raw.orderId === "string") leg.orderId = raw.orderId;
  return leg;
}

/**
 * Valid partial exits, sorted ascending by time. Undefined when none are valid, so a single-lot trade
 * keeps no `partial_exits` key at all. The symbol is accepted for signature parity with the other sanitizers.
 */
export function sanitizePartialExits(raw: unknown, _symbol: string): PartialExit[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const legs = raw.map(exitLeg).filter((leg): leg is PartialExit => leg !== null);
  if (legs.length === 0) return undefined;
  return legs.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Valid partial targets in their stored order. Undefined when none are valid. */
export function sanitizePartialTargets(raw: unknown, _symbol: string): PartialTarget[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const targets: PartialTarget[] = [];
  for (const item of raw) {
    if (isTargetLike(item)) targets.push({ key: item.key, price: item.price, qty: item.qty });
  }
  return targets.length > 0 ? targets : undefined;
}

const EXIT_SHAPE_ERROR = "Every partial exit needs a valid time, a finite price and a whole quantity of 1 or more.";
const TARGET_SHAPE_ERROR = "Every partial target needs a key, a finite price and a whole quantity of 1 or more.";

/**
 * The trade-level rules for `partial_exits` and `partial_targets`, or null when they hold. `raw` is the write
 * as sent (malformed items refuse the write, never get dropped); `trade` is the normalized record.
 */
export function validateTradePartials(raw: Loose, trade: TradeRecord): string | null {
  if (raw.partial_exits !== undefined && !(Array.isArray(raw.partial_exits) && raw.partial_exits.every(isExitLike))) {
    return EXIT_SHAPE_ERROR;
  }
  if (raw.partial_targets !== undefined && !(Array.isArray(raw.partial_targets) && raw.partial_targets.every(isTargetLike))) {
    return TARGET_SHAPE_ERROR;
  }
  const exits = trade.partial_exits ?? [];
  const targets = trade.partial_targets ?? [];
  if (exits.some((leg) => toTicks(leg.price, trade.symbol) == null) || targets.some((t) => toTicks(t.price, trade.symbol) == null)) {
    return "Partial exit and target prices must sit on the contract's tick grid.";
  }
  if (new Set(targets.map((t) => t.key)).size !== targets.length) return "Partial target keys must be unique.";
  const sign = trade.direction === "LONG" ? 1 : -1;
  if (targets.some((t) => (t.price - trade.entry_price) * sign <= 0)) {
    return "Partial target prices must sit on the reward side of entry.";
  }
  const entryAt = Date.parse(trade.entry_time);
  const exitAt = trade.status === "closed" && trade.exit_time != null ? Date.parse(trade.exit_time) : null;
  if (exits.some((leg) => Date.parse(leg.time) < entryAt || (exitAt != null && Date.parse(leg.time) > exitAt))) {
    return "Partial exit times must fall between entry and exit.";
  }
  const exitQty = exits.reduce((sum, leg) => sum + leg.qty, 0);
  if (exitQty > trade.quantity) return "Partial exits cannot add up to more than the trade quantity.";
  if (trade.status === "closed" && exits.length > 0 && exitQty !== trade.quantity) {
    return "A closed trade's partial exits must add up to its full quantity.";
  }
  return null;
}

/** The exact multi-lot metrics of a closed trade with partial exits (docs/15 §2.4). */
export interface PartialsTradeMetrics {
  contractTicks: number | null;
  avgTicks: number | null;
  points: number | null;
  pnlUsd: number | null;
  riskMultiple: number | null;
}

/** Only the fields the metrics read. Optional so callers holding a loose trade shape still type-check. */
export type PartialsTradeInput = Pick<TradeRecord, "symbol" | "direction" | "quantity" | "entry_price" | "exit_price"> &
  Partial<Pick<TradeRecord, "entry_time" | "exit_time" | "status" | "initial_stop_price" | "stop_loss_price" | "partial_exits" | "partial_targets">>;

/**
 * Integer-tick metrics across the trade's exit legs, or null when the trade has no partial exits or is still
 * open (an open trade has no realized result). Single-lot trades return null and keep the existing path.
 */
export function partialsTradeMetrics(trade: PartialsTradeInput, rSizeCents?: number): PartialsTradeMetrics | null {
  if (trade.status === "open" || !trade.partial_exits?.length || trade.entry_time == null) return null;
  const summary = calculatePartials({
    symbol: trade.symbol,
    direction: trade.direction,
    entryPrice: trade.entry_price,
    entryTime: trade.entry_time,
    totalQty: trade.quantity,
    initialStopPrice: riskStopPrice(trade as TradeRecord),
    exits: trade.partial_exits,
    targets: trade.partial_targets ?? [],
    rSizeCents,
  });
  return {
    contractTicks: summary.contractTicks,
    avgTicks: summary.avgTicks,
    points: summary.points,
    pnlUsd: summary.pnlUsd,
    riskMultiple: summary.riskMultiple,
  };
}

/**
 * Time-ordered events for a partial trade. `seq` drives `deriveTrade`, so an exit leg must come before a stop move
 * stamped at the same instant (docs/15 §3.6), and moves come before notes. Ties keep their build order.
 */
export function chronologicalSeq<T extends { seq: number; t: string; type: string }>(events: T[]): T[] {
  const rank = (event: T) => (event.type === "fill" || event.type === "plan" ? 0 : event.type === "note" ? 2 : 1);
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => Date.parse(a.event.t) - Date.parse(b.event.t) || rank(a.event) - rank(b.event) || a.index - b.index)
    .map((item, position) => ({ ...item.event, seq: position + 1 }));
}
