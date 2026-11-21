// Trade document (`mogmine.trade.v1`) types, legacy converter, and pure deriver (issue #33, docs/15 §3).
// Pure: no I/O, no candles, no DOM. All money arithmetic runs in integer ticks and cents (B-30, B-31, B-32).

import {
  DEFAULT_OWNER_USER_ID,
  canonicalSymbol,
  isWholeQuantity,
  specFor,
  tickDecimals,
  toTicks,
} from "./trades.ts";
import type {
  ChecklistItem,
  FuturesContractSpec,
  ReviewStatus,
  TradeRecord,
  TradeStyle,
} from "./trades.ts";

export const TRADE_DOC_SCHEMA = "mogmine.trade.v1" as const;

export type EventBasis = "broker" | "stated" | "inferred";
export type TradeDocSide = "long" | "short";
export type TradeDocSourceKind = "manual" | "csv" | "broker";

export interface TradeDocInstrument {
  symbol: string;
  contract: string | null;
}

export interface TradeDocSource {
  kind: TradeDocSourceKind;
  provider: string | null;
  imported_at: string | null;
}

export interface PlanEntry {
  order: "market" | "limit" | "stop";
  price: number;
}

export interface PlanTarget {
  key: string;
  price: number;
  qty: number;
}

export type OrderRole = "entry" | "stop" | "target";
export type OrderKind = "market" | "limit" | "stop" | "trail";
export type FillRole = "entry" | "exit";
export type ExitReason = "target" | "stop" | "trail" | "manual" | "unknown";

export interface TradeEventBase {
  seq: number;
  /** UTC ISO-8601 timestamp. */
  t: string;
  basis: EventBasis;
}

export interface PlanEvent extends TradeEventBase {
  type: "plan";
  qty: number;
  entry: PlanEntry;
  stop: number | null;
  targets: PlanTarget[];
}

export interface OrderEvent extends TradeEventBase {
  type: "order";
  order: string;
  role: OrderRole;
  kind: OrderKind;
  qty: number;
  price: number;
  target?: string;
}

export interface ModifyEvent extends TradeEventBase {
  type: "modify";
  order: string;
  price?: number;
  qty?: number;
}

export interface CancelEvent extends TradeEventBase {
  type: "cancel";
  order: string;
  reason?: string;
}

export interface FillEvent extends TradeEventBase {
  type: "fill";
  order?: string;
  role: FillRole;
  qty: number;
  price: number;
  reason?: ExitReason;
  /** Explicit basis for `reason` when it differs from the fill's own basis (e.g. inferred from legacy price equality). */
  reason_basis?: EventBasis;
  /** Fees in dollars for this execution leg. */
  fees?: number;
}

export interface NoteAnchor {
  t?: string;
  seq?: number;
  section?: "note" | "pre_trade_thesis" | "management_notes" | "post_exit_notes";
}

export interface NoteEvent extends TradeEventBase {
  type: "note";
  text: string;
  anchor?: NoteAnchor;
}

export interface VoidEvent extends TradeEventBase {
  type: "void";
  /** Sequence number of an earlier event (typically a fill) voided by the broker (B-04). */
  ref: number;
}

export type TradeEvent =
  | PlanEvent
  | OrderEvent
  | ModifyEvent
  | CancelEvent
  | FillEvent
  | NoteEvent
  | VoidEvent;

/** Non-layout journal metadata preserved across legacy conversion so `fromLegacy` has zero data loss. */
export interface TradeDocAnnotations {
  account_id: string | null;
  trade_style: TradeStyle;
  key_level_price: number | null;
  review_status: ReviewStatus;
  playbook_id: string | null;
  quick_tags: string[];
  checklist_state: ChecklistItem[];
  flagged: boolean;
  take_again: "yes" | "smaller" | "pass" | null;
  take_again_at: string | null;
}

export interface TradeDocument {
  schema: typeof TRADE_DOC_SCHEMA;
  doc?: string;
  id: string;
  user_id: string;
  revision: number;
  instrument: TradeDocInstrument;
  side: TradeDocSide;
  source: TradeDocSource;
  is_sample: boolean;
  events: TradeEvent[];
  /** Optional derived mood records (carried on some fixtures until OD-30). */
  mood_records?: unknown[];
  /** Optional non-layout journal metadata carried from `TradeRecord`. */
  annotations?: TradeDocAnnotations;
}

export type DerivedTradeStatus = "planned" | "working" | "open" | "closed" | "not_taken";

export type TradeOutcome =
  | "target"
  | "stop"
  | "trail"
  | "scratch"
  | "manual"
  | "partial_targets"
  | "not_taken";

export interface PositionPoint {
  seq: number;
  t: string;
  role: FillRole;
  qty: number;
  price: number;
  position_after: number;
  /** Weighted average entry price of currently open lots after this fill, or null when flat. */
  avg_entry_price: number | null;
  order?: string;
  reason?: ExitReason;
  basis: EventBasis;
  fees_cents: number;
}

export interface ClosedLot {
  entry_seq: number;
  exit_seq: number;
  entry_t: string;
  exit_t: string;
  qty: number;
  entry_price: number;
  exit_price: number;
  ticks_per_contract: number | null;
  contract_ticks: number | null;
  pnl_cents: number | null;
  exit_reason: ExitReason;
  exit_reason_basis: EventBasis;
}

export type StopSegmentEndReason = "modified" | "cancelled" | "filled" | "position_closed" | null;

export interface StopSegment {
  from: string;
  to: string | null;
  from_seq: number;
  to_seq: number | null;
  price: number;
  order: string;
  basis: EventBasis;
  /** True when this step moved the stop away from the entry (widened risk). */
  widened: boolean;
  /** True when this stop sits at or beyond entry on the winning side. */
  locked_profit: boolean;
  end_reason: StopSegmentEndReason;
}

export interface WorkingOrderSegment {
  order: string;
  role: OrderRole;
  kind: OrderKind;
  from: string;
  to: string | null;
  price: number;
  qty: number;
  target?: string;
  basis: EventBasis;
  end_reason: "filled" | "cancelled" | "position_closed" | null;
}

export interface PlannedTargetResult {
  key: string;
  price: number;
  qty: number;
  /** Planned reward / planned risk, or null without a valid plan stop/target. */
  planned_r: number | null;
}

export type DerivedFactCode = "stop_removed_while_open" | "stop_widened" | "exit_past_stop";

export interface DerivedFact {
  code: DerivedFactCode;
  seq: number;
  t: string;
  price: number;
  basis: EventBasis;
  order?: string;
  /** Signed R beyond the initial stop for `exit_past_stop` (e.g. -0.6). */
  extra_r?: number | null;
}

