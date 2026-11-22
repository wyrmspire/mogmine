// Pure model and lot-band geometry for partial exits and multiple targets (issue #38, docs/15).
// Pure: no I/O, no DOM. All money arithmetic runs in integer ticks and cents (AGENTS Guardrail 4, B-30, B-31, B-32).

import {
  canonicalSymbol,
  specFor,
  tickDecimals,
  toTicks,
  isWholeQuantity,
} from "./trades.ts";
import type { FuturesContractSpec } from "./trades.ts";

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

/** One planned target with its allocated quantity and calculated planned R. */
export interface PartialTarget {
  key: string;
  price: number;
  qty: number;
  plannedTicks?: number | null;
  plannedPoints?: number | null;
  plannedPnlCents?: number | null;
  plannedPnlUsd?: number | null;
  plannedR?: number | null;
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

  // Risk and R metrics
  initialRiskPerContractCents: number | null;
  initialRiskPerContractUsd: number | null;
  /** Per-lot R multiple: captured ticks / risk ticks. `null` without stop (never 0). */
  r: number | null;
  /** Weighted contribution to the trade's total R: `(qty / totalEntryQty) * r`. */
  rContribution: number | null;

  // Context and visual opacity
  exitReason?: string | null;
  targetKey?: string | null;
  shareOfPosition: number;
  opacityMultiplier: number;
}

/** Aggregated multi-lot partial execution summary. */
export interface PartialSummary {
  symbol: string;
  direction: "LONG" | "SHORT";
  totalEntryQty: number;
  totalExitQty: number;
  openQty: number;
  isClosed: boolean;
  isOpen: boolean;

  // Prices
  avgEntryPrice: number | null;
  avgExitPrice: number | null;
  initialStopPrice: number | null;

  // Initial risk metrics
  stopDistanceTicks: number | null;
  initialRiskPerContractCents: number | null;
  initialRiskPerContractUsd: number | null;
  totalInitialRiskCents: number | null;
  totalInitialRiskUsd: number | null;

  // Integer-tick financial results across closed lots
  contractTicks: number | null;
  avgTicks: number | null;
  points: number | null;
  pnlCents: number | null;
  pnlUsd: number | null;

  // R multiples
  /** Total weighted R across closed trade: `null` if open or initial stop is absent (never 0). */
  rMultiple: number | null;
  /** Realized R against total initial risk across all entries: `null` without initial stop. */
  realizedR: number | null;
  /** Realized R of closed lots only: `null` without initial stop. */
  closedR: number | null;

  // Scratch status (docs/15 §1.3: within 0.1R or 2 ticks of entry, whichever is larger)
  isScratch: boolean;

  // Slices and targets
  bands: PartialLotBand[];
  exits: PartialExit[];
  targets: PartialTarget[];
}

export interface PartialEntryInput {
  time?: string;
  price: number;
  qty: number;
}

export interface CalculatePartialsParams {
  symbol: string;
  direction: "LONG" | "SHORT" | "long" | "short";
  entryPrice?: number;
  entryTime?: string;
  totalQty?: number;
  entries?: PartialEntryInput[];
  initialStopPrice?: number | null;
  exits: PartialExit[];
  targets?: PartialTarget[];
}

export interface CalculateTargetsParams {
  symbol: string;
  direction: "LONG" | "SHORT" | "long" | "short";
  entryPrice: number;
  initialStopPrice?: number | null;
  targets: Array<{ key: string; price: number; qty: number }>;
}

/** Standard direction normalization: +1 for LONG, -1 for SHORT, null otherwise. */
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
 * Calculates planned targets with integer-tick reward distance, points, USD PnL, and planned R.
 */
