import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePartials,
  calculatePartialLotBands,
  calculatePlannedTargets,
  calculateWeightedPlannedR,
  isScratchPartials,
  tickValueCents,
} from "../partials.ts";
import type { PartialExit, PartialTarget } from "../partials.ts";

test("Fixture 7 case (ex-partials): 2 lots MES, T1 at +1.0R, T2 at +2.5R -> +1.75R weighted R and +$87.50 PnL", () => {
  const exits: PartialExit[] = [
    {
      time: "2026-11-12T15:42:00Z",
      price: 7605.00,
      qty: 1,
      reason: "target",
      targetKey: "t1",
    },
    {
      time: "2026-11-12T16:05:00Z",
      price: 7612.50,
      qty: 1,
      reason: "target",
      targetKey: "t2",
    },
  ];

  const targets: PartialTarget[] = [
    { key: "t1", price: 7605.00, qty: 1 },
    { key: "t2", price: 7612.50, qty: 1 },
  ];

  const summary = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    entryTime: "2026-11-12T15:34:00Z",
    totalQty: 2,
    initialStopPrice: 7595.00,
    exits,
    targets,
  });

  // Position status
  assert.equal(summary.symbol, "MES");
  assert.equal(summary.direction, "LONG");
  assert.equal(summary.totalEntryQty, 2);
  assert.equal(summary.totalExitQty, 2);
  assert.equal(summary.openQty, 0);
  assert.equal(summary.isClosed, true);
  assert.equal(summary.isOpen, false);

  // Risk metrics: 5 points = 20 ticks. MES $5/pt = $1.25/tick. Per-contract risk = $25. Total risk = $50.
  assert.equal(summary.stopDistanceTicks, 20);
  assert.equal(summary.initialRiskPerContractCents, 2_500);
  assert.equal(summary.initialRiskPerContractUsd, 25.0);
  assert.equal(summary.totalInitialRiskCents, 5_000);
  assert.equal(summary.totalInitialRiskUsd, 50.0);

  // P&L & ticks across closed contracts:
  // Lot 1: 5.0 pts = 20 ticks * $1.25 = $25.00 (2,500 cents)
  // Lot 2: 12.5 pts = 50 ticks * $1.25 = $62.50 (6,250 cents)
  // Total contract ticks: 20 + 50 = 70 ticks
  // Total P&L: 2,500 + 6,250 = 8,750 cents ($87.50)
  assert.equal(summary.contractTicks, 70);
  assert.equal(summary.avgTicks, 35);
  assert.equal(summary.points, 8.75);
  assert.equal(summary.pnlCents, 8_750);
  assert.equal(summary.pnlUsd, 87.50);

  // Weighted R multiple: $87.50 / $50.00 = +1.75R
  assert.equal(summary.rMultiple, 1.75);
  assert.equal(summary.realizedR, 1.75);
  assert.equal(summary.closedR, 1.75);

  // Bands geometry
  assert.equal(summary.bands.length, 2);

  const band1 = summary.bands[0];
  assert.equal(band1.lotIndex, 0);
  assert.equal(band1.qty, 1);
  assert.equal(band1.isOpen, false);
  assert.equal(band1.entryTime, "2026-11-12T15:34:00Z");
  assert.equal(band1.exitTime, "2026-11-12T15:42:00Z");
  assert.equal(band1.t0, "2026-11-12T15:34:00Z");
  assert.equal(band1.t1, "2026-11-12T15:42:00Z");
  assert.equal(band1.entryPrice, 7600.00);
  assert.equal(band1.exitPrice, 7605.00);
  assert.equal(band1.p0, 7600.00);
  assert.equal(band1.p1, 7605.00);
  assert.equal(band1.ticks, 20);
  assert.equal(band1.contractTicks, 20);
  assert.equal(band1.points, 5.0);
  assert.equal(band1.pnlCents, 2_500);
  assert.equal(band1.pnlUsd, 25.0);
  assert.equal(band1.r, 1.0);
  assert.equal(band1.rContribution, 0.5); // (1 lot / 2 lots) * 1.0R = 0.5R
  assert.equal(band1.shareOfPosition, 0.5);
  assert.equal(band1.opacityMultiplier, 0.5);
  assert.equal(band1.exitReason, "target");
  assert.equal(band1.targetKey, "t1");

  const band2 = summary.bands[1];
  assert.equal(band2.lotIndex, 1);
  assert.equal(band2.qty, 1);
  assert.equal(band2.isOpen, false);
  assert.equal(band2.entryTime, "2026-11-12T15:34:00Z");
  assert.equal(band2.exitTime, "2026-11-12T16:05:00Z");
  assert.equal(band2.t0, "2026-11-12T15:34:00Z");
  assert.equal(band2.t1, "2026-11-12T16:05:00Z");
  assert.equal(band2.entryPrice, 7600.00);
  assert.equal(band2.exitPrice, 7612.50);
  assert.equal(band2.p0, 7600.00);
  assert.equal(band2.p1, 7612.50);
  assert.equal(band2.ticks, 50);
  assert.equal(band2.contractTicks, 50);
  assert.equal(band2.points, 12.5);
  assert.equal(band2.pnlCents, 6_250);
  assert.equal(band2.pnlUsd, 62.5);
  assert.equal(band2.r, 2.5);
  assert.equal(band2.rContribution, 1.25); // (1 lot / 2 lots) * 2.5R = 1.25R
  assert.equal(band2.shareOfPosition, 0.5);
  assert.equal(band2.opacityMultiplier, 0.5);
  assert.equal(band2.exitReason, "target");
  assert.equal(band2.targetKey, "t2");

  // Sum of contributions equals total weighted R
  assert.equal(band1.rContribution! + band2.rContribution!, 1.75);

  // Planned targets evaluation
  assert.equal(summary.targets.length, 2);
  assert.equal(summary.targets[0].plannedR, 1.0);
  assert.equal(summary.targets[0].plannedPnlUsd, 25.0);
  assert.equal(summary.targets[1].plannedR, 2.5);
  assert.equal(summary.targets[1].plannedPnlUsd, 62.5);
});

