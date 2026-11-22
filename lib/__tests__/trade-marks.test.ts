// Golden tests for buildMarks display list (issue #34, docs/15 §3.4, D-010).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveTrade } from "../trade-document.ts";
import type { TradeDocument } from "../trade-document.ts";
import { observeTrade } from "../trade-bar-validation.ts";
import { buildMarks, snapTime } from "../trade-marks.ts";
import type {

  FlagMark,
  HatchMark,
  LabelMark,
  SegmentMark,
  ZoneMark,
} from "../trade-marks.ts";
import type { Candle } from "../trades.ts";

function fixture(name: string): TradeDocument {
  return JSON.parse(readFileSync(new URL(`../../fixtures/trades/${name}.json`, import.meta.url), "utf8"));
}

type BarInput = [time: string, low: number, high: number];

function utc(time: string) {
  return Date.parse(
    time.includes("T")
      ? time
      : time.split(":").length === 2
        ? `2026-11-12T${time}:00Z`
        : `2026-11-12T${time}Z`,
  );
}

function makeCandles(inputs: BarInput[]): Candle[] {
  return inputs.map(([time, low, high]) => ({
    time: utc(time),
    low,
    high,
    open: low,
    close: high,
    volume: 1,
  }));
}

const fixtureCandles: Record<string, BarInput[]> = {
  "ex-tp": [["15:31", 7599, 7601], ["15:34", 7599, 7602], ["15:35", 7597, 7608], ["15:52", 7594, 7610]],
  "ex-sl": [["15:34", 7598, 7601], ["15:35", 7594, 7603], ["15:41", 7595, 7596]],
  "ex-be": [["15:34", 7598, 7602], ["15:44", 7599, 7605], ["15:49", 7599, 7600]],
  "ex-trail": [["15:34", 7593, 7600], ["15:47", 7594, 7602], ["15:58", 7594, 7607], ["16:03", 7604, 7608]],
  "ex-ignored": [["15:34", 7593, 7600], ["15:39", 7592, 7599], ["15:46", 7592, 7600]],
  "ex-nottaken": [["15:31", 7593, 7611], ["16:10", 7590, 7620]],
  "ex-partials": [["15:34", 7598, 7602], ["15:42", 7603, 7605], ["16:05", 7600, 7612.5]],
};

test("snapTime snaps to bar correctly and handles missing bar with bounded fallback or math bucket", () => {
  const times = [utc("15:30"), utc("15:35"), utc("15:40")];
  // Inside bar
  assert.equal(snapTime(utc("15:31"), "5m", times), utc("15:30"));
  assert.equal(snapTime(utc("15:35"), "5m", times), utc("15:35"));
  // Missing bar but within tolerance snaps to nearest
  assert.equal(snapTime(utc("15:36"), "1m", times), utc("15:35"));
  // Unresolved timestamp far away
  assert.equal(snapTime(Date.parse("2026-11-20T18:00:00Z"), "1m", times), null);
  // Without candleTimes, falls back to math bucket
  assert.equal(snapTime(utc("15:34:42"), "1m"), utc("15:34:00"));
  assert.equal(snapTime(utc("15:34:42"), "5m"), utc("15:30:00"));
});

test("ex-tp golden marks at 1m and 5m", () => {
  const doc = fixture("ex-tp");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-tp"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes1m = candles.map((c) => c.time);

  const marks1m = buildMarks(derived, facts, "1m", "medium", false, { candleTimes: candleTimes1m });
  // Verify working entry order line (15:31 to 15:34)
  const entryOrderSeg = marks1m.find((m): m is SegmentMark => m.kind === "segment" && m.tone === "entry");
  assert.ok(entryOrderSeg);
  assert.equal(entryOrderSeg.t0, utc("15:31"));
  assert.equal(entryOrderSeg.t1, utc("15:34"));
  assert.equal(entryOrderSeg.p0, 7600);

  // Verify plan zones (stop & target)
  const planZones = marks1m.filter((m): m is ZoneMark => m.kind === "zone" && m.layer === "plan");
  assert.equal(planZones.length, 2);
  const riskPlan = planZones.find((z) => z.tone === "risk");
  assert.equal(riskPlan?.p0, 7600);
  assert.equal(riskPlan?.p1, 7595);
  const profitPlan = planZones.find((z) => z.tone === "profit");
  assert.equal(profitPlan?.p0, 7600);
  assert.equal(profitPlan?.p1, 7610);

  // Verify actual band (7600 to 7610 solid green)
  const actualBand = marks1m.find((m): m is ZoneMark => m.kind === "zone" && m.layer === "actual");
  assert.ok(actualBand);
  assert.equal(actualBand.tone, "profit");
  assert.equal(actualBand.p0, 7600);
  assert.equal(actualBand.p1, 7610);

  // Verify exit flag is TP
  const exitFlag = marks1m.find((m): m is FlagMark => m.kind === "flag" && m.text === "TP");
  assert.ok(exitFlag);
  assert.equal(exitFlag.price, 7610);
  assert.equal(exitFlag.basis, "broker");

  // Verify 5m marks snap to 5m buckets
  const marks5m = buildMarks(derived, facts, "5m", "medium", false);
  const plan5m = marks5m.find((m): m is ZoneMark => m.kind === "zone" && m.layer === "plan");
  assert.equal(plan5m?.t0, utc("15:30")); // 15:34 snaps to 15:30 on 5m
});

