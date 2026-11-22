// Pure computed levels engine (LV-1, docs/12 §3A, docs/24 §5).
// Always America/New_York session math (AGENTS §3b-5, B-20, UX-87).
// All prices snapped to tick size in integer ticks and float (AGENTS §3b-4).

import { equityIndexSessionBounds, offsetSessionDate, sessionWeekMonday } from "./session.ts";
import { snapToTick, toTicks } from "./trades.ts";
import type { Candle } from "./trades.ts";

export type ComputedLevelType =
  | "pdh"
  | "pdl"
  | "pdc"
  | "rth_open"
  | "rth_high"
  | "rth_low"
  | "rth_close"
  | "globex_open"
  | "onh"
  | "onl"
  | "pp"
  | "r1"
  | "s1"
  | "r2"
  | "s2"
  | "adr_high"
  | "adr_low"
  | "adr_inner_high"
  | "adr_inner_low"
  | "week_high"
  | "week_low";

export interface ComputedLevel {
  key: string;
  type: ComputedLevelType;
  label: string;
  price: number;
  price_ticks: number;
  formed_at?: string;
  formula: string;
}

export interface ADRCalculationInputs {
  /** 14 completed Globex session high/low values before sessionDate, or direct average value */
  length?: number;
  value?: number;
  history?: Array<{ session_date: string; high: number; low: number }>;
  day_open?: number;
  inner_multiplier?: number;
}

export interface PriorSessionInputs {
  session_date: string;
  high: number;
  low: number;
  settle: number;
}

export interface PriorRthInputs {
  open?: number;
  high?: number;
  low?: number;
  close_1500?: number;
}

export interface OvernightInputs {
  globex_open: number;
  onh: number;
  onh_at?: string;
  onl: number;
  onl_at?: string;
}

export interface LevelSetInputs {
  prior_session: PriorSessionInputs;
  prior_rth?: PriorRthInputs;
  overnight: OvernightInputs;
  adr?: ADRCalculationInputs;
  week?: {
    week_high: number;
    week_high_at?: string;
    week_low: number;
    week_low_at?: string;
  };
}

export interface ComputeLevelsOptions {
  symbol: string;
  sessionDate: string;
  inputs: LevelSetInputs;
}

/**
 * Snaps a price to tick size and returns both price and integer ticks.
 */
function snapLevelPrice(price: number, symbol: string): { price: number; price_ticks: number } | null {
  const snapped = snapToTick(price, symbol);
  if (snapped === null) return null;
  const ticks = toTicks(snapped, symbol);
  if (ticks === null) return null;
  return { price: snapped, price_ticks: ticks };
}

/**
 * Computes classic floor pivots (PP, R1, S1, R2, S2) from prior session H, L, C.
 * H = prior session high, L = prior session low, C = prior session settlement.
 * PP = (H + L + C) / 3
 * R1 = 2 * PP - L
 * S1 = 2 * PP - H
 * R2 = PP + (H - L)
 * S2 = PP - (H - L)
 *
 * All values snapped to tick size per AGENTS §3b-4.
 */
export function computeFloorPivots(
  h: number,
  l: number,
  c: number,
  symbol: string
): Array<ComputedLevel> {
  const ppRaw = (h + l + c) / 3;
  const r1Raw = 2 * ppRaw - l;
  const s1Raw = 2 * ppRaw - h;
  const r2Raw = ppRaw + (h - l);
  const s2Raw = ppRaw - (h - l);

  const pp = snapLevelPrice(ppRaw, symbol);
  const r1 = snapLevelPrice(r1Raw, symbol);
  const s1 = snapLevelPrice(s1Raw, symbol);
  const r2 = snapLevelPrice(r2Raw, symbol);
  const s2 = snapLevelPrice(s2Raw, symbol);

  const levels: ComputedLevel[] = [];
  if (pp) {
    levels.push({
      key: "pp",
      type: "pp",
      label: "PP",
      price: pp.price,
      price_ticks: pp.price_ticks,
      formula: `(H + L + C)/3 = (${h.toFixed(2)} + ${l.toFixed(2)} + ${c.toFixed(2)})/3 = ${ppRaw.toFixed(2)}`,
    });
  }
  if (r1) {
    levels.push({
      key: "r1",
      type: "r1",
      label: "R1",
      price: r1.price,
      price_ticks: r1.price_ticks,
      formula: `2·PP − L = 2·${ppRaw.toFixed(2)} − ${l.toFixed(2)}`,
    });
  }
  if (s1) {
    levels.push({
      key: "s1",
      type: "s1",
      label: "S1",
      price: s1.price,
      price_ticks: s1.price_ticks,
      formula: `2·PP − H = 2·${ppRaw.toFixed(2)} − ${h.toFixed(2)}`,
    });
  }
  if (r2) {
    levels.push({
      key: "r2",
      type: "r2",
      label: "R2",
      price: r2.price,
      price_ticks: r2.price_ticks,
      formula: `PP + (H − L) = ${ppRaw.toFixed(2)} + ${(h - l).toFixed(2)}`,
    });
  }
  if (s2) {
    levels.push({
      key: "s2",
      type: "s2",
      label: "S2",
      price: s2.price,
      price_ticks: s2.price_ticks,
      formula: `PP − (H − L)`,
    });
  }
  return levels;
}

