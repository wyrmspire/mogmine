// Pure target and lot-band geometry for partial exits (issue #38, docs/15). Split out of partials.ts.
// Pure: no I/O, no DOM. All money runs in integer ticks and cents (AGENTS §3b-4, B-30, B-31, B-32).
// Naming follows MOGMINE-BLUEPRINT §2.4: "R" means account R only (pnl ÷ rSizeCents). Stop-width ratios are
// named riskMultiple / plannedRewardRisk and are never called R.

import { isWholeQuantity, specFor, tickDecimals, toTicks } from "./trades.ts";
import type { FuturesContractSpec } from "./trades.ts";
import { isValidRSizeCents, resolveRSize } from "./r-size.ts";

/** One executed partial exit leg. */
export interface PartialExit {
  id?: string;
  seq?: number;
  /** ISO-8601 UTC timestamp or bar-time string. */
  time: string;
  price: number;
  qty: number;
  reason?: "target" | "stop" | "trail" | "breakeven" | "manual" | "unknown" | string;
  targetKey?: string;
  orderId?: string;
}

/** One requested entry leg (scale-ins are several legs). */
export interface PartialEntryInput {
  time?: string;
  price: number;
  qty: number;
}

/** One planned target with its allocated quantity and its planned ratios. */
export interface PartialTarget {
  key: string;
  price: number;
  qty: number;
  plannedTicks?: number | null;
  plannedPoints?: number | null;
  plannedPnlCents?: number | null;
  plannedPnlUsd?: number | null;
  /** Reward ticks ÷ risk ticks (stop-width ratio). `null` without a valid risk-side stop. */
  plannedRewardRisk?: number | null;
  /** Planned P&L ÷ account R size. `null` for wrong-side or invalid targets. Works without a stop. */
  plannedAccountR?: number | null;
}

/**
 * Geometric and financial band for one lot (or closed slice of contracts),
 * ready for `PositionBoxPrimitive` / `buildMarks` rendering in Lane 8.
 */
export interface PartialLotBand {
  lotIndex: number;
  qty: number;
  isOpen: boolean;

  // Time & price coordinates
  entryTime: string;
  exitTime: string | null;
  entryPrice: number;
  exitPrice: number | null;

  // Canonical zone mark aliases (matching Mark { t0, t1, p0, p1 })
  t0: string;
  t1: string | null;
  p0: number;
  p1: number | null;

  // Integer-tick financial results
  ticks: number | null;
  contractTicks: number | null;
  points: number | null;
  pnlCents: number | null;
  pnlUsd: number | null;

  // Risk and ratio metrics
  initialRiskPerContractCents: number | null;
  initialRiskPerContractUsd: number | null;
  /** Per-lot stop-width ratio: captured ticks ÷ risk ticks. `null` without a stop (never 0). */
  riskMultiple: number | null;
  /** Weighted contribution to the trade's total riskMultiple: `(qty / totalEntryQty) * riskMultiple`. */
  riskMultipleContribution: number | null;
  /** Lot result in account R: `pnlCents / rSizeCents`. `null` while open or unpriced. */
  accountR: number | null;

  // Context and visual opacity
  exitReason?: string | null;
  targetKey?: string | null;
  shareOfPosition: number;
  opacityMultiplier: number;
}

export interface CalculateTargetsParams {
  symbol: string;
  direction: "LONG" | "SHORT" | "long" | "short";
  entryPrice: number;
  initialStopPrice?: number | null;
  targets: Array<{ key: string; price: number; qty: number }>;
  /** Fixed account R size in integer cents (MOGMINE-BLUEPRINT §2.4). Defaults to the repo default. */
  rSizeCents?: number;
}

/** Standard direction normalization: "LONG", "SHORT", or null otherwise. */
export function normalizeDirection(direction: string): "LONG" | "SHORT" | null {
  const upper = typeof direction === "string" ? direction.trim().toUpperCase() : "";
  if (upper === "LONG") return "LONG";
  if (upper === "SHORT") return "SHORT";
  return null;
}

export function directionSign(direction: string): 1 | -1 | null {
  const norm = normalizeDirection(direction);
  return norm === "LONG" ? 1 : norm === "SHORT" ? -1 : null;
}

/** Dollars per tick per contract in integer cents. */
export function tickValueCents(symbol: string): number | null {
  const spec = specFor(symbol);
  return spec ? Math.round(spec.tickSize * spec.pointValueUsd * 100) : null;
}

/** Round points to contract tick precision. */
export function roundPoints(points: number, spec: FuturesContractSpec): number {
  return Number(points.toFixed(tickDecimals(spec.tickSize)));
}