test("ex-sl golden marks at 1m: stop hit, no profit zone in actual, SL flag", () => {
  const doc = fixture("ex-sl");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-sl"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes = candles.map((c) => c.time);

  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes });
  const actualBand = marks.find((m): m is ZoneMark => m.kind === "zone" && m.layer === "actual");
  assert.ok(actualBand);
  assert.equal(actualBand.tone, "risk");
  assert.equal(actualBand.p0, 7600);
  assert.equal(actualBand.p1, 7595);

  const exitFlag = marks.find((m): m is FlagMark => m.kind === "flag" && m.text === "SL");
  assert.ok(exitFlag);
  assert.equal(exitFlag.price, 7595);
  assert.equal(exitFlag.tone, "risk");

  // Inferred findings from facts retain provenance
  const findingsMarks = marks.filter((m): m is FlagMark => m.kind === "flag" && m.basis === "inferred");
  for (const fm of findingsMarks) {
    assert.equal(fm.basis, "inferred");
  }
});

test("ex-be golden marks at 1m: breakeven scratch thin gray line", () => {
  const doc = fixture("ex-be");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-be"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes = candles.map((c) => c.time);

  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes });
  const actualBand = marks.find((m) => m.kind === "zone" && m.layer === "actual");
  assert.equal(actualBand, undefined); // Scratch has no band, only thin gray segment

  const scratchSeg = marks.find((m): m is SegmentMark => m.kind === "segment" && m.layer === "actual" && m.tone === "neutral");
  assert.ok(scratchSeg);
  assert.equal(scratchSeg.p0, 7600);
  assert.equal(scratchSeg.p1, 7600);

  const exitFlag = marks.find((m): m is FlagMark => m.kind === "flag" && m.text === "BE");
  assert.ok(exitFlag);
});

test("ex-trail golden marks at 1m: stepped stop path with locked profit hatch", () => {
  const doc = fixture("ex-trail");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-trail"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes = candles.map((c) => c.time);

  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes });
  const stopSegments = marks.filter((m) => m.kind === "segment" && m.dash === "dashed");
  assert.ok(stopSegments.length >= 3);

  const hatch = marks.find((m): m is HatchMark => m.kind === "hatch" && m.tone === "profit");
  assert.ok(hatch, "locked profit hatch should be present");

  const exitFlag = marks.find((m): m is FlagMark => m.kind === "flag" && m.text === "TRAIL");
  assert.ok(exitFlag);
  assert.equal(exitFlag.price, 7606);
});

test("ex-ignored golden marks at 1m: stop cancelled ✕, PAST STOP hatch", () => {
  const doc = fixture("ex-ignored");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-ignored"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes = candles.map((c) => c.time);

  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes });
  const crossFlag = marks.find((m): m is FlagMark => m.kind === "flag" && m.shape === "cross");
  assert.ok(crossFlag);
  assert.equal(crossFlag.text, "✕");

  const pastStopHatch = marks.find((m): m is HatchMark => m.kind === "hatch" && m.tone === "risk");
  assert.ok(pastStopHatch);
  assert.equal(pastStopHatch.label, "PAST STOP -0.6R");

  const exitFlag = marks.find((m): m is FlagMark => m.kind === "flag" && m.text === "MKT");
  assert.ok(exitFlag);
  assert.equal(exitFlag.price, 7592);
});