export function calculatePlannedTargets(params: CalculateTargetsParams): PartialTarget[] {
  const { symbol, direction, entryPrice, initialStopPrice, targets } = params;
  const sign = directionSign(direction);
  const spec = specFor(symbol);
  const entryTicks = toTicks(entryPrice, symbol);
  const tickCents = tickValueCents(symbol);
  const riskTicks = calculateRiskTicks(entryPrice, initialStopPrice, symbol, direction);

  if (!sign || !spec || entryTicks == null || tickCents == null) {
    return targets.map((t) => ({ key: t.key, price: t.price, qty: t.qty, plannedR: null }));
  }

  return targets.map((target) => {
    const targetTicks = toTicks(target.price, symbol);
    if (targetTicks == null || !isWholeQuantity(target.qty)) {
      return { key: target.key, price: target.price, qty: target.qty, plannedR: null };
    }

    const rewardTicks = (targetTicks - entryTicks) * sign;
    if (rewardTicks <= 0) {
      return {
        key: target.key,
        price: target.price,
        qty: target.qty,
        plannedTicks: rewardTicks,
        plannedPoints: roundPoints(rewardTicks * spec.tickSize, spec),
        plannedPnlCents: rewardTicks * target.qty * tickCents,
        plannedPnlUsd: (rewardTicks * target.qty * tickCents) / 100,
        plannedR: null,
      };
    }

    const plannedR = riskTicks != null ? rewardTicks / riskTicks : null;
    return {
      key: target.key,
      price: target.price,
      qty: target.qty,
      plannedTicks: rewardTicks,
      plannedPoints: roundPoints(rewardTicks * spec.tickSize, spec),
      plannedPnlCents: rewardTicks * target.qty * tickCents,
      plannedPnlUsd: (rewardTicks * target.qty * tickCents) / 100,
      plannedR,
    };
  });
}

/**
 * Weighted planned R across multiple targets: sum(rewardTicks * qty) / (riskTicks * totalQty).
 * Returns `null` if any target is invalid, wrong-side, or risk is absent.
 */
export function calculateWeightedPlannedR(
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
 * Scratch evaluation (docs/15 §1.3): result within 0.1R or 2 ticks of entry, whichever is larger.
 * Uses pure integer math.
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
  const withinPointOneR =
    initialRiskContractTicks != null && absContractTicks * 10 <= initialRiskContractTicks;

  return withinTwoTicks || withinPointOneR;
}

interface InternalOpenLot {
  lotIndex: number;
  entryTime: string;
  entryPrice: number;
  entryTicks: number;
  remainingQty: number;
  initialQty: number;
}

/**
 * Master pure calculation for multi-lot partial exits and lot-band geometry.
 *
 * Implements:
 * - Integer-tick P&L and points across multiple exit legs (Guardrail 4).
 * - Per-lot R contribution and total weighted R (Fixture 7 case: 2 lots, T1 +1.0R, T2 +2.5R -> +1.75R).
 * - Generates `PartialLotBand[]` geometry ready for `PositionBoxPrimitive` / `buildMarks`.
 * - Guards `R === null` when initial stop is absent (never 0); handles open remaining lots cleanly.
 */