test("Contract point values and integer tick math across MNQ, ES, and NQ", () => {
  // MNQ: 0.25 tick, $2/pt -> $0.50/tick (50 cents/tick)
  assert.equal(tickValueCents("MNQ"), 50);
  const mnqSummary = calculatePartials({
    symbol: "MNQ",
    direction: "LONG",
    entryPrice: 21000.00,
    totalQty: 2,
    initialStopPrice: 20950.00, // 50 pts = 200 ticks = $100 risk per contract
    exits: [
      { time: "t1", price: 21050.00, qty: 1 }, // +50 pts = +200 ticks = +$100 (+1.0R)
      { time: "t2", price: 21150.00, qty: 1 }, // +150 pts = +600 ticks = +$300 (+3.0R)
    ],
  });
  assert.equal(mnqSummary.initialRiskPerContractCents, 10_000); // $100
  assert.equal(mnqSummary.contractTicks, 800);
  assert.equal(mnqSummary.pnlCents, 40_000); // $400
  assert.equal(mnqSummary.pnlUsd, 400.0);
  assert.equal(mnqSummary.rMultiple, 2.0); // ($100 + $300) / $200 = 2.0R

  // ES: 0.25 tick, $50/pt -> $12.50/tick (1,250 cents/tick)
  assert.equal(tickValueCents("ES"), 1_250);
  const esSummary = calculatePartials({
    symbol: "ES",
    direction: "LONG",
    entryPrice: 5800.00,
    totalQty: 2,
    initialStopPrice: 5790.00, // 10 pts = 40 ticks = $500 risk per contract
    exits: [
      { time: "t1", price: 5810.00, qty: 1 }, // +10 pts = +40 ticks = +$500 (+1.0R)
      { time: "t2", price: 5820.00, qty: 1 }, // +20 pts = +80 ticks = +$1,000 (+2.0R)
    ],
  });
  assert.equal(esSummary.initialRiskPerContractCents, 50_000); // $500
  assert.equal(esSummary.contractTicks, 120);
  assert.equal(esSummary.pnlCents, 150_000); // $1,500
  assert.equal(esSummary.pnlUsd, 1_500.0);
  assert.equal(esSummary.rMultiple, 1.5); // ($500 + $1000) / $1000 = 1.5R

  // NQ: 0.25 tick, $20/pt -> $5.00/tick (500 cents/tick)
  assert.equal(tickValueCents("NQ"), 500);
  const nqSummary = calculatePartials({
    symbol: "NQ",
    direction: "LONG",
    entryPrice: 21000.00,
    totalQty: 2,
    initialStopPrice: 20980.00, // 20 pts = 80 ticks = $400 risk per contract
    exits: [
      { time: "t1", price: 21020.00, qty: 1 }, // +20 pts = +80 ticks = +$400 (+1.0R)
      { time: "t2", price: 21060.00, qty: 1 }, // +60 pts = +240 ticks = +$1,200 (+3.0R)
    ],
  });
  assert.equal(nqSummary.initialRiskPerContractCents, 40_000); // $400
  assert.equal(nqSummary.pnlCents, 160_000); // $1,600
  assert.equal(nqSummary.pnlUsd, 1_600.0);
  assert.equal(nqSummary.rMultiple, 2.0);
});