export type StructuralErrorCode =
  | "negative_position"
  | "exit_before_entry"
  | "closed_not_flat"
  | "stop_wrong_side"
  | "target_qty_exceeds_position"
  | "invalid_quantity"
  | "off_tick_price"
  | "unknown_symbol";

export interface StructuralError {
  code: StructuralErrorCode;
  seq: number | null;
  t: string | null;
  price: number | null;
  basis: EventBasis | null;
  message: string;
}

export interface InitialStopInfo {
  price: number;
  t: string;
  seq: number;
  order: string;
  basis: EventBasis;
}

export interface DerivedTrade {
  id: string;
  symbol: string;
  side: TradeDocSide;
  status: DerivedTradeStatus;
  /** Overall outcome for closed or not-taken trades; null while planned, working, or open. */
  outcome: TradeOutcome | null;
  outcome_basis: EventBasis | null;
  /** First entry fill time, or null when never filled. */
  entry_time: string | null;
  /** Final exit fill time when closed, or null otherwise. */
  exit_time: string | null;
  /** Weighted average entry price across all non-voided entry fills, or null. */
  avg_entry_price: number | null;
  /** Weighted average exit price across all non-voided exit fills, or null. */
  avg_exit_price: number | null;
  /** First entry fill price (used for initial risk per B-32). */
  first_entry_price: number | null;
  /** Maximum open position size reached. */
  max_size: number;
  total_entry_qty: number;
  total_exit_qty: number;
  open_qty: number;
  position_timeline: PositionPoint[];
  closed_lots: ClosedLot[];
  /** Signed average ticks captured per closed contract; null unless closed & priceable. */
  ticks: number | null;
  /** Exact integer contract-ticks summed across all FIFO closed lots; null unless closed & priceable. */
  contract_ticks: number | null;
  /** Signed average points captured per closed contract; null unless closed & priceable. */
  points: number | null;
  /** Gross P&L in integer cents; null unless closed & priceable (OD-38, B-30, B-31). */
  pnl_cents: number | null;
  /** Gross P&L in dollars (`pnl_cents / 100`); null unless closed & priceable. */
  pnl_usd: number | null;
  /** Total fees across non-voided fills in integer cents. */
  fees_cents: number;
  /** Total fees in dollars (`fees_cents / 100`). */
  fees_usd: number;
  /** First stop in force at the first entry fill (or bracket stop placed right after entry). */
  initial_stop: InitialStopInfo | null;
  /** Initial risk in integer cents: `|first_entry - initial_stop| * max_size * pointValueUsd` (B-32). Null without valid initial stop. */
  initial_risk_cents: number | null;
  initial_risk_usd: number | null;
  /** Gross R = P&L / initial risk. Null without valid initial stop or when not closed, never 0 (OD-10, B-32). */
  r_multiple: number | null;
  /** True when closed and within 0.1R or 2 ticks of entry, whichever is larger (D-010). */
  is_scratch: boolean;
  /** Stepped stop path built from plan/order/modify/cancel events. */
  stop_path: StopSegment[];
  stop_move_count: number;
  stop_widened: boolean;
  /** Entry and target working-order spans. */
  working_orders: WorkingOrderSegment[];
  /** The plan event if present. */
  plan: PlanEvent | null;
  /** Planned R:R for each target in `plan.targets`. */
  planned_targets: PlannedTargetResult[];
  /** Weighted planned R:R across all targets in `plan.targets`, or null. */
  planned_r: number | null;
  /** Non-error behavioural/execution facts (e.g. `stop_removed_while_open`, `exit_past_stop`). */
  facts: DerivedFact[];
  /** Structural validation errors. Reported, never thrown. */
  errors: StructuralError[];
}

const TICK_TOLERANCE = 1e-6;

function priceToTicks(price: number, spec: FuturesContractSpec | null): number | null {
  if (!spec || !Number.isFinite(price) || spec.tickSize <= 0) return null;
  const ticks = price / spec.tickSize;
  const rounded = Math.round(ticks);
  return Math.abs(ticks - rounded) <= TICK_TOLERANCE ? rounded : null;
}

function tickValueCentsForSpec(spec: FuturesContractSpec | null): number | null {
  if (!spec || !Number.isFinite(spec.tickSize) || !Number.isFinite(spec.pointValueUsd)) return null;
  return Math.round(spec.tickSize * spec.pointValueUsd * 100);
}

function samePrice(a: number, b: number, spec: FuturesContractSpec | null): boolean {
  const ta = priceToTicks(a, spec);
  const tb = priceToTicks(b, spec);
  if (ta != null && tb != null) return ta === tb;
  return a === b;
}

function roundPoints(ticks: number, spec: FuturesContractSpec): number {
  const decimals = tickDecimals(spec.tickSize) + 2;
  return Number((ticks * spec.tickSize).toFixed(decimals));
}

function sideSign(side: TradeDocSide): 1 | -1 {
  return side === "long" ? 1 : -1;
}

function isStopOnWrongSide(entryPrice: number, stopPrice: number, sign: 1 | -1, spec: FuturesContractSpec | null): boolean {
  const entryTicks = priceToTicks(entryPrice, spec);
  const stopTicks = priceToTicks(stopPrice, spec);
  if (entryTicks != null && stopTicks != null) {
    return (entryTicks - stopTicks) * sign <= 0;
  }
  return (entryPrice - stopPrice) * sign <= 0;
}

function isStopWidened(prevPrice: number, nextPrice: number, sign: 1 | -1, spec: FuturesContractSpec | null): boolean {
  const prevTicks = priceToTicks(prevPrice, spec);
  const nextTicks = priceToTicks(nextPrice, spec);
  if (prevTicks != null && nextTicks != null) {
    return (nextTicks - prevTicks) * sign < 0;
  }
  return (nextPrice - prevPrice) * sign < 0;
}

function isStopLockingProfit(entryPrice: number, stopPrice: number, sign: 1 | -1, spec: FuturesContractSpec | null): boolean {
  const entryTicks = priceToTicks(entryPrice, spec);
  const stopTicks = priceToTicks(stopPrice, spec);
  if (entryTicks != null && stopTicks != null) {
    return (stopTicks - entryTicks) * sign >= 0;
  }
  return (stopPrice - entryPrice) * sign >= 0;
}

interface OpenLot {
  seq: number;
  t: string;
  qty: number;
  price: number;
  priceTicks: number | null;
}

interface ActiveStop {
  order: string;
  price: number;
  basis: EventBasis;
  implicit: boolean;
  segmentIndex: number;
}

