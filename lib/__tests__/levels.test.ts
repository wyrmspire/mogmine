import test from "node:test";
import assert from "node:assert/strict";
import {
  computeFloorPivots,
  computeAdrBands,
  calculateAdrValue,
  computeLevelsFromInputs,
  extractSessionInputsFromCandles,
} from "../levels.ts";

import fixtureLevelSet from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };

test("computeFloorPivots matches Thu 2026-11-12 worked check in docs/12 §3A", () => {
  // Worked check, Thu 2026-11-12:
  // H 7671.50, L 7547.50, C 7640.50
  // PP 7619.75, R1 7692.25, S1 7568.25, R2 7743.75, S2 7495.75
  const pivots = computeFloorPivots(7671.5, 7547.5, 7640.5, "MES");
  const byKey = Object.fromEntries(pivots.map((p) => [p.key, p]));

  assert.equal(byKey.pp.price, 7619.75);
  assert.equal(byKey.pp.price_ticks, 7619.75 / 0.25);
  assert.equal(byKey.r1.price, 7692.25);
  assert.equal(byKey.s1.price, 7568.25);
  assert.equal(byKey.r2.price, 7743.75);
  assert.equal(byKey.s2.price, 7495.75);

  // Assert integer ticks representation per AGENTS §3b-4
  for (const p of pivots) {
    assert.equal(Number.isInteger(p.price_ticks), true);
    assert.equal(p.price_ticks * 0.25, p.price);
  }
});

test("computeAdrBands matches Thu 2026-11-12 worked check in docs/12 §3A", () => {
  // ADR: ADR = 141.73, Open = 7616.50
  // ADR High: 7687.25, ADR Low: 7545.75, inner bands: 7640.00 / 7593.00
  const bands = computeAdrBands(7616.5, 141.73, "MES", 0.33);
  const byKey = Object.fromEntries(bands.map((b) => [b.key, b]));

  assert.equal(byKey.adr_high.price, 7687.25);
  assert.equal(byKey.adr_low.price, 7545.75);
  assert.equal(byKey.adr_inner_high.price, 7640.0);
  assert.equal(byKey.adr_inner_low.price, 7593.0);

  for (const b of bands) {
    assert.equal(Number.isInteger(b.price_ticks), true);
    assert.equal(b.price_ticks * 0.25, b.price);
  }
});

test("calculateAdrValue calculates 14-period average daily range correctly", () => {
  const history = [
    { high: 7600, low: 7500 }, // 100
    { high: 7610, low: 7510 }, // 100
    { high: 7620, low: 7520 }, // 100
    { high: 7630, low: 7530 }, // 100
    { high: 7640, low: 7540 }, // 100
    { high: 7650, low: 7550 }, // 100
    { high: 7660, low: 7560 }, // 100
    { high: 7670, low: 7570 }, // 100
    { high: 7680, low: 7580 }, // 100
    { high: 7690, low: 7590 }, // 100
    { high: 7700, low: 7600 }, // 100
    { high: 7710, low: 7610 }, // 100
    { high: 7720, low: 7620 }, // 100
    { high: 7730, low: 7630 }, // 100
  ];
  const adr = calculateAdrValue(history, 14);
  assert.equal(adr, 100);
});

test("computeLevelsFromInputs matches fixture MES-2026-11-12.json computed levels", () => {
  const levels = computeLevelsFromInputs({
    symbol: fixtureLevelSet.symbol,
    sessionDate: fixtureLevelSet.session_date,
    inputs: {
      prior_session: fixtureLevelSet.inputs.prior_session,
      prior_rth: fixtureLevelSet.inputs.prior_rth,
      overnight: fixtureLevelSet.inputs.overnight,
      adr: fixtureLevelSet.inputs.adr,
    },
  });

  const byKey = Object.fromEntries(levels.map((l) => [l.key, l]));

  // Verify prior session Globex
  assert.equal(byKey.pdh.price, 7671.5);
  assert.equal(byKey.pdl.price, 7547.5);
  assert.equal(byKey.pdc.price, 7640.5);

  // Verify prior RTH
  assert.equal(byKey.rth_open.price, 7612.0);
  assert.equal(byKey.rth_high.price, 7671.5);
  assert.equal(byKey.rth_low.price, 7593.0);
  assert.equal(byKey.rth_close.price, 7642.75);

  // Verify overnight
  assert.equal(byKey.globex_open.price, 7616.5);
  assert.equal(byKey.onh.price, 7628.75);
  assert.equal(byKey.onl.price, 7572.5);

  // Verify pivots
  assert.equal(byKey.pp.price, 7619.75);
  assert.equal(byKey.r1.price, 7692.25);
  assert.equal(byKey.s1.price, 7568.25);
  assert.equal(byKey.r2.price, 7743.75);
  assert.equal(byKey.s2.price, 7495.75);

  // Verify ADR
  assert.equal(byKey.adr_high.price, 7687.25);
  assert.equal(byKey.adr_low.price, 7545.75);
  assert.equal(byKey.adr_inner_high.price, 7640.0);
  assert.equal(byKey.adr_inner_low.price, 7593.0);
});

test("extractSessionInputsFromCandles respects America/New_York session bounds", () => {
  // Prior session: 2026-11-11 (Globex: Nov 10 18:00 ET to Nov 11 17:00 ET)
  // Overnight: Nov 11 18:00 ET to Nov 12 09:30 ET
  // RTH: Nov 11 09:30 ET to Nov 11 16:00 ET
  const candles = [
    // Prior Globex open bar: Nov 10 18:00 ET -> UTC: 2026-11-10T23:00:00Z
    { time: Date.parse("2026-11-10T23:00:00Z"), open: 7550, high: 7560, low: 7547.5, close: 7555, volume: 100 },
    // Prior RTH open bar: Nov 11 09:30 ET -> UTC: 2026-11-11T14:30:00Z
    { time: Date.parse("2026-11-11T14:30:00Z"), open: 7612, high: 7671.5, low: 7593, close: 7642.75, volume: 200 },
    // Prior close: Nov 11 16:59 ET -> UTC: 2026-11-11T21:59:00Z
    { time: Date.parse("2026-11-11T21:59:00Z"), open: 7640, high: 7645, low: 7638, close: 7641, volume: 50 },
    // Overnight open: Nov 11 18:00 ET -> UTC: 2026-11-11T23:00:00Z
    { time: Date.parse("2026-11-11T23:00:00Z"), open: 7616.5, high: 7628.75, low: 7610, close: 7620, volume: 100 },
    // Overnight low: Nov 12 07:17 CT (08:17 ET) -> UTC: 2026-11-12T13:17:00Z
    { time: Date.parse("2026-11-12T13:17:00Z"), open: 7575, high: 7580, low: 7572.5, close: 7574, volume: 80 },
  ];

  const extracted = extractSessionInputsFromCandles({
    symbol: "MES",
    sessionDate: "2026-11-12",
    candles,
    priorSettle: 7640.5,
  });

  assert.ok(extracted);
  assert.equal(extracted.prior_session.high, 7671.5);
  assert.equal(extracted.prior_session.low, 7547.5);
  assert.equal(extracted.prior_session.settle, 7640.5);

  assert.equal(extracted.overnight.globex_open, 7616.5);
  assert.equal(extracted.overnight.onh, 7628.75);
  assert.equal(extracted.overnight.onl, 7572.5);

  assert.ok(extracted.prior_rth);
  assert.equal(extracted.prior_rth.open, 7612.0);
  assert.equal(extracted.prior_rth.high, 7671.5);
  assert.equal(extracted.prior_rth.low, 7593.0);
});