test("Guard: R === null when initial stop is absent (never 0)", () => {
  const summary = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    totalQty: 2,
    initialStopPrice: null, // No initial stop
    exits: [
      { time: "t1", price: 7605.00, qty: 1 },
      { time: "t2", price: 7610.00, qty: 1 },
    ],
  });

  // P&L is priceable
  assert.equal(summary.pnlUsd, 75.0);
  // Risk and R metrics MUST be strictly null (never 0)
  assert.equal(summary.stopDistanceTicks, null);
  assert.equal(summary.initialRiskPerContractCents, null);
  assert.equal(summary.initialRiskPerContractUsd, null);
  assert.equal(summary.totalInitialRiskCents, null);
  assert.equal(summary.totalInitialRiskUsd, null);
  assert.equal(summary.rMultiple, null);
  assert.equal(summary.realizedR, null);
  assert.equal(summary.closedR, null);

  for (const band of summary.bands) {
    assert.equal(band.r, null);
    assert.equal(band.rContribution, null);
  }
});

test("Guard: Stop on the wrong side or at entry yields R === null (never positive distance)", () => {
  // Long trade with stop ABOVE entry
  const wrongLong = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    totalQty: 1,
    initialStopPrice: 7605.00, // Invalid!
    exits: [{ time: "t1", price: 7610.00, qty: 1 }],
  });
  assert.equal(wrongLong.stopDistanceTicks, null);
  assert.equal(wrongLong.rMultiple, null);
  assert.equal(wrongLong.bands[0].r, null);

  // Long trade with stop AT entry (distance = 0)
  const zeroDistLong = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    totalQty: 1,
    initialStopPrice: 7600.00,
    exits: [{ time: "t1", price: 7610.00, qty: 1 }],
  });
  assert.equal(zeroDistLong.stopDistanceTicks, null);
  assert.equal(zeroDistLong.rMultiple, null);

  // Short trade with stop BELOW entry
  const wrongShort = calculatePartials({
    symbol: "MES",
    direction: "SHORT",
    entryPrice: 7600.00,
    totalQty: 1,
    initialStopPrice: 7595.00, // Invalid for SHORT!
    exits: [{ time: "t1", price: 7590.00, qty: 1 }],
  });
  assert.equal(wrongShort.stopDistanceTicks, null);
  assert.equal(wrongShort.rMultiple, null);
});

test("Handles open remaining lots cleanly", () => {
  // 3 lots entered at 7600, only 2 exited (T1 at 7605, T2 at 7610), 1 lot remains open
  const summary = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    entryTime: "2026-11-12T15:34:00Z",
    totalQty: 3,
    initialStopPrice: 7595.00, // 20 ticks risk = $25/lot. Total initial risk for 3 lots = $75
    exits: [
      { time: "2026-11-12T15:42:00Z", price: 7605.00, qty: 1, reason: "target", targetKey: "t1" },
      { time: "2026-11-12T15:50:00Z", price: 7610.00, qty: 1, reason: "target", targetKey: "t2" },
    ],
  });

  assert.equal(summary.totalEntryQty, 3);
  assert.equal(summary.totalExitQty, 2);
  assert.equal(summary.openQty, 1);
  assert.equal(summary.isClosed, false);
  assert.equal(summary.isOpen, true);

  // Closed portion financial results
  assert.equal(summary.contractTicks, 60); // 20 + 40
  assert.equal(summary.pnlCents, 7_500); // $25 + $50 = $75
  assert.equal(summary.pnlUsd, 75.0);

  // rMultiple is null for unclosed trade
  assert.equal(summary.rMultiple, null);
  // realizedR is $75 / $75 total initial risk = 1.0R realized so far
  assert.equal(summary.realizedR, 1.0);
  // closedR is $75 / $50 closed initial risk = 1.5R on the closed portion
  assert.equal(summary.closedR, 1.5);

  // Bands: 2 closed bands, 1 open band
  assert.equal(summary.bands.length, 3);

  const openBand = summary.bands[2];
  assert.equal(openBand.lotIndex, 2);
  assert.equal(openBand.qty, 1);
  assert.equal(openBand.isOpen, true);
  assert.equal(openBand.entryTime, "2026-11-12T15:34:00Z");
  assert.equal(openBand.exitTime, null);
  assert.equal(openBand.t0, "2026-11-12T15:34:00Z");
  assert.equal(openBand.t1, null);
  assert.equal(openBand.entryPrice, 7600.00);
  assert.equal(openBand.exitPrice, null);
  assert.equal(openBand.p0, 7600.00);
  assert.equal(openBand.p1, null);
  assert.equal(openBand.ticks, null);
  assert.equal(openBand.contractTicks, null);
  assert.equal(openBand.points, null);
  assert.equal(openBand.pnlCents, null);
  assert.equal(openBand.pnlUsd, null);
  assert.equal(openBand.r, null);
  assert.equal(openBand.rContribution, null);
  assert.equal(openBand.shareOfPosition, 1 / 3);
  assert.equal(openBand.opacityMultiplier, 1 / 3);
});