interface ActiveOrder {
  order: string;
  role: OrderRole;
  kind: OrderKind;
  price: number;
  qty: number;
  target?: string;
  basis: EventBasis;
  segmentIndex: number;
}

/**
 * Pure trade deriver: events -> derived facts (docs/15 §3.3, issue #33).
 *
 * - Never mutates `doc`.
 * - Never throws on structural errors; reports every violation in `errors`.
 * - Computes money strictly from FIFO fills in integer ticks and cents (B-30, B-31).
 * - Measures R against the first stop in force at the first entry fill (or initial bracket stop),
 *   scaled by `max_size` (B-32, OD-10).
 * - Scratch uses the owner rule (D-010): within 0.1R or 2 ticks of entry, whichever is larger.
 */
export function deriveTrade(doc: TradeDocument, spec?: FuturesContractSpec | null): DerivedTrade {
  const resolvedSpec = spec === undefined ? specFor(doc.instrument.symbol) : spec;
  const tickCents = tickValueCentsForSpec(resolvedSpec);
  const sign = sideSign(doc.side);
  const errors: StructuralError[] = [];
  const facts: DerivedFact[] = [];

  if (!resolvedSpec) {
    errors.push({
      code: "unknown_symbol",
      seq: null,
      t: null,
      price: null,
      basis: null,
      message: `${doc.instrument.symbol} is not a supported contract`,
    });
  }

  // Sort a copy by seq (stable tie-breaker on original index).
  const ordered = doc.events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (a.event.seq !== b.event.seq ? a.event.seq - b.event.seq : a.index - b.index))
    .map((item) => item.event);

  // Collect voided seq numbers (B-04).
  const voidedSeqs = new Set<number>();
  for (const event of ordered) {
    if (event.type === "void") voidedSeqs.add(event.ref);
  }
  const activeEvents = ordered.filter((event) => event.type !== "void" && !voidedSeqs.has(event.seq));

  let plan: PlanEvent | null = null;
  let position = 0;
  let maxSize = 0;
  let totalEntryQty = 0;
  let totalExitQty = 0;
  let entryWeightedSum = 0;
  let exitWeightedSum = 0;
  let firstEntryTime: string | null = null;
  let firstEntryPrice: number | null = null;
  let firstEntryTicks: number | null = null;
  let lastExitTime: string | null = null;
  let feesCents = 0;
  let priceable = resolvedSpec != null && tickCents != null;
  let totalContractTicks = 0;
  let closedQty = 0;
  let hasEntryFill = false;
  let entryCancelled = false;
  let ocoCancelledWhileOpen = false;
  let stopMoveCount = 0;
  let stopWidened = false;

  const openLots: OpenLot[] = [];
  const positionTimeline: PositionPoint[] = [];
  const closedLots: ClosedLot[] = [];
  const stopPath: StopSegment[] = [];
  const workingOrders: WorkingOrderSegment[] = [];
  const activeStops = new Map<string, ActiveStop>();
  const activeEntryOrders = new Map<string, ActiveOrder>();
  const activeTargetOrders = new Map<string, ActiveOrder>();

  let initialStop: InitialStopInfo | null = null;
  let initialStopChecked = false;
  let lastKnownStopPrice: number | null = null;
  const resolvedExitReasons: Array<{ reason: ExitReason; basis: EventBasis; seq: number; t: string; price: number; fillBasis: EventBasis }> = [];

  const recordOffTickIfNeeded = (price: number, event: TradeEventBase, label: string) => {
    if (!resolvedSpec) return null;
    const ticks = priceToTicks(price, resolvedSpec);
    if (ticks == null) {
      errors.push({
        code: "off_tick_price",
        seq: event.seq,
        t: event.t,
        price,
        basis: event.basis,
        message: `${label} ${price} is off the ${doc.instrument.symbol} tick grid`,
      });
    }
    return ticks;
  };

  const currentOpenAvgEntry = (): number | null => {
    const qtySum = openLots.reduce((sum, lot) => sum + lot.qty, 0);
    if (qtySum <= 0) return null;
    const weighted = openLots.reduce((sum, lot) => sum + lot.price * lot.qty, 0);
    return weighted / qtySum;
  };

  const referenceEntryPrice = (): number | null => {
    if (firstEntryPrice != null) return firstEntryPrice;
    if (plan) return plan.entry.price;
    const firstEntryOrder = activeEntryOrders.values().next().value as ActiveOrder | undefined;
    return firstEntryOrder ? firstEntryOrder.price : null;
  };

  const inferExitReasonFromPrice = (
    fill: FillEvent,
  ): { reason: ExitReason; basis: EventBasis } => {
    if (fill.reason && fill.reason !== "unknown") {
      return { reason: fill.reason, basis: fill.reason_basis ?? fill.basis };
    }
    // Check targets (active working target orders or plan targets) first, then active/plan stop.
    const targetPrices: number[] = [];
    for (const order of activeTargetOrders.values()) targetPrices.push(order.price);
    if (plan) {
      for (const target of plan.targets) targetPrices.push(target.price);
    }
    if (targetPrices.some((tp) => samePrice(fill.price, tp, resolvedSpec))) {
      return { reason: "target", basis: "inferred" };
    }
    const stopPrices: number[] = [];
    for (const stop of activeStops.values()) stopPrices.push(stop.price);
    if (stopPrices.length === 0 && plan?.stop != null) stopPrices.push(plan.stop);
    if (stopPrices.some((sp) => samePrice(fill.price, sp, resolvedSpec))) {
      return { reason: "stop", basis: "inferred" };
    }
    return { reason: "unknown", basis: fill.basis };
  };

  for (const event of activeEvents) {
    switch (event.type) {
      case "plan": {
        plan = event;
        if (!isWholeQuantity(event.qty)) {
          errors.push({
            code: "invalid_quantity",
            seq: event.seq,
            t: event.t,
            price: event.entry.price,
            basis: event.basis,
            message: `Plan quantity ${event.qty} must be a whole number of 1 or more`,
          });
        }
        recordOffTickIfNeeded(event.entry.price, event, "Plan entry");
        if (event.stop != null) {
          recordOffTickIfNeeded(event.stop, event, "Plan stop");
          if (isStopOnWrongSide(event.entry.price, event.stop, sign, resolvedSpec)) {
            errors.push({
              code: "stop_wrong_side",
              seq: event.seq,
              t: event.t,
              price: event.stop,
              basis: event.basis,
              message: `Plan stop ${event.stop} is not on the losing side of entry ${event.entry.price}`,
            });
          }
        }
        let targetQtySum = 0;
        for (const target of event.targets) {
          recordOffTickIfNeeded(target.price, event, `Target ${target.key}`);
          if (!isWholeQuantity(target.qty)) {
            errors.push({
              code: "invalid_quantity",
              seq: event.seq,
              t: event.t,
              price: target.price,
              basis: event.basis,
              message: `Target ${target.key} quantity ${target.qty} must be a whole number of 1 or more`,
            });
          } else {
            targetQtySum += target.qty;
          }
        }
        if (isWholeQuantity(event.qty) && targetQtySum > event.qty) {
          errors.push({
            code: "target_qty_exceeds_position",
            seq: event.seq,
            t: event.t,
            price: event.targets[event.targets.length - 1]?.price ?? null,
            basis: event.basis,
            message: `Planned target quantity (${targetQtySum}) exceeds planned position (${event.qty})`,
          });
        }
        break;
      }

      case "order": {
        if (!isWholeQuantity(event.qty)) {
          errors.push({
            code: "invalid_quantity",
            seq: event.seq,
            t: event.t,
            price: event.price,
            basis: event.basis,
            message: `Order ${event.order} quantity ${event.qty} must be a whole number of 1 or more`,
          });
        }
        recordOffTickIfNeeded(event.price, event, `Order ${event.order}`);

        if (event.role === "entry") {
          const segmentIndex = workingOrders.length;
          workingOrders.push({
            order: event.order,
            role: event.role,
            kind: event.kind,
            from: event.t,
            to: null,
            price: event.price,
            qty: event.qty,
            basis: event.basis,
            end_reason: null,
          });
          activeEntryOrders.set(event.order, {
            order: event.order,
            role: event.role,
            kind: event.kind,
            price: event.price,
            qty: event.qty,
            basis: event.basis,
            segmentIndex,
          });
        } else if (event.role === "target") {
          const segmentIndex = workingOrders.length;
          workingOrders.push({
            order: event.order,
            role: event.role,
            kind: event.kind,
            from: event.t,
            to: null,
            price: event.price,
            qty: event.qty,
            target: event.target,
            basis: event.basis,
            end_reason: null,
          });
          activeTargetOrders.set(event.order, {
            order: event.order,
            role: event.role,
            kind: event.kind,
            price: event.price,
            qty: event.qty,
            target: event.target,
            basis: event.basis,
            segmentIndex,
          });

          const totalWorkingTargetQty = Array.from(activeTargetOrders.values()).reduce(
            (sum, o) => sum + (isWholeQuantity(o.qty) ? o.qty : 0),
            0,
          );
          const positionCap =
            position > 0
              ? position
              : plan && isWholeQuantity(plan.qty)
                ? plan.qty
                : Array.from(activeEntryOrders.values()).reduce((sum, o) => sum + (isWholeQuantity(o.qty) ? o.qty : 0), 0);
          if (positionCap > 0 && totalWorkingTargetQty > positionCap) {
            errors.push({
              code: "target_qty_exceeds_position",
              seq: event.seq,
              t: event.t,
              price: event.price,
              basis: event.basis,
              message: `Working target quantity (${totalWorkingTargetQty}) exceeds position (${positionCap})`,
            });
          }
        } else if (event.role === "stop") {
          const refEntry = referenceEntryPrice();
          // Check initial placement side against entry (only if no plan stop already checked or if this is the first stop placed).
          if (!initialStopChecked && refEntry != null) {
            initialStopChecked = true;
            if (isStopOnWrongSide(refEntry, event.price, sign, resolvedSpec)) {
              errors.push({
                code: "stop_wrong_side",
                seq: event.seq,
                t: event.t,
                price: event.price,
                basis: event.basis,
                message: `Stop order ${event.order} at ${event.price} is not on the losing side of entry ${refEntry}`,
              });
            }
          }

          // If an implicit manual `"stop"` segment was just started from the plan at the exact same timestamp,
          // upgrade it in place to this explicit broker order so there is no zero-length duplicate segment.
          const implicitStop = activeStops.get("stop");
          if (implicitStop?.implicit && stopPath[implicitStop.segmentIndex].from === event.t) {
            const seg = stopPath[implicitStop.segmentIndex];
            seg.order = event.order;
            seg.price = event.price;
            seg.basis = event.basis;
            seg.from_seq = event.seq;
            seg.locked_profit = refEntry != null ? isStopLockingProfit(refEntry, event.price, sign, resolvedSpec) : false;
            activeStops.delete("stop");
            activeStops.set(event.order, {
              order: event.order,
              price: event.price,
              basis: event.basis,
              implicit: false,
              segmentIndex: implicitStop.segmentIndex,
            });
            if (initialStop && initialStop.order === "stop") {
              initialStop = {
                price: event.price,
                t: event.t,
                seq: event.seq,
                order: event.order,
                basis: event.basis,
              };
            }
          } else {
            const segIdx = stopPath.length;
            stopPath.push({
              from: event.t,
              to: null,
              from_seq: event.seq,
              to_seq: null,
              price: event.price,
              order: event.order,
              basis: event.basis,
              widened: false,
              locked_profit: refEntry != null ? isStopLockingProfit(refEntry, event.price, sign, resolvedSpec) : false,
              end_reason: null,
            });
            activeStops.set(event.order, {
              order: event.order,
              price: event.price,
              basis: event.basis,
              implicit: false,
              segmentIndex: segIdx,
            });
            if (!initialStop) {
              initialStop = {
                price: event.price,
                t: event.t,
                seq: event.seq,
                order: event.order,
                basis: event.basis,
              };
            }
          }
          lastKnownStopPrice = event.price;
        }
        break;
      }

      case "modify": {
        const activeStop = activeStops.get(event.order);
        if (activeStop && event.price !== undefined) {
          recordOffTickIfNeeded(event.price, event, `Modify ${event.order}`);
          const prevSeg = stopPath[activeStop.segmentIndex];
          const widened = isStopWidened(activeStop.price, event.price, sign, resolvedSpec);
          prevSeg.to = event.t;
          prevSeg.to_seq = event.seq;
          prevSeg.end_reason = "modified";

          const refEntry = currentOpenAvgEntry() ?? referenceEntryPrice();
          const lockedProfit = refEntry != null ? isStopLockingProfit(refEntry, event.price, sign, resolvedSpec) : false;
          const nextIdx = stopPath.length;
          stopPath.push({
            from: event.t,
            to: null,
            from_seq: event.seq,
            to_seq: null,
            price: event.price,
            order: event.order,
            basis: event.basis,
            widened,
            locked_profit: lockedProfit,
            end_reason: null,
          });
          activeStop.price = event.price;
          activeStop.basis = event.basis;
          activeStop.segmentIndex = nextIdx;
          lastKnownStopPrice = event.price;
          stopMoveCount += 1;
          if (widened) {
            stopWidened = true;
            facts.push({
              code: "stop_widened",
              seq: event.seq,
              t: event.t,
              price: event.price,
              basis: event.basis,
              order: event.order,
            });
          }
        } else {
          const entryOrder = activeEntryOrders.get(event.order);
          if (entryOrder) {
            if (event.price !== undefined) {
              entryOrder.price = event.price;
              workingOrders[entryOrder.segmentIndex].price = event.price;
            }
            if (event.qty !== undefined) {
              entryOrder.qty = event.qty;
              workingOrders[entryOrder.segmentIndex].qty = event.qty;
            }
          }
          const targetOrder = activeTargetOrders.get(event.order);
          if (targetOrder) {
            if (event.price !== undefined) {
              targetOrder.price = event.price;
              workingOrders[targetOrder.segmentIndex].price = event.price;
            }
            if (event.qty !== undefined) {
              targetOrder.qty = event.qty;
              workingOrders[targetOrder.segmentIndex].qty = event.qty;
            }
          }
        }
        break;
      }

      case "cancel": {
        if (event.order === "entry" || activeEntryOrders.has(event.order)) {
          const entryOrder = activeEntryOrders.get(event.order);
          if (entryOrder) {
            workingOrders[entryOrder.segmentIndex].to = event.t;
            workingOrders[entryOrder.segmentIndex].end_reason = "cancelled";
            activeEntryOrders.delete(event.order);
          }
          if (!hasEntryFill) entryCancelled = true;
        }

        const targetOrder = activeTargetOrders.get(event.order);
        if (targetOrder) {
          workingOrders[targetOrder.segmentIndex].to = event.t;
          workingOrders[targetOrder.segmentIndex].end_reason = "cancelled";
          activeTargetOrders.delete(event.order);
        }

        const activeStop = activeStops.get(event.order);
        if (activeStop) {
          const seg = stopPath[activeStop.segmentIndex];
          seg.to = event.t;
          seg.to_seq = event.seq;
          seg.end_reason = "cancelled";
          const removedPrice = activeStop.price;
          activeStops.delete(event.order);

          if (position > 0 && activeStops.size === 0) {
            if (event.reason === "oco") {
              ocoCancelledWhileOpen = true;
            } else {
              facts.push({
                code: "stop_removed_while_open",
                seq: event.seq,
                t: event.t,
                price: removedPrice,
                basis: event.basis,
                order: event.order,
              });
            }
          }
        }
        break;
      }

      case "fill": {
        const validQty = isWholeQuantity(event.qty);
        if (!validQty) {
          priceable = false;
          errors.push({
            code: "invalid_quantity",
            seq: event.seq,
            t: event.t,
            price: event.price,
            basis: event.basis,
            message: `Fill quantity ${event.qty} must be a whole number of 1 or more`,
          });
        }
        const fillTicks = recordOffTickIfNeeded(event.price, event, `Fill (${event.role})`);
        if (fillTicks == null) priceable = false;

        const legFeesCents =
          event.fees != null && Number.isFinite(event.fees) ? Math.round(event.fees * 100) : 0;
        feesCents += legFeesCents;

        if (event.role === "entry") {
          const isFirstEntry = !hasEntryFill;
          hasEntryFill = true;
          if (isFirstEntry) {
            firstEntryTime = event.t;
            firstEntryPrice = event.price;
            firstEntryTicks = fillTicks;
          }

          if (event.order && activeEntryOrders.has(event.order)) {
            const entryOrder = activeEntryOrders.get(event.order)!;
            workingOrders[entryOrder.segmentIndex].to = event.t;
            workingOrders[entryOrder.segmentIndex].end_reason = "filled";
            activeEntryOrders.delete(event.order);
          }

          const qty = validQty ? event.qty : 0;
          position += qty;
          totalEntryQty += qty;
          entryWeightedSum += event.price * qty;
          if (position > maxSize) maxSize = position;
          if (qty > 0) {
            openLots.push({
              seq: event.seq,
              t: event.t,
              qty,
              price: event.price,
              priceTicks: fillTicks,
            });
          }

          // On the first entry fill, if a plan declared a stop and no explicit broker stop order is active yet,
          // activate the reserved manual `"stop"` order at the entry timestamp (docs/15 §3.2).
          if (isFirstEntry && plan?.stop != null && activeStops.size === 0) {
            initialStopChecked = true;
            const segIdx = stopPath.length;
            stopPath.push({
              from: event.t,
              to: null,
              from_seq: event.seq,
              to_seq: null,
              price: plan.stop,
              order: "stop",
              basis: plan.basis,
              widened: false,
              locked_profit: isStopLockingProfit(event.price, plan.stop, sign, resolvedSpec),
              end_reason: null,
            });
            activeStops.set("stop", {
              order: "stop",
              price: plan.stop,
              basis: plan.basis,
              implicit: true,
              segmentIndex: segIdx,
            });
            initialStop = {
              price: plan.stop,
              t: event.t,
              seq: event.seq,
              order: "stop",
              basis: plan.basis,
            };
            lastKnownStopPrice = plan.stop;
          } else if (isFirstEntry && activeStops.size > 0 && !initialStop) {
            const firstStop = activeStops.values().next().value as ActiveStop;
            initialStop = {
              price: firstStop.price,
              t: event.t,
              seq: event.seq,
              order: firstStop.order,
              basis: firstStop.basis,
            };
            lastKnownStopPrice = firstStop.price;
          }

          positionTimeline.push({
            seq: event.seq,
            t: event.t,
            role: "entry",
            qty: event.qty,
            price: event.price,
            position_after: position,
            avg_entry_price: currentOpenAvgEntry(),
            order: event.order,
            basis: event.basis,
            fees_cents: legFeesCents,
          });
        } else {
          // Exit fill
          const inferred = inferExitReasonFromPrice(event);
          resolvedExitReasons.push({
            reason: inferred.reason,
            basis: inferred.basis,
            seq: event.seq,
            t: event.t,
            price: event.price,
            fillBasis: event.basis,
          });

          if (!hasEntryFill) {
            errors.push({
              code: "exit_before_entry",
              seq: event.seq,
              t: event.t,
              price: event.price,
              basis: event.basis,
              message: `Exit fill at ${event.t} precedes any entry fill`,
            });
          } else if (firstEntryTime != null) {
            const entryMs = Date.parse(firstEntryTime);
            const exitMs = Date.parse(event.t);
            if (Number.isFinite(entryMs) && Number.isFinite(exitMs) && exitMs < entryMs) {
              errors.push({
                code: "exit_before_entry",
                seq: event.seq,
                t: event.t,
                price: event.price,
                basis: event.basis,
                message: `Exit fill timestamp ${event.t} is earlier than entry fill ${firstEntryTime}`,
              });
            }
          }

          if (event.order && activeTargetOrders.has(event.order)) {
            const targetOrder = activeTargetOrders.get(event.order)!;
            workingOrders[targetOrder.segmentIndex].to = event.t;
            workingOrders[targetOrder.segmentIndex].end_reason = "filled";
            activeTargetOrders.delete(event.order);
          }

          const qty = validQty ? event.qty : 0;
          position -= qty;
          totalExitQty += qty;
          exitWeightedSum += event.price * qty;
          lastExitTime = event.t;

          if (position < 0) {
            errors.push({
              code: "negative_position",
              seq: event.seq,
              t: event.t,
              price: event.price,
              basis: event.basis,
              message: `Position went negative (${position}) on exit fill of ${event.qty}`,
            });
          }

          // Match FIFO against open entry lots
          let remainingToClose = qty;
          while (remainingToClose > 0 && openLots.length > 0) {
            const lot = openLots[0];
            const matched = Math.min(remainingToClose, lot.qty);
            lot.qty -= matched;
            remainingToClose -= matched;
            if (lot.qty === 0) openLots.shift();

            const lotTicksPerContract =
              fillTicks != null && lot.priceTicks != null ? (fillTicks - lot.priceTicks) * sign : null;
            const lotContractTicks = lotTicksPerContract != null ? lotTicksPerContract * matched : null;
            const lotPnlCents =
              lotContractTicks != null && tickCents != null ? lotContractTicks * tickCents : null;

            if (lotContractTicks != null) {
              totalContractTicks += lotContractTicks;
              closedQty += matched;
            } else {
              priceable = false;
            }

            closedLots.push({
              entry_seq: lot.seq,
              exit_seq: event.seq,
              entry_t: lot.t,
              exit_t: event.t,
              qty: matched,
              entry_price: lot.price,
              exit_price: event.price,
              ticks_per_contract: lotTicksPerContract,
              contract_ticks: lotContractTicks,
              pnl_cents: lotPnlCents,
              exit_reason: inferred.reason,
              exit_reason_basis: inferred.basis,
            });
          }

          // If position reached 0, close active stop and remaining target working segments at this exit time.
          if (position === 0 && hasEntryFill) {
            for (const [orderId, activeStop] of activeStops.entries()) {
              const seg = stopPath[activeStop.segmentIndex];
              seg.to = event.t;
              seg.to_seq = event.seq;
              const filledByStop =
                event.order === orderId || inferred.reason === "stop" || inferred.reason === "trail";
              seg.end_reason = filledByStop ? "filled" : "position_closed";
            }
            activeStops.clear();

            for (const targetOrder of activeTargetOrders.values()) {
              workingOrders[targetOrder.segmentIndex].to = event.t;
              workingOrders[targetOrder.segmentIndex].end_reason = "position_closed";
            }
            activeTargetOrders.clear();
          }

          positionTimeline.push({
            seq: event.seq,
            t: event.t,
            role: "exit",
            qty: event.qty,
            price: event.price,
            position_after: position,
            avg_entry_price: currentOpenAvgEntry(),
            order: event.order,
            reason: inferred.reason,
            basis: event.basis,
            fees_cents: legFeesCents,
          });
        }
        break;
      }

      case "note":
        break;
    }
  }

  // Determine structural closed_not_flat cases:
  // 1) Overshot past flat into negative position, or
  // 2) Broker signalled OCO close while contracts remain open.
  if ((hasEntryFill && totalExitQty > 0 && position < 0) || (ocoCancelledWhileOpen && position !== 0)) {
    const lastFill = positionTimeline[positionTimeline.length - 1];
    errors.push({
      code: "closed_not_flat",
      seq: lastFill?.seq ?? null,
      t: lastFill?.t ?? null,
      price: lastFill?.price ?? null,
      basis: lastFill?.basis ?? null,
      message: `Trade ended with non-zero position (${position})`,
    });
  }

  // Determine derived status
  let status: DerivedTradeStatus;
  if (hasEntryFill) {
    status = position > 0 ? "open" : "closed";
  } else if (activeEntryOrders.size > 0) {
    status = "working";
  } else if (entryCancelled) {
    status = "not_taken";
  } else if (plan) {
    status = "planned";
  } else {
    status = "not_taken";
  }

  // Initial risk (B-32): |first_entry - initial_stop| * max_size * pointValueUsd, strictly on the losing side.
  let initialRiskTicksPerContract: number | null = null;
  let initialRiskContractTicks: number | null = null;
  let initialRiskCents: number | null = null;
  if (initialStop && firstEntryTicks != null && resolvedSpec && tickCents != null && maxSize > 0) {
    const stopTicks = priceToTicks(initialStop.price, resolvedSpec);
    if (stopTicks != null) {
      const riskPerContract = (firstEntryTicks - stopTicks) * sign;
      if (riskPerContract > 0) {
        initialRiskTicksPerContract = riskPerContract;
        initialRiskContractTicks = riskPerContract * maxSize;
        initialRiskCents = initialRiskContractTicks * tickCents;
      }
    }
  }

  // Money & R results: strictly null unless status === "closed", flat (position === 0), and priceable.
  const canPriceResult =
    status === "closed" &&
    position === 0 &&
    priceable &&
    closedQty > 0 &&
    resolvedSpec != null &&
    tickCents != null;

  const contractTicksResult = canPriceResult ? totalContractTicks : null;
  const ticksResult = canPriceResult ? totalContractTicks / closedQty : null;
  const pointsResult =
    canPriceResult && ticksResult != null && resolvedSpec != null
      ? roundPoints(ticksResult, resolvedSpec)
      : null;
  const pnlCentsResult =
    canPriceResult && contractTicksResult != null && tickCents != null
      ? contractTicksResult * tickCents
      : null;
  const pnlUsdResult = pnlCentsResult != null ? pnlCentsResult / 100 : null;
  const rMultipleResult =
    canPriceResult && contractTicksResult != null && initialRiskContractTicks != null
      ? contractTicksResult / initialRiskContractTicks
      : null;

  // Scratch check (D-010): within 0.1R or 2 ticks of entry, whichever is larger — pure integer comparisons.
  let isScratchResult = false;
  if (canPriceResult && contractTicksResult != null) {
    const absContractTicks = Math.abs(contractTicksResult);
    const withinTwoTicks = absContractTicks <= 2 * closedQty;
    const withinPointOneR =
      initialRiskContractTicks != null && absContractTicks * 10 <= initialRiskContractTicks;
    isScratchResult = withinTwoTicks || withinPointOneR;
  }

  // Past-stop fact (docs/15 §2.3 & §3.5 ex-ignored): closed exit ran past the last stop / initial stop on the losing side.
  const referenceStopPrice = lastKnownStopPrice ?? initialStop?.price ?? null;
  if (
    status === "closed" &&
    position === 0 &&
    referenceStopPrice != null &&
    resolvedExitReasons.length > 0 &&
    resolvedSpec != null
  ) {
    const finalExit = resolvedExitReasons[resolvedExitReasons.length - 1];
    const exitTicks = priceToTicks(finalExit.price, resolvedSpec);
    const refStopTicks = priceToTicks(referenceStopPrice, resolvedSpec);
    if (exitTicks != null && refStopTicks != null) {
      const beyondTicks = (exitTicks - refStopTicks) * sign;
      if (beyondTicks < 0) {
        const extraR =
          initialRiskTicksPerContract != null ? beyondTicks / initialRiskTicksPerContract : null;
        facts.push({
          code: "exit_past_stop",
          seq: finalExit.seq,
          t: finalExit.t,
          price: finalExit.price,
          basis: finalExit.fillBasis,
          extra_r: extraR,
        });
      }
    }
  }

  // Outcome derivation (docs/15 §3.3 & §3.5)
  let outcome: TradeOutcome | null = null;
  let outcomeBasis: EventBasis | null = null;
  if (status === "not_taken") {
    outcome = "not_taken";
    const cancelEv = [...activeEvents].reverse().find((e) => e.type === "cancel");
    outcomeBasis = cancelEv?.basis ?? plan?.basis ?? null;
  } else if (status === "closed") {
    const combineBasis = (bases: EventBasis[]): EventBasis => {
      if (bases.includes("inferred")) return "inferred";
      if (bases.includes("stated")) return "stated";
      return bases[0] ?? "inferred";
    };
    const reasons = resolvedExitReasons.map((r) => r.reason);
    const bases = resolvedExitReasons.map((r) => r.basis);
    if (isScratchResult) {
      outcome = "scratch";
      outcomeBasis = combineBasis(resolvedExitReasons.map((r) => r.fillBasis));
    } else if (reasons.length > 1 && reasons.some((r) => r === "target")) {
      outcome = "partial_targets";
      outcomeBasis = combineBasis(bases);
    } else if (reasons.length > 0 && reasons.every((r) => r === "target")) {
      outcome = "target";
      outcomeBasis = combineBasis(bases);
    } else if (reasons.length > 0 && reasons.every((r) => r === "stop")) {
      outcome = "stop";
      outcomeBasis = combineBasis(bases);
    } else if (reasons.length > 0 && reasons.every((r) => r === "trail")) {
      outcome = "trail";
      outcomeBasis = combineBasis(bases);
    } else if (reasons.length > 0 && reasons.every((r) => r === "manual")) {
      outcome = "manual";
      outcomeBasis = combineBasis(bases);
    } else {
      outcome = "manual";
      outcomeBasis = "inferred";
    }
  }

  // Planned R:R per target (docs/15 §3.3 & §3.5)
  const plannedTargets: PlannedTargetResult[] = [];
  let weightedPlannedR: number | null = null;
  if (plan) {
    const planEntryTicks = priceToTicks(plan.entry.price, resolvedSpec);
    const planStopTicks = plan.stop != null ? priceToTicks(plan.stop, resolvedSpec) : null;
    const planRiskTicks =
      planEntryTicks != null && planStopTicks != null ? (planEntryTicks - planStopTicks) * sign : null;
    const validPlanRisk = planRiskTicks != null && planRiskTicks > 0 ? planRiskTicks : null;

    let weightedRewardTicks = 0;
    let totalTargetQty = 0;
    let allTargetsValid = plan.targets.length > 0 && validPlanRisk != null;

    for (const target of plan.targets) {
      const targetTicks = priceToTicks(target.price, resolvedSpec);
      const rewardTicks =
        planEntryTicks != null && targetTicks != null ? (targetTicks - planEntryTicks) * sign : null;
      const targetR =
        validPlanRisk != null && rewardTicks != null && rewardTicks > 0
          ? rewardTicks / validPlanRisk
          : null;
      plannedTargets.push({
        key: target.key,
        price: target.price,
        qty: target.qty,
        planned_r: targetR,
      });
      if (targetR != null && rewardTicks != null && isWholeQuantity(target.qty)) {
        weightedRewardTicks += rewardTicks * target.qty;
        totalTargetQty += target.qty;
      } else {
        allTargetsValid = false;
      }
    }

    if (allTargetsValid && validPlanRisk != null && totalTargetQty > 0) {
      weightedPlannedR = weightedRewardTicks / (validPlanRisk * totalTargetQty);
    }
  }

  return {
    id: doc.id,
    symbol: canonicalSymbol(doc.instrument.symbol) ?? doc.instrument.symbol,
    side: doc.side,
    status,
    outcome,
    outcome_basis: outcomeBasis,
    entry_time: firstEntryTime,
    exit_time: status === "closed" ? lastExitTime : null,
    avg_entry_price: totalEntryQty > 0 ? entryWeightedSum / totalEntryQty : null,
    avg_exit_price: totalExitQty > 0 ? exitWeightedSum / totalExitQty : null,
    first_entry_price: firstEntryPrice,
    max_size: maxSize,
    total_entry_qty: totalEntryQty,
    total_exit_qty: totalExitQty,
    open_qty: position,
    position_timeline: positionTimeline,
    closed_lots: closedLots,
    ticks: ticksResult,
    contract_ticks: contractTicksResult,
    points: pointsResult,
    pnl_cents: pnlCentsResult,
    pnl_usd: pnlUsdResult,
    fees_cents: feesCents,
    fees_usd: feesCents / 100,
    initial_stop: initialStop,
    initial_risk_cents: initialRiskCents,
    initial_risk_usd: initialRiskCents != null ? initialRiskCents / 100 : null,
    r_multiple: rMultipleResult,
    is_scratch: isScratchResult,
    stop_path: stopPath,
    stop_move_count: stopMoveCount,
    stop_widened: stopWidened,
    working_orders: workingOrders,
    plan,
    planned_targets: plannedTargets,
    planned_r: weightedPlannedR,
    facts,
    errors,
  };
}