export function calculatePartials(params: CalculatePartialsParams): PartialSummary {
  const {
    symbol,
    direction: rawDirection,
    entryPrice: rawEntryPrice,
    entryTime: rawEntryTime = "",
    totalQty: rawTotalQty,
    entries: rawEntries,
    initialStopPrice = null,
    exits,
    targets: rawTargets = [],
  } = params;

  const direction = normalizeDirection(rawDirection);
  const sign = directionSign(rawDirection);
  const spec = specFor(symbol);
  const tickCents = tickValueCents(symbol);

  // Normalise entries
  const entries: PartialEntryInput[] = [];
  if (Array.isArray(rawEntries) && rawEntries.length > 0) {
    for (const e of rawEntries) {
      if (isWholeQuantity(e.qty) && Number.isFinite(e.price)) {
        entries.push({ price: e.price, qty: e.qty, time: e.time ?? rawEntryTime });
      }
    }
  } else if (rawEntryPrice != null && Number.isFinite(rawEntryPrice)) {
    const qty =
      rawTotalQty != null && isWholeQuantity(rawTotalQty)
        ? rawTotalQty
        : exits.reduce((sum, x) => sum + (isWholeQuantity(x.qty) ? x.qty : 0), 0) || 1;
    entries.push({ price: rawEntryPrice, qty, time: rawEntryTime });
  }

  const totalEntryQty = entries.reduce((sum, e) => sum + e.qty, 0);
  const weightedEntryPriceSum = entries.reduce((sum, e) => sum + e.price * e.qty, 0);
  const avgEntryPrice = totalEntryQty > 0 ? weightedEntryPriceSum / totalEntryQty : null;

  // Initial risk per contract based on first entry price
  const firstEntryPrice = entries[0]?.price ?? avgEntryPrice;
  const initialRiskTicksPerContract =
    firstEntryPrice != null && direction != null
      ? calculateRiskTicks(firstEntryPrice, initialStopPrice, symbol, direction)
      : null;

  const initialRiskPerContractCents =
    initialRiskTicksPerContract != null && tickCents != null
      ? initialRiskTicksPerContract * tickCents
      : null;

  const initialRiskPerContractUsd =
    initialRiskPerContractCents != null ? initialRiskPerContractCents / 100 : null;

  const totalInitialRiskCents =
    initialRiskPerContractCents != null && totalEntryQty > 0
      ? initialRiskPerContractCents * totalEntryQty
      : null;

  const totalInitialRiskUsd =
    totalInitialRiskCents != null ? totalInitialRiskCents / 100 : null;

  // Process planned targets if provided
  const targets =
    rawTargets.length > 0 && firstEntryPrice != null && direction != null
      ? calculatePlannedTargets({
          symbol,
          direction,
          entryPrice: firstEntryPrice,
          initialStopPrice,
          targets: rawTargets,
        })
      : [];

  // Match exits against open entries FIFO
  const openLots: InternalOpenLot[] = entries.map((e, idx) => ({
    lotIndex: idx,
    entryTime: e.time ?? rawEntryTime,
    entryPrice: e.price,
    entryTicks: toTicks(e.price, symbol) ?? 0,
    remainingQty: e.qty,
    initialQty: e.qty,
  }));

  const bands: PartialLotBand[] = [];
  let totalContractTicks = 0;
  let totalClosedQty = 0;
  let totalExitWeightedPrice = 0;
  let hadBreakevenReason = false;
  let canPriceAll = direction != null && spec != null && tickCents != null;
  let bandIndex = 0;

  for (const exit of exits) {
    if (!isWholeQuantity(exit.qty) || !Number.isFinite(exit.price)) {
      canPriceAll = false;
      continue;
    }

    if (exit.reason === "breakeven") {
      hadBreakevenReason = true;
    }

    const exitTicks = toTicks(exit.price, symbol);
    if (exitTicks == null) {
      canPriceAll = false;
    }

    let remainingToClose = exit.qty;

    while (remainingToClose > 0 && openLots.length > 0) {
      const openLot = openLots[0];
      const closeQty = Math.min(remainingToClose, openLot.remainingQty);
      remainingToClose -= closeQty;
      openLot.remainingQty -= closeQty;
      totalClosedQty += closeQty;
      totalExitWeightedPrice += exit.price * closeQty;

      let lotTicks: number | null = null;
      let lotContractTicks: number | null = null;
      let lotPoints: number | null = null;
      let lotPnlCents: number | null = null;
      let lotPnlUsd: number | null = null;
      let lotR: number | null = null;
      let lotRContribution: number | null = null;

      if (sign != null && exitTicks != null && spec != null && tickCents != null) {
        lotTicks = (exitTicks - openLot.entryTicks) * sign;
        lotContractTicks = lotTicks * closeQty;
        totalContractTicks += lotContractTicks;
        lotPoints = roundPoints(lotTicks * spec.tickSize, spec);
        lotPnlCents = lotContractTicks * tickCents;
        lotPnlUsd = lotPnlCents / 100;

        if (initialRiskTicksPerContract != null) {
          lotR = lotTicks / initialRiskTicksPerContract;
          if (totalEntryQty > 0) {
            lotRContribution = (closeQty / totalEntryQty) * lotR;
          }
        }
      }

      const shareOfPosition = totalEntryQty > 0 ? closeQty / totalEntryQty : 1;

      bands.push({
        lotIndex: bandIndex++,
        qty: closeQty,
        isOpen: false,
        entryTime: openLot.entryTime,
        exitTime: exit.time,
        entryPrice: openLot.entryPrice,
        exitPrice: exit.price,
        t0: openLot.entryTime,
        t1: exit.time,
        p0: openLot.entryPrice,
        p1: exit.price,
        ticks: lotTicks,
        contractTicks: lotContractTicks,
        points: lotPoints,
        pnlCents: lotPnlCents,
        pnlUsd: lotPnlUsd,
        initialRiskPerContractCents,
        initialRiskPerContractUsd,
        r: lotR,
        rContribution: lotRContribution,
        exitReason: exit.reason ?? null,
        targetKey: exit.targetKey ?? null,
        shareOfPosition,
        opacityMultiplier: shareOfPosition,
      });

      if (openLot.remainingQty === 0) {
        openLots.shift();
      }
    }
  }

  // Handle remaining open lots cleanly
  const remainingOpenQty = openLots.reduce((sum, l) => sum + l.remainingQty, 0);
  for (const openLot of openLots) {
    if (openLot.remainingQty <= 0) continue;
    const shareOfPosition = totalEntryQty > 0 ? openLot.remainingQty / totalEntryQty : 1;

    bands.push({
      lotIndex: bandIndex++,
      qty: openLot.remainingQty,
      isOpen: true,
      entryTime: openLot.entryTime,
      exitTime: null,
      entryPrice: openLot.entryPrice,
      exitPrice: null,
      t0: openLot.entryTime,
      t1: null,
      p0: openLot.entryPrice,
      p1: null,
      ticks: null,
      contractTicks: null,
      points: null,
      pnlCents: null,
      pnlUsd: null,
      initialRiskPerContractCents,
      initialRiskPerContractUsd,
      r: null,
      rContribution: null,
      exitReason: null,
      targetKey: null,
      shareOfPosition,
      opacityMultiplier: shareOfPosition,
    });
  }

  const isClosed = remainingOpenQty === 0 && totalClosedQty > 0;
  const isOpen = remainingOpenQty > 0;
  const avgExitPrice = totalClosedQty > 0 ? totalExitWeightedPrice / totalClosedQty : null;

  // Aggregate money & R totals
  let avgTicks: number | null = null;
  let pointsResult: number | null = null;
  let pnlCentsResult: number | null = null;
  let pnlUsdResult: number | null = null;
  let rMultipleResult: number | null = null;
  let realizedRResult: number | null = null;
  let closedRResult: number | null = null;

  if (canPriceAll && totalClosedQty > 0 && spec != null && tickCents != null) {
    avgTicks = totalContractTicks / totalClosedQty;
    pointsResult = roundPoints(avgTicks * spec.tickSize, spec);
    pnlCentsResult = totalContractTicks * tickCents;
    pnlUsdResult = pnlCentsResult / 100;

    if (initialRiskTicksPerContract != null && totalEntryQty > 0) {
      const totalInitialRiskContractTicks = initialRiskTicksPerContract * totalEntryQty;
      realizedRResult = totalContractTicks / totalInitialRiskContractTicks;
      if (isClosed) {
        rMultipleResult = realizedRResult;
      }
      closedRResult = totalContractTicks / (initialRiskTicksPerContract * totalClosedQty);
    }
  }

  const isScratch = isScratchPartials(
    canPriceAll ? totalContractTicks : null,
    totalClosedQty,
    initialRiskTicksPerContract != null ? initialRiskTicksPerContract * totalClosedQty : null,
    hadBreakevenReason,
  );

  return {
    symbol: canonicalSymbol(symbol) ?? symbol,
    direction: direction ?? "LONG",
    totalEntryQty,
    totalExitQty: totalClosedQty,
    openQty: remainingOpenQty,
    isClosed,
    isOpen,
    avgEntryPrice,
    avgExitPrice,
    initialStopPrice,
    stopDistanceTicks: initialRiskTicksPerContract,
    initialRiskPerContractCents,
    initialRiskPerContractUsd,
    totalInitialRiskCents,
    totalInitialRiskUsd,
    contractTicks: canPriceAll && totalClosedQty > 0 ? totalContractTicks : null,
    avgTicks,
    points: pointsResult,
    pnlCents: pnlCentsResult,
    pnlUsd: pnlUsdResult,
    rMultiple: rMultipleResult,
    realizedR: realizedRResult,
    closedR: closedRResult,
    isScratch,
    bands,
    exits,
    targets,
  };
}

/**
 * Generate `PartialLotBand[]` geometry ready for `PositionBoxPrimitive` / `buildMarks`.
 */
export function calculatePartialLotBands(params: CalculatePartialsParams): PartialLotBand[] {
  return calculatePartials(params).bands;
}