/**
 * Computes ArunKBhaskar ADR Pivots (ADR High, ADR Low, ADR inner high, ADR inner low).
 * ADR = SMA(prior-day High, 14) - SMA(prior-day Low, 14)
 * Open = globex_open of session_date
 * ADR High = Open + ADR / 2
 * ADR Low  = Open - ADR / 2
 * Inner High = Open + innerMultiplier * ADR / 2 (default 0.33)
 * Inner Low  = Open - innerMultiplier * ADR / 2
 */
export function computeAdrBands(
  open: number,
  adrValue: number,
  symbol: string,
  innerMultiplier = 0.33
): Array<ComputedLevel> {
  const halfAdr = adrValue / 2;
  const innerOffset = innerMultiplier * halfAdr;

  const adrHighRaw = open + halfAdr;
  const adrLowRaw = open - halfAdr;
  const adrInnerHighRaw = open + innerOffset;
  const adrInnerLowRaw = open - innerOffset;

  const adrHigh = snapLevelPrice(adrHighRaw, symbol);
  const adrLow = snapLevelPrice(adrLowRaw, symbol);
  const adrInnerHigh = snapLevelPrice(adrInnerHighRaw, symbol);
  const adrInnerLow = snapLevelPrice(adrInnerLowRaw, symbol);

  const levels: ComputedLevel[] = [];
  if (adrHigh) {
    levels.push({
      key: "adr_high",
      type: "adr_high",
      label: "ADR High",
      price: adrHigh.price,
      price_ticks: adrHigh.price_ticks,
      formula: `Open + ADR/2 = ${open.toFixed(2)} + ${halfAdr.toFixed(2)}`,
    });
  }
  if (adrLow) {
    levels.push({
      key: "adr_low",
      type: "adr_low",
      label: "ADR Low",
      price: adrLow.price,
      price_ticks: adrLow.price_ticks,
      formula: `Open − ADR/2 = ${open.toFixed(2)} − ${halfAdr.toFixed(2)}`,
    });
  }
  if (adrInnerHigh) {
    levels.push({
      key: "adr_inner_high",
      type: "adr_inner_high",
      label: "ADR inner high",
      price: adrInnerHigh.price,
      price_ticks: adrInnerHigh.price_ticks,
      formula: `Open + ${innerMultiplier}·ADR/2 = ${open.toFixed(2)} + ${innerOffset.toFixed(2)}`,
    });
  }
  if (adrInnerLow) {
    levels.push({
      key: "adr_inner_low",
      type: "adr_inner_low",
      label: "ADR inner low",
      price: adrInnerLow.price,
      price_ticks: adrInnerLow.price_ticks,
      formula: `Open − ${innerMultiplier}·ADR/2 = ${open.toFixed(2)} − ${innerOffset.toFixed(2)}`,
    });
  }
  return levels;
}

/**
 * Calculates 14-period ADR from history of completed sessions:
 * SMA(High, 14) - SMA(Low, 14) = SMA(High - Low, 14)
 */
export function calculateAdrValue(
  history: Array<{ high: number; low: number }>,
  length = 14
): number | null {
  if (history.length < length) return null;
  const recent = history.slice(-length);
  const sumDiff = recent.reduce((sum, item) => sum + (item.high - item.low), 0);
  return Number((sumDiff / length).toFixed(4));
}

/**
 * Computes the full first-slice set of levels from explicit inputs:
 * - Prior Globex: PDH, PDL, PDC
 * - RTH: RTH open, RTH high, RTH low, 3 PM close
 * - Overnight: Globex open, ONH, ONL
 * - Pivots: PP, R1, S1, R2, S2
 * - ADR: ADR High, ADR Low, ADR inner high, ADR inner low
 * - Week: Week High, Week Low
 */
