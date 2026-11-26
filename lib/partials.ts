// Partial-exit engine (issue #38, docs/15): FIFO lot matching and the aggregated partials summary.
// Pure: no I/O, no DOM. All money arithmetic runs in integer ticks and cents (AGENTS Guardrail 4, B-30, B-32).
// Target and lot-band geometry lives in ./partials-geometry.ts; this file is the single public entry point.
// Naming (MOGMINE-BLUEPRINT §2.4): `resultR`, `riskR` and `realizedAccountR` are account R (÷ rSizeCents);
// `riskMultiple` and `closedRiskMultiple` are stop-width ratios and are never called R.

import { canonicalSymbol, specFor, toTicks, isWholeQuantity } from "./trades.ts";
import {
  calculatePlannedTargets,
  calculateRiskTicks,
  closedLotBand,
  directionSign,
  isScratchPartials,
  normalizeDirection,
  openLotBand,
  resolveRSizeCents,
  roundPoints,
  tickValueCents,
} from "./partials-geometry.ts";
import type {
  BandContext,
  OpenLot,
  PartialEntryInput,
  PartialExit,
  PartialLotBand,
  PartialTarget,
  PricingFrame,
} from "./partials-geometry.ts";

export {
  calculatePlannedTargets,
  calculateRiskTicks,
  calculateWeightedPlannedRewardRisk,
  directionSign,
  isScratchPartials,
  normalizeDirection,
  resolveRSizeCents,
  roundPoints,
  tickValueCents,
} from "./partials-geometry.ts";
export type {
  CalculateTargetsParams,
  PartialEntryInput,
  PartialExit,
  PartialLotBand,
  PartialTarget,
} from "./partials-geometry.ts";

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

  // Initial risk metrics (stop distance; `null` without a valid risk-side stop)
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

  // Account R (÷ rSizeCents). Valid with or without a stop.
  /** Fixed account R size in integer cents used for every R field below. */
  rSizeCents: number;
  /** Gross closed-trade result in account R: `pnlCents / rSizeCents`. `null` while open. */
  resultR: number | null;
  /** Realized result in account R across closed lots, even while runner lots remain open. */
  realizedAccountR: number | null;
  /** Actual initial risk in account R: `totalInitialRiskCents / rSizeCents`. `null` without a stop, never 0. */
  riskR: number | null;

  // Stop-width ratios (not R). Require a valid initial stop.
  /** Closed trade's stop-width ratio across all entries. `null` while open or without a stop. */
  riskMultiple: number | null;
  /** Stop-width ratio across closed lots only. `null` without a stop. */
  closedRiskMultiple: number | null;

  // Scratch status (docs/15 §1.3, D-C: within max(0.1 × own stop distance, 2 ticks))
  isScratch: boolean;

  // Slices and targets
  bands: PartialLotBand[];
  exits: PartialExit[];
  targets: PartialTarget[];
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
  /** Fixed account R size in integer cents (MOGMINE-BLUEPRINT §2.4). Omitted or invalid falls back to the default. */
  rSizeCents?: number;
}

/**
 * Entry legs for one calculation. Explicit `entries` win; otherwise a single entry is built from
 * `entryPrice`, sized by `totalQty` or, failing that, by the exit quantities.
 */
function normalizeEntries(
  rawEntries: PartialEntryInput[] | undefined,
  rawEntryPrice: number | undefined,
  rawTotalQty: number | undefined,
  rawEntryTime: string,
  exits: PartialExit[],
): PartialEntryInput[] {
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
  return entries;
}