/**
 * The account R size in integer cents. A valid caller value wins; anything else (omitted, zero, negative,
 * out of range) falls back to the repo default, exactly as `resolveRSize` does with no account.
 */
export function resolveRSizeCents(rSizeCents?: number | null): number {
  return isValidRSizeCents(rSizeCents) ? rSizeCents : resolveRSize({ account_id: null }).cents;
}

/**
 * Stop risk in integer ticks per contract from entry to initial stop.
 * Strictly null when stop is absent, invalid, or on the wrong side (or at entry).
 * A stop on the wrong side never produces positive risk (issue #50).
 */
export function calculateRiskTicks(
  entryPrice: number,
  initialStopPrice: number | null | undefined,
  symbol: string,
  direction: "LONG" | "SHORT" | "long" | "short",
): number | null {
  if (initialStopPrice == null) return null;
  const sign = directionSign(direction);
  const entryTicks = toTicks(entryPrice, symbol);
  const stopTicks = toTicks(initialStopPrice, symbol);
  if (sign == null || entryTicks == null || stopTicks == null) return null;

  const distance = (entryTicks - stopTicks) * sign;
  return distance > 0 ? distance : null;
}

/**
 * Calculates planned targets with integer-tick reward distance, points, USD PnL, planned reward-to-risk
 * (stop-width ratio) and planned account R (planned P&L ÷ account R size).
 */
export function calculatePlannedTargets(params: CalculateTargetsParams): PartialTarget[] {
  const { symbol, direction, entryPrice, initialStopPrice, targets } = params;
  const rSizeCents = resolveRSizeCents(params.rSizeCents);
  const sign = directionSign(direction);
  const spec = specFor(symbol);
  const entryTicks = toTicks(entryPrice, symbol);
  const tickCents = tickValueCents(symbol);
  const riskTicks = calculateRiskTicks(entryPrice, initialStopPrice, symbol, direction);

  const unplanned = (target: { key: string; price: number; qty: number }): PartialTarget => ({
    key: target.key,
    price: target.price,
    qty: target.qty,
    plannedRewardRisk: null,
    plannedAccountR: null,
  });

  if (!sign || !spec || entryTicks == null || tickCents == null) return targets.map(unplanned);

  return targets.map((target) => {
    const targetTicks = toTicks(target.price, symbol);
    if (targetTicks == null || !isWholeQuantity(target.qty)) return unplanned(target);

    const rewardTicks = (targetTicks - entryTicks) * sign;
    const plannedPnlCents = rewardTicks * target.qty * tickCents;
    const favourable = rewardTicks > 0;
    return {
      key: target.key,
      price: target.price,
      qty: target.qty,
      plannedTicks: rewardTicks,
      plannedPoints: roundPoints(rewardTicks * spec.tickSize, spec),
      plannedPnlCents,
      plannedPnlUsd: plannedPnlCents / 100,
      plannedRewardRisk: favourable && riskTicks != null ? rewardTicks / riskTicks : null,
      plannedAccountR: favourable ? plannedPnlCents / rSizeCents : null,
    };
  });
}

/**
 * Weighted planned reward-to-risk across multiple targets: sum(rewardTicks * qty) / (riskTicks * totalQty).
 * Returns `null` if any target is invalid, wrong-side, or the stop-width risk is absent.
 */
export function calculateWeightedPlannedRewardRisk(
  targets: PartialTarget[],
  initialStopPrice: number | null | undefined,
  entryPrice: number,
  symbol: string,
  direction: "LONG" | "SHORT" | "long" | "short",
): number | null {
  const riskTicks = calculateRiskTicks(entryPrice, initialStopPrice, symbol, direction);
  if (riskTicks == null || targets.length === 0) return null;

  let totalRewardContractTicks = 0;
  let totalTargetQty = 0;

  for (const t of targets) {
    if (!isWholeQuantity(t.qty) || t.plannedTicks == null || t.plannedTicks <= 0) {
      return null;
    }
    totalRewardContractTicks += t.plannedTicks * t.qty;
    totalTargetQty += t.qty;
  }

  if (totalTargetQty <= 0) return null;
  return totalRewardContractTicks / (riskTicks * totalTargetQty);
}

/**
 * Scratch evaluation (docs/15 §1.3, D-C): result within max(0.1 × the trade's own stop distance, 2 ticks).
 * Uses pure integer math. `initialRiskContractTicks` is the stop distance across the closed contracts.
 */