export function computeLevelsFromInputs(options: ComputeLevelsOptions): ComputedLevel[] {
  const { symbol, inputs } = options;
  const levels: ComputedLevel[] = [];

  // Prior session Globex
  const pdh = snapLevelPrice(inputs.prior_session.high, symbol);
  if (pdh) {
    levels.push({
      key: "pdh",
      type: "pdh",
      label: "PDH",
      price: pdh.price,
      price_ticks: pdh.price_ticks,
      formula: `max(high) over Globex session ${inputs.prior_session.session_date}`,
    });
  }
  const pdl = snapLevelPrice(inputs.prior_session.low, symbol);
  if (pdl) {
    levels.push({
      key: "pdl",
      type: "pdl",
      label: "PDL",
      price: pdl.price,
      price_ticks: pdl.price_ticks,
      formula: `min(low) over Globex session ${inputs.prior_session.session_date}`,
    });
  }
  const pdc = snapLevelPrice(inputs.prior_session.settle, symbol);
  if (pdc) {
    levels.push({
      key: "pdc",
      type: "pdc",
      label: "PDC",
      price: pdc.price,
      price_ticks: pdc.price_ticks,
      formula: `Settlement ${inputs.prior_session.session_date}`,
    });
  }

  // Prior RTH
  if (inputs.prior_rth) {
    if (inputs.prior_rth.open != null) {
      const snap = snapLevelPrice(inputs.prior_rth.open, symbol);
      if (snap) {
        levels.push({
          key: "rth_open",
          type: "rth_open",
          label: "RTH open",
          price: snap.price,
          price_ticks: snap.price_ticks,
          formula: `open of prior 08:30 bar`,
        });
      }
    }
    if (inputs.prior_rth.high != null) {
      const snap = snapLevelPrice(inputs.prior_rth.high, symbol);
      if (snap) {
        levels.push({
          key: "rth_high",
          type: "rth_high",
          label: "RTH high",
          price: snap.price,
          price_ticks: snap.price_ticks,
          formula: `high between 08:30 and 15:00 of prior session`,
        });
      }
    }
    if (inputs.prior_rth.low != null) {
      const snap = snapLevelPrice(inputs.prior_rth.low, symbol);
      if (snap) {
        levels.push({
          key: "rth_low",
          type: "rth_low",
          label: "RTH low",
          price: snap.price,
          price_ticks: snap.price_ticks,
          formula: `low between 08:30 and 15:00 of prior session`,
        });
      }
    }
    if (inputs.prior_rth.close_1500 != null) {
      const snap = snapLevelPrice(inputs.prior_rth.close_1500, symbol);
      if (snap) {
        levels.push({
          key: "rth_close",
          type: "rth_close",
          label: "3 PM close",
          price: snap.price,
          price_ticks: snap.price_ticks,
          formula: `close of prior 14:59 bar`,
        });
      }
    }
  }

  // Overnight
  const globexOpen = snapLevelPrice(inputs.overnight.globex_open, symbol);
  if (globexOpen) {
    levels.push({
      key: "globex_open",
      type: "globex_open",
      label: "Globex open",
      price: globexOpen.price,
      price_ticks: globexOpen.price_ticks,
      formula: `open of first bar at 17:00`,
    });
  }
  const onh = snapLevelPrice(inputs.overnight.onh, symbol);
  if (onh) {
    levels.push({
      key: "onh",
      type: "onh",
      label: "ONH",
      price: onh.price,
      price_ticks: onh.price_ticks,
      formed_at: inputs.overnight.onh_at,
      formula: `max(high) 17:00–08:30`,
    });
  }
  const onl = snapLevelPrice(inputs.overnight.onl, symbol);
  if (onl) {
    levels.push({
      key: "onl",
      type: "onl",
      label: "ONL",
      price: onl.price,
      price_ticks: onl.price_ticks,
      formed_at: inputs.overnight.onl_at,
      formula: `min(low) 17:00–08:30`,
    });
  }

  // Pivots
  const pivots = computeFloorPivots(
    inputs.prior_session.high,
    inputs.prior_session.low,
    inputs.prior_session.settle,
    symbol
  );
  levels.push(...pivots);

  // ADR
  const adrVal = inputs.adr?.value ?? (inputs.adr?.history ? calculateAdrValue(inputs.adr.history, inputs.adr.length ?? 14) : null);
  if (adrVal != null) {
    const openPrice = inputs.adr?.day_open ?? inputs.overnight.globex_open;
    const adrBands = computeAdrBands(openPrice, adrVal, symbol, inputs.adr?.inner_multiplier ?? 0.33);
    levels.push(...adrBands);
  }

  // Week extremes
  if (inputs.week) {
    const wkHigh = snapLevelPrice(inputs.week.week_high, symbol);
    if (wkHigh) {
      levels.push({
        key: "week_high",
        type: "week_high",
        label: "Wk high",
        price: wkHigh.price,
        price_ticks: wkHigh.price_ticks,
        formed_at: inputs.week.week_high_at,
        formula: `high of the week`,
      });
    }
    const wkLow = snapLevelPrice(inputs.week.week_low, symbol);
    if (wkLow) {
      levels.push({
        key: "week_low",
        type: "week_low",
        label: "Wk low",
        price: wkLow.price,
        price_ticks: wkLow.price_ticks,
        formed_at: inputs.week.week_low_at,
        formula: `low of the week`,
      });
    }
  }

  return levels;
}