test("Short trades: multi-lot partial targets and losses", () => {
  // Short winning trade with 2 lots
  const shortWinner = calculatePartials({
    symbol: "MES",
    direction: "SHORT",
    entryPrice: 7600.00,
    totalQty: 2,
    initialStopPrice: 7605.00, // 5 pts = 20 ticks risk = $25/lot ($50 total)
    exits: [
      { time: "t1", price: 7595.00, qty: 1 }, // +5 pts = +20 ticks = +1.0R ($25)
      { time: "t2", price: 7587.50, qty: 1 }, // +12.5 pts = +50 ticks = +2.5R ($62.50)
    ],
  });
  assert.equal(shortWinner.contractTicks, 70);
  assert.equal(shortWinner.pnlUsd, 87.50);
  assert.equal(shortWinner.rMultiple, 1.75);
  assert.equal(shortWinner.bands[0].r, 1.0);
  assert.equal(shortWinner.bands[1].r, 2.5);

  // Short losing trade with 2 lots
  const shortLoser = calculatePartials({
    symbol: "MES",
    direction: "SHORT",
    entryPrice: 7600.00,
    totalQty: 2,
    initialStopPrice: 7605.00, // 20 ticks risk per contract
    exits: [
      { time: "t1", price: 7602.50, qty: 1 }, // -2.5 pts = -10 ticks = -0.5R (-$12.50)
      { time: "t2", price: 7605.00, qty: 1 }, // -5.0 pts = -20 ticks = -1.0R (-$25.00)
    ],
  });
  assert.equal(shortLoser.contractTicks, -30);
  assert.equal(shortLoser.pnlUsd, -37.50);
  assert.equal(shortLoser.rMultiple, -0.75);
  assert.equal(shortLoser.bands[0].r, -0.5);
  assert.equal(shortLoser.bands[1].r, -1.0);
});

test("FIFO lot matching across multiple entries (scale-ins)", () => {
  const summary = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entries: [
      { time: "e1", price: 7600.00, qty: 1 },
      { time: "e2", price: 7602.00, qty: 1 },
    ],
    initialStopPrice: 7595.00, // Initial risk based on first entry: 7600 - 7595 = 5 pts = 20 ticks ($25/lot)
    exits: [
      { time: "x1", price: 7605.00, qty: 1 }, // Matched to e1 (7600 -> 7605: +5 pts = +20 ticks = $25)
      { time: "x2", price: 7610.00, qty: 1 }, // Matched to e2 (7602 -> 7610: +8 pts = +32 ticks = $40)
    ],
  });

  assert.equal(summary.totalEntryQty, 2);
  assert.equal(summary.avgEntryPrice, 7601.00);
  assert.equal(summary.bands.length, 2);

  // Band 1: matched to entry 1
  assert.equal(summary.bands[0].entryPrice, 7600.00);
  assert.equal(summary.bands[0].exitPrice, 7605.00);
  assert.equal(summary.bands[0].ticks, 20);
  assert.equal(summary.bands[0].pnlUsd, 25.0);

  // Band 2: matched to entry 2
  assert.equal(summary.bands[1].entryPrice, 7602.00);
  assert.equal(summary.bands[1].exitPrice, 7610.00);
  assert.equal(summary.bands[1].ticks, 32);
  assert.equal(summary.bands[1].pnlUsd, 40.0);

  assert.equal(summary.contractTicks, 52);
  assert.equal(summary.pnlUsd, 65.0);
});