export function isScratchPartials(
  contractTicks: number | null,
  totalClosedQty: number,
  initialRiskContractTicks: number | null,
  hadBreakevenReason: boolean,
): boolean {
  if (hadBreakevenReason) return true;
  if (contractTicks == null || totalClosedQty <= 0) return false;

  const absContractTicks = Math.abs(contractTicks);
  const withinTwoTicks = absContractTicks <= 2 * totalClosedQty;
  const withinPointOneStop =
    initialRiskContractTicks != null && absContractTicks * 10 <= initialRiskContractTicks;

  return withinTwoTicks || withinPointOneStop;
}

/** One FIFO lot: an entry leg with contracts still unclosed. */
export interface OpenLot {
  lotIndex: number;
  entryTime: string;
  entryPrice: number;
  entryTicks: number;
  remainingQty: number;
}

/** Pricing frame for one trade; `null` when the symbol or direction is unknown, so nothing is priced. */
export interface PricingFrame {
  sign: 1 | -1;
  spec: FuturesContractSpec;
  tickCents: number;
}

/** Trade-level context shared by every band of one partials calculation. */
export interface BandContext {
  totalEntryQty: number;
  rSizeCents: number;
  pricing: PricingFrame | null;
  initialRiskTicksPerContract: number | null;
  initialRiskPerContractCents: number | null;
  initialRiskPerContractUsd: number | null;
}

/** Band for a closed slice of one lot. Priced fields stay `null` when `exitTicks` or the frame is missing. */
export function closedLotBand(
  ctx: BandContext,
  lot: OpenLot,
  exit: PartialExit,
  lotIndex: number,
  closeQty: number,
  exitTicks: number | null,
): PartialLotBand {
  let ticks: number | null = null;
  let contractTicks: number | null = null;
  let points: number | null = null;
  let pnlCents: number | null = null;
  let pnlUsd: number | null = null;
  let riskMultiple: number | null = null;
  let riskMultipleContribution: number | null = null;
  let accountR: number | null = null;

  if (ctx.pricing && exitTicks != null) {
    const { sign, spec, tickCents } = ctx.pricing;
    ticks = (exitTicks - lot.entryTicks) * sign;
    contractTicks = ticks * closeQty;
    points = roundPoints(ticks * spec.tickSize, spec);
    pnlCents = contractTicks * tickCents;
    pnlUsd = pnlCents / 100;
    accountR = pnlCents / ctx.rSizeCents;

    if (ctx.initialRiskTicksPerContract != null) {
      riskMultiple = ticks / ctx.initialRiskTicksPerContract;
      if (ctx.totalEntryQty > 0) {
        riskMultipleContribution = (closeQty / ctx.totalEntryQty) * riskMultiple;
      }
    }
  }

  const shareOfPosition = ctx.totalEntryQty > 0 ? closeQty / ctx.totalEntryQty : 1;
  return {
    lotIndex,
    qty: closeQty,
    isOpen: false,
    entryTime: lot.entryTime,
    exitTime: exit.time,
    entryPrice: lot.entryPrice,
    exitPrice: exit.price,
    t0: lot.entryTime,
    t1: exit.time,
    p0: lot.entryPrice,
    p1: exit.price,
    ticks,
    contractTicks,
    points,
    pnlCents,
    pnlUsd,
    initialRiskPerContractCents: ctx.initialRiskPerContractCents,
    initialRiskPerContractUsd: ctx.initialRiskPerContractUsd,
    riskMultiple,
    riskMultipleContribution,
    accountR,
    exitReason: exit.reason ?? null,
    targetKey: exit.targetKey ?? null,
    shareOfPosition,
    opacityMultiplier: shareOfPosition,
  };
}

/** Band for the still-open remainder of one lot. Every result field is `null`. */
export function openLotBand(ctx: BandContext, lot: OpenLot, lotIndex: number): PartialLotBand {
  const shareOfPosition = ctx.totalEntryQty > 0 ? lot.remainingQty / ctx.totalEntryQty : 1;
  return {
    lotIndex,
    qty: lot.remainingQty,
    isOpen: true,
    entryTime: lot.entryTime,
    exitTime: null,
    entryPrice: lot.entryPrice,
    exitPrice: null,
    t0: lot.entryTime,
    t1: null,
    p0: lot.entryPrice,
    p1: null,
    ticks: null,
    contractTicks: null,
    points: null,
    pnlCents: null,
    pnlUsd: null,
    initialRiskPerContractCents: ctx.initialRiskPerContractCents,
    initialRiskPerContractUsd: ctx.initialRiskPerContractUsd,
    riskMultiple: null,
    riskMultipleContribution: null,
    accountR: null,
    exitReason: null,
    targetKey: null,
    shareOfPosition,
    opacityMultiplier: shareOfPosition,
  };
}