/**
 * Master pure calculation for multi-lot partial exits and lot-band geometry.
 *
 * Implements:
 * - Integer-tick P&L and points across multiple exit legs (Guardrail 4).
 * - Account R (`resultR`, `realizedAccountR`, `riskR`) against the fixed R size, stop or no stop.
 * - Stop-width ratios (`riskMultiple`, `closedRiskMultiple`, per-band `riskMultiple`) when a stop exists.
 * - FIFO lot bands ready for `PositionBoxPrimitive` / `buildMarks`.
 * - Every ratio is `null` (never 0) when its inputs are absent or unpriceable.
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

  const rSizeCents = resolveRSizeCents(params.rSizeCents);
  const direction = normalizeDirection(rawDirection);
  const sign = directionSign(rawDirection);
  const spec = specFor(symbol);
  const tickCents = tickValueCents(symbol);
  const pricing: PricingFrame | null =
    sign != null && spec != null && tickCents != null ? { sign, spec, tickCents } : null;

  const entries = normalizeEntries(rawEntries, rawEntryPrice, rawTotalQty, rawEntryTime, exits);
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
  const totalInitialRiskUsd = totalInitialRiskCents != null ? totalInitialRiskCents / 100 : null;

  // Process planned targets if provided
  const targets =
    rawTargets.length > 0 && firstEntryPrice != null && direction != null
      ? calculatePlannedTargets({
          symbol,
          direction,
          entryPrice: firstEntryPrice,
          initialStopPrice,
          targets: rawTargets,
          rSizeCents,
        })
      : [];

  // Match exits against open entries FIFO
  const bandCtx: BandContext = {
    totalEntryQty,
    rSizeCents,
    pricing,
    initialRiskTicksPerContract,
    initialRiskPerContractCents,
    initialRiskPerContractUsd,
  };
  const openLots: OpenLot[] = entries.map((e, idx) => ({
    lotIndex: idx,
    entryTime: e.time ?? rawEntryTime,
    entryPrice: e.price,
    entryTicks: toTicks(e.price, symbol) ?? 0,
    remainingQty: e.qty,
  }));

  const bands: PartialLotBand[] = [];
  let totalContractTicks = 0;
  let totalClosedQty = 0;
  let totalExitWeightedPrice = 0;
  let hadBreakevenReason = false;
  let canPriceAll = pricing != null;

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

      const band = closedLotBand(bandCtx, openLot, exit, bands.length, closeQty, exitTicks);
      if (band.contractTicks != null) totalContractTicks += band.contractTicks;
      bands.push(band);

      if (openLot.remainingQty === 0) {
        openLots.shift();
      }
    }
  }

  // Remaining open lots (runners) keep their geometry with every result left null
  const remainingOpenQty = openLots.reduce((sum, l) => sum + l.remainingQty, 0);
  for (const openLot of openLots) {
    if (openLot.remainingQty <= 0) continue;
    bands.push(openLotBand(bandCtx, openLot, bands.length));
  }

  const isClosed = remainingOpenQty === 0 && totalClosedQty > 0;
  const isOpen = remainingOpenQty > 0;
  const avgExitPrice = totalClosedQty > 0 ? totalExitWeightedPrice / totalClosedQty : null;

  // Aggregate money, account R and stop-width totals (integer cents throughout; ratios only at the end)
  let avgTicks: number | null = null;
  let pointsResult: number | null = null;
  let pnlCentsResult: number | null = null;
  let pnlUsdResult: number | null = null;
  let riskMultipleResult: number | null = null;
  let closedRiskMultipleResult: number | null = null;

  if (canPriceAll && totalClosedQty > 0 && spec != null && tickCents != null) {
    avgTicks = totalContractTicks / totalClosedQty;
    pointsResult = roundPoints(avgTicks * spec.tickSize, spec);
    pnlCentsResult = totalContractTicks * tickCents;
    pnlUsdResult = pnlCentsResult / 100;

    if (initialRiskTicksPerContract != null && totalEntryQty > 0) {
      closedRiskMultipleResult = totalContractTicks / (initialRiskTicksPerContract * totalClosedQty);
      if (isClosed) {
        riskMultipleResult = totalContractTicks / (initialRiskTicksPerContract * totalEntryQty);
      }
    }
  }

  const realizedAccountR = pnlCentsResult != null ? pnlCentsResult / rSizeCents : null;
  const resultR = isClosed && pnlCentsResult != null ? pnlCentsResult / rSizeCents : null;
  const riskR = totalInitialRiskCents != null ? totalInitialRiskCents / rSizeCents : null;

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
    rSizeCents,
    resultR,
    realizedAccountR,
    riskR,
    riskMultiple: riskMultipleResult,
    closedRiskMultiple: closedRiskMultipleResult,
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