/**
 * Extracts session level inputs directly from raw native candles across America/New_York session bounds.
 */
export function extractSessionInputsFromCandles(options: {
  symbol: string;
  sessionDate: string;
  candles: readonly Candle[];
  priorSettle: number;
  adrHistory?: Array<{ high: number; low: number }>;
}): LevelSetInputs | null {
  const { sessionDate: sDate, candles, priorSettle, adrHistory } = options;
  if (!candles.length) return null;

  const priorDate = offsetSessionDate(sDate, -1);
  const todayBounds = equityIndexSessionBounds(sDate);
  const priorBounds = equityIndexSessionBounds(priorDate);

  // Prior Globex session: priorBounds.open to priorBounds.close
  const priorGlobexBars = candles.filter((c) => c.time >= priorBounds.open && c.time < priorBounds.close);
  // Prior RTH: priorBounds.rthOpen to priorBounds.rthClose
  const priorRthBars = candles.filter((c) => c.time >= priorBounds.rthOpen && c.time < priorBounds.rthClose);
  // Overnight: todayBounds.open to todayBounds.rthOpen
  const overnightBars = candles.filter((c) => c.time >= todayBounds.open && c.time < todayBounds.rthOpen);

  if (!priorGlobexBars.length || !overnightBars.length) return null;

  const priorHigh = Math.max(...priorGlobexBars.map((b) => b.high));
  const priorLow = Math.min(...priorGlobexBars.map((b) => b.low));

  const onhBar = overnightBars.reduce((max, b) => (b.high > max.high ? b : max), overnightBars[0]);
  const onlBar = overnightBars.reduce((min, b) => (b.low < min.low ? b : min), overnightBars[0]);
  const globexOpenBar = overnightBars[0];

  const inputs: LevelSetInputs = {
    prior_session: {
      session_date: priorDate,
      high: priorHigh,
      low: priorLow,
      settle: priorSettle,
    },
    overnight: {
      globex_open: globexOpenBar.open,
      onh: onhBar.high,
      onh_at: new Date(onhBar.time).toISOString(),
      onl: onlBar.low,
      onl_at: new Date(onlBar.time).toISOString(),
    },
  };

  if (priorRthBars.length) {
    const rthOpen = priorRthBars[0].open;
    const rthHigh = Math.max(...priorRthBars.map((b) => b.high));
    const rthLow = Math.min(...priorRthBars.map((b) => b.low));
    const rthClose = priorRthBars[priorRthBars.length - 1].close;
    inputs.prior_rth = {
      open: rthOpen,
      high: rthHigh,
      low: rthLow,
      close_1500: rthClose,
    };
  }

  if (adrHistory) {
    inputs.adr = {
      length: 14,
      history: adrHistory.map((h, i) => ({ session_date: `session-${i}`, high: h.high, low: h.low })),
      day_open: globexOpenBar.open,
      inner_multiplier: 0.33,
    };
  }

  // Week-to-date calculation
  const monday = sessionWeekMonday(sDate);
  const mondayBounds = equityIndexSessionBounds(monday);
  const weekBars = candles.filter((c) => c.time >= mondayBounds.open && c.time < todayBounds.close);
  if (weekBars.length) {
    const weekHighBar = weekBars.reduce((max, b) => (b.high > max.high ? b : max), weekBars[0]);
    const weekLowBar = weekBars.reduce((min, b) => (b.low < min.low ? b : min), weekBars[0]);
    inputs.week = {
      week_high: weekHighBar.high,
      week_high_at: new Date(weekHighBar.time).toISOString(),
      week_low: weekLowBar.low,
      week_low_at: new Date(weekLowBar.time).toISOString(),
    };
  }

  return inputs;
}