test("ex-nottaken golden marks: dotted faint plan, PLAN · not filled label, no entry flag", () => {
  const doc = fixture("ex-nottaken");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-nottaken"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes = candles.map((c) => c.time);

  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes });
  const planZones = marks.filter((m): m is ZoneMark => m.kind === "zone" && m.layer === "plan");
  assert.ok(planZones.length >= 2);
  for (const z of planZones) {
    assert.equal(z.style, "dotted");
  }

  const label = marks.find((m): m is LabelMark => m.kind === "label" && m.text.includes("PLAN · not filled"));
  assert.ok(label);

  const entryFlag = marks.find((m) => m.kind === "flag" && (m.shape === "arrow_up" || m.shape === "arrow_down"));
  assert.equal(entryFlag, undefined);
});

test("ex-partials golden marks: multi-exit bands with opacity scaling", () => {
  const doc = fixture("ex-partials");
  const derived = deriveTrade(doc);
  const candles = makeCandles(fixtureCandles["ex-partials"]);
  const facts = observeTrade(derived, candles, 1);
  const candleTimes = candles.map((c) => c.time);

  const marks = buildMarks(derived, facts, "1m", "medium", false, { candleTimes });
  const actualBands = marks.filter((m): m is ZoneMark => m.kind === "zone" && m.layer === "actual");
  assert.equal(actualBands.length, 2);
  assert.equal(actualBands[0].opacityMultiplier, 0.5);
  assert.equal(actualBands[1].opacityMultiplier, 0.5);

  const exitFlags = marks.filter((m): m is FlagMark => m.kind === "flag" && m.text === "TP");
  assert.equal(exitFlags.length, 2);
  assert.equal(exitFlags[0].price, 7605);
  assert.equal(exitFlags[1].price, 7612.5);
});

test("golden marks at 5m for all seven fixtures", () => {
  for (const name of ["ex-tp", "ex-sl", "ex-be", "ex-trail", "ex-ignored", "ex-nottaken", "ex-partials"]) {
    const doc = fixture(name);
    const derived = deriveTrade(doc);
    const candles = makeCandles(fixtureCandles[name]);
    const facts = observeTrade(derived, candles, 5);
    const marks5m = buildMarks(derived, facts, "5m", "medium", false);
    assert.ok(marks5m.length > 0, `${name} should produce marks at 5m`);
    // All time coordinates must be aligned to 5m (modulo 300,000 ms)
    const fiveMinMs = 5 * 60_000;
    for (const m of marks5m) {
      if ("t0" in m) assert.equal(m.t0 % fiveMinMs, 0, `${name} t0 ${m.t0} not 5m aligned`);
      if ("t1" in m) assert.equal(m.t1 % fiveMinMs, 0, `${name} t1 ${m.t1} not 5m aligned`);
      if ("t" in m) assert.equal(m.t % fiveMinMs, 0, `${name} t ${m.t} not 5m aligned`);
    }
  }
});

test("detail level suppresses or expands annotations", () => {
  const doc = fixture("ex-tp");
  const derived = deriveTrade(doc);
  const marksLow = buildMarks(derived, null, "1m", "low", false);
  const marksHigh = buildMarks(derived, null, "1m", "high", false);

  const planLow = marksLow.filter((m): m is ZoneMark => m.kind === "zone" && m.layer === "plan");
  for (const pl of planLow) {
    assert.equal(pl.label, undefined, "Low detail should not have zone labels");
  }

  const planHigh = marksHigh.filter((m): m is ZoneMark => m.kind === "zone" && m.layer === "plan");
  const labeled = planHigh.filter((pl) => pl.label !== undefined);
  assert.ok(labeled.length > 0, "High detail should have zone labels");
});

test("shield mode masks dollar amounts / extra_r on PAST STOP hatch", () => {
  const doc = fixture("ex-ignored");
  const derived = deriveTrade(doc);
  const unshielded = buildMarks(derived, null, "1m", "medium", false);
  const shielded = buildMarks(derived, null, "1m", "medium", true);

  const unshieldedHatch = unshielded.find((m): m is HatchMark => m.kind === "hatch" && m.tone === "risk");
  const shieldedHatch = shielded.find((m): m is HatchMark => m.kind === "hatch" && m.tone === "risk");

  assert.equal(unshieldedHatch?.label, "PAST STOP -0.6R");
  assert.equal(shieldedHatch?.label, "PAST STOP");
});