test("Scratch detection per docs/15 §1.3 (0.1R or 2 ticks whichever is larger)", () => {
  // 2 ticks on MES = 0.50 pt. Risk = 20 ticks. 0.1R = 2 ticks.
  // Scratch inside 2 ticks:
  assert.equal(isScratchPartials(2, 1, 20, false), true);
  assert.equal(isScratchPartials(1, 1, 20, false), true);
  assert.equal(isScratchPartials(0, 1, 20, false), true);
  assert.equal(isScratchPartials(-2, 1, 20, false), true);
  // Outside 2 ticks (3 ticks on 1 contract when 0.1R is 2 ticks):
  assert.equal(isScratchPartials(3, 1, 20, false), false);

  // Larger risk: 100 ticks risk -> 0.1R = 10 ticks.
  // 5 ticks is within 0.1R (10 ticks):
  assert.equal(isScratchPartials(5, 1, 100, false), true);
  assert.equal(isScratchPartials(10, 1, 100, false), true);
  assert.equal(isScratchPartials(11, 1, 100, false), false);

  // Explicit breakeven reason always marks scratch
  assert.equal(isScratchPartials(50, 1, 20, true), true);
});

test("Rejection of off-tick prices and unknown symbols", () => {
  // Off-tick price (7600.13 is off-tick for MES 0.25 tick grid)
  const offTick = calculatePartials({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    totalQty: 1,
    initialStopPrice: 7595.00,
    exits: [{ time: "t1", price: 7600.13, qty: 1 }],
  });
  assert.equal(offTick.contractTicks, null);
  assert.equal(offTick.pnlUsd, null);
  assert.equal(offTick.rMultiple, null);
  assert.equal(offTick.bands[0].ticks, null);

  // Unknown contract symbol
  const unknownSymbol = calculatePartials({
    symbol: "XYZ_FAKE",
    direction: "LONG",
    entryPrice: 100.00,
    totalQty: 1,
    initialStopPrice: 90.00,
    exits: [{ time: "t1", price: 110.00, qty: 1 }],
  });
  assert.equal(unknownSymbol.contractTicks, null);
  assert.equal(unknownSymbol.pnlUsd, null);
  assert.equal(unknownSymbol.rMultiple, null);
});

test("calculatePlannedTargets and calculateWeightedPlannedR", () => {
  const targets = calculatePlannedTargets({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    initialStopPrice: 7595.00, // 20 ticks risk
    targets: [
      { key: "t1", price: 7605.00, qty: 1 }, // 20 ticks = 1.0R
      { key: "t2", price: 7612.50, qty: 1 }, // 50 ticks = 2.5R
    ],
  });

  assert.equal(targets.length, 2);
  assert.equal(targets[0].plannedR, 1.0);
  assert.equal(targets[0].plannedTicks, 20);
  assert.equal(targets[0].plannedPoints, 5.0);
  assert.equal(targets[0].plannedPnlUsd, 25.0);

  assert.equal(targets[1].plannedR, 2.5);
  assert.equal(targets[1].plannedTicks, 50);
  assert.equal(targets[1].plannedPoints, 12.5);
  assert.equal(targets[1].plannedPnlUsd, 62.5);

  const weightedR = calculateWeightedPlannedR(targets, 7595.00, 7600.00, "MES", "LONG");
  assert.equal(weightedR, 1.75);

  // Target on wrong side
  const wrongTargets = calculatePlannedTargets({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    initialStopPrice: 7595.00,
    targets: [{ key: "t_bad", price: 7590.00, qty: 1 }],
  });
  assert.equal(wrongTargets[0].plannedR, null);
  assert.equal(calculateWeightedPlannedR(wrongTargets, 7595.00, 7600.00, "MES", "LONG"), null);
});

test("calculatePartialLotBands helper returns band geometry directly", () => {
  const bands = calculatePartialLotBands({
    symbol: "MES",
    direction: "LONG",
    entryPrice: 7600.00,
    entryTime: "15:34",
    totalQty: 2,
    initialStopPrice: 7595.00,
    exits: [
      { time: "15:42", price: 7605.00, qty: 1, targetKey: "t1" },
      { time: "16:05", price: 7612.50, qty: 1, targetKey: "t2" },
    ],
  });

  assert.equal(bands.length, 2);
  assert.equal(bands[0].t0, "15:34");
  assert.equal(bands[0].t1, "15:42");
  assert.equal(bands[0].p0, 7600.00);
  assert.equal(bands[0].p1, 7605.00);
  assert.equal(bands[0].targetKey, "t1");
  assert.equal(bands[1].targetKey, "t2");
});