function legacyPriceEquals(a: number, b: number, symbol: string): boolean {
  const ta = toTicks(a, symbol);
  const tb = toTicks(b, symbol);
  if (ta != null && tb != null) return ta === tb;
  return a === b;
}

/**
 * Convert a legacy flat `TradeRecord` into a `mogmine.trade.v1` `TradeDocument` with no data loss
 * (issue #33, docs/15 §3.6).
 *
 * - Builds a `plan` event from `initial_stop_price` / `stop_loss_price` and `planned_target_price`
 *   when either exists; omits `plan` when neither is on record.
 * - Preserves a moved stop (R-10: `initial_stop_price` vs `stop_loss_price`) as a `modify` (or `cancel`) event.
 * - Emits entry fill and (for closed trades) exit fill.
 * - Infers exit `reason` (`target` / `stop`) ONLY when `exit_price` equals the target or active stop,
 *   stamped with `reason_basis: "inferred"`.
 * - Preserves notes as `note` events and journal annotations in `annotations`.
 */
export function fromLegacy(record: TradeRecord): TradeDocument {
  const events: TradeEvent[] = [];
  let seq = 1;

  const planStop = record.initial_stop_price ?? record.stop_loss_price;
  const targets: PlanTarget[] =
    record.planned_target_price != null
      ? [{ key: "t1", price: record.planned_target_price, qty: record.quantity }]
      : [];

  if (planStop != null || targets.length > 0) {
    events.push({
      seq: seq++,
      t: record.entry_time,
      type: "plan",
      basis: "stated",
      qty: record.quantity,
      entry: { order: "market", price: record.entry_price },
      stop: planStop,
      targets,
    });
  }

  events.push({
    seq: seq++,
    t: record.entry_time,
    type: "fill",
    basis: "stated",
    role: "entry",
    qty: record.quantity,
    price: record.entry_price,
  });

  // Preserve stop moves when R-10 frozen initial_stop_price differs from the working stop_loss_price.
  if (record.initial_stop_price != null && record.stop_loss_price !== record.initial_stop_price) {
    const moveTime = pickStopMoveTime(record.entry_time, record.exit_time, record.initial_stop_set_at);
    if (record.stop_loss_price != null) {
      events.push({
        seq: seq++,
        t: moveTime,
        type: "modify",
        basis: "stated",
        order: "stop",
        price: record.stop_loss_price,
      });
    } else {
      events.push({
        seq: seq++,
        t: moveTime,
        type: "cancel",
        basis: "stated",
        order: "stop",
      });
    }
  }

  // Exit fill for closed trades only (open trades emit entry fill only).
  if (record.status === "closed" && record.exit_time != null && record.exit_price != null) {
    const activeStop = record.stop_loss_price ?? record.initial_stop_price;
    let reason: ExitReason | undefined;
    let reasonBasis: EventBasis | undefined;
    if (
      record.planned_target_price != null &&
      legacyPriceEquals(record.exit_price, record.planned_target_price, record.symbol)
    ) {
      reason = "target";
      reasonBasis = "inferred";
    } else if (activeStop != null && legacyPriceEquals(record.exit_price, activeStop, record.symbol)) {
      reason = "stop";
      reasonBasis = "inferred";
    }

    const exitFill: FillEvent = {
      seq: seq++,
      t: record.exit_time,
      type: "fill",
      basis: "stated",
      role: "exit",
      qty: record.quantity,
      price: record.exit_price,
    };
    if (reason) {
      exitFill.reason = reason;
      exitFill.reason_basis = reasonBasis;
    }
    events.push(exitFill);
  }

  // Preserve free-text and structured notes as `note` events.
  const noteTimestamp = record.exit_time ?? record.entry_time;
  const noteEntries: Array<{ section: NonNullable<NoteAnchor["section"]>; text: string; t: string }> = [
    { section: "pre_trade_thesis", text: record.pre_trade_thesis, t: record.entry_time },
    { section: "management_notes", text: record.management_notes, t: noteTimestamp },
    { section: "note", text: record.note, t: noteTimestamp },
    { section: "post_exit_notes", text: record.post_exit_notes, t: noteTimestamp },
  ];
  for (const item of noteEntries) {
    if (item.text.trim()) {
      events.push({
        seq: seq++,
        t: item.t,
        type: "note",
        basis: "stated",
        text: item.text,
        anchor: { section: item.section },
      });
    }
  }

  return {
    schema: TRADE_DOC_SCHEMA,
    id: record.id,
    user_id: record.user_id || DEFAULT_OWNER_USER_ID,
    revision: 1,
    instrument: {
      symbol: canonicalSymbol(record.symbol) ?? record.symbol,
      contract: null,
    },
    side: record.direction === "SHORT" ? "short" : "long",
    source: {
      kind: "manual",
      provider: null,
      imported_at: null,
    },
    is_sample: record.is_sample,
    events,
    annotations: {
      account_id: record.account_id,
      trade_style: record.trade_style,
      key_level_price: record.key_level_price,
      review_status: record.review_status,
      playbook_id: record.playbook_id,
      quick_tags: [...record.quick_tags],
      checklist_state: record.checklist_state.map((item) => ({ ...item })),
      flagged: record.flagged,
      take_again: record.take_again,
      take_again_at: record.take_again_at,
    },
  };
}

function pickStopMoveTime(entryTime: string, exitTime: string | null, setAt: string | null): string {
  const entryMs = Date.parse(entryTime);
  const exitMs = exitTime != null ? Date.parse(exitTime) : null;
  if (setAt != null) {
    const setMs = Date.parse(setAt);
    if (
      Number.isFinite(setMs) &&
      Number.isFinite(entryMs) &&
      setMs >= entryMs &&
      (exitMs == null || !Number.isFinite(exitMs) || setMs <= exitMs)
    ) {
      return setAt;
    }
  }
  return entryTime;
}

/** Runtime guard for checking an unknown JSON payload is a `mogmine.trade.v1` document. */
export function isTradeDocument(value: unknown): value is TradeDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Record<string, unknown>;
  return (
    doc.schema === TRADE_DOC_SCHEMA &&
    typeof doc.id === "string" &&
    typeof doc.user_id === "string" &&
    (doc.side === "long" || doc.side === "short") &&
    Array.isArray(doc.events) &&
    typeof doc.instrument === "object" &&
    doc.instrument !== null &&
    typeof (doc.instrument as Record<string, unknown>).symbol === "string"
  );
}
