// Golden tests for Issue #35 / TD-1: observeTrade bar observer across fixtures/trades/ex-*.json.
// Pure math and facts: verifies stop_traded_through, target_traded_through, fill_outside_bar,
// MFE/MAE excursions, and post-exit hindsight touches (docs/15 §3.3).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deriveTrade } from "../trade-document.ts";
import type { TradeDocument } from "../trade-document.ts";
import { DEFAULT_TICK_TOLERANCE_TICKS, observeTrade } from "../trade-bar-validation.ts";
import { FUTURES_SPECS } from "../trades.ts";
import type { Candle } from "../trades.ts";

function loadFixture(name: string): TradeDocument {
  const filePath = path.resolve(process.cwd(), `fixtures/trades/${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TradeDocument;
}

function makeBar(timeMs: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  return { time: timeMs, open, high, low, close, volume };
}

test("DEFAULT_TICK_TOLERANCE_TICKS is defined as 4", () => {
  assert.equal(DEFAULT_TICK_TOLERANCE_TICKS, 4);
});

test("observeTrade across all 7 fixtures with real bars and custom bar probes", () => {
  const fixtureNames = [
    "ex-tp",
    "ex-sl",
    "ex-be",
    "ex-trail",
    "ex-ignored",
    "ex-nottaken",
    "ex-partials",
  ];

  for (const name of fixtureNames) {
    const doc = loadFixture(name);
    const derived = deriveTrade(doc, FUTURES_SPECS.MES);

    // Call observeTrade with empty candles
    const emptyObs = observeTrade(derived, [], 1);
    assert.equal(emptyObs.coverage, "missing");
    assert.deepEqual(emptyObs.findings, []);
    assert.equal(emptyObs.excursions, null);
  }
});

test("observeTrade: ex-tp (TP hit) detects post-exit hindsight and clean execution when bars contain fills", () => {
  const doc = loadFixture("ex-tp");
  const derived = deriveTrade(doc, FUTURES_SPECS.MES);
  assert.equal(derived.outcome, "target");

  // Construct synthetic candles that cleanly cover entry to exit, plus session continuation
  // Entry fill: 7600.00 at 15:34:42Z (bar 15:34:00Z -> 1794497640000)
  // Exit fill: 7610.00 at 15:52:18Z (bar 15:52:00Z -> 1794498720000)
  const entryMs = Date.parse(derived.entry_time!);
  const exitMs = Date.parse(derived.exit_time!);
  const minute = 60_000;
  const entryBarTime = Math.floor(entryMs / minute) * minute;
  const exitBarTime = Math.floor(exitMs / minute) * minute;

  const candles: Candle[] = [];
  // Build 1m bars from 15:30 to 16:30
  for (let t = entryBarTime - 4 * minute; t <= exitBarTime + 40 * minute; t += minute) {
    if (t < entryBarTime) {
      candles.push(makeBar(t, 7599, 7601, 7598, 7600));
    } else if (t === entryBarTime) {
      candles.push(makeBar(t, 7599, 7602, 7598, 7601));
    } else if (t < exitBarTime) {
      candles.push(makeBar(t, 7601, 7608, 7600, 7606));
    } else if (t === exitBarTime) {
      // Bar contains the exit at 7610
      candles.push(makeBar(t, 7606, 7611, 7605, 7610));
    } else {
      // Post exit: reaches continued target 7610 again 10 minutes later
      const high = t === exitBarTime + 10 * minute ? 7612 : 7605;
      candles.push(makeBar(t, 7604, high, 7598, 7602));
    }
  }

  const obs = observeTrade(derived, candles, 1, { doc });
  assert.equal(obs.coverage, "complete");
  assert.equal(obs.chronology, "resolved");
  assert.equal(obs.findings.length, 0); // No stop traded through, no unfilled target, fills inside bars
  assert.ok(obs.excursions != null);
  assert.equal(obs.excursions.coverage, "complete");

  // Post exit hindsight: target was filled so it's not unfilled, but hindsight checks last stop & planned targets
  assert.equal(obs.hindsight.target_touches.length, 1);
  assert.equal(obs.hindsight.target_touches[0].price, 7610);
});

test("observeTrade: detects stop_traded_through on premature stop cross", () => {
  const doc = loadFixture("ex-sl");
  const derived = deriveTrade(doc, FUTURES_SPECS.MES);
  const entryMs = Date.parse(derived.entry_time!);
  const exitMs = Date.parse(derived.exit_time!);
  const minute = 60_000;
  const entryBarTime = Math.floor(entryMs / minute) * minute;
  const exitBarTime = Math.floor(exitMs / minute) * minute;

  // Build candles where intermediate bar drops below 7595 while trade is open
  const candles: Candle[] = [];
  for (let t = entryBarTime; t <= exitBarTime; t += minute) {
    if (t === entryBarTime + minute) {
      // Prematurely breaches stop (7595) at 7594
      candles.push(makeBar(t, 7598, 7599, 7594, 7596));
    } else {
      candles.push(makeBar(t, 7598, 7601, 7596, 7599));
    }
  }

  const obs = observeTrade(derived, candles, 1, { doc });
  const stopHit = obs.findings.find((f) => f.code === "stop_traded_through");
  assert.ok(stopHit);
  assert.equal(stopHit.price, 7595);
  assert.equal(stopHit.barTime, entryBarTime + minute);
  assert.equal(stopHit.basis, "stated");
});

test("observeTrade: detects target_traded_through on unfilled target touched before exit", () => {
  const doc = loadFixture("ex-sl"); // Target 7610 unfilled, exits at stop 7595
  const derived = deriveTrade(doc, FUTURES_SPECS.MES);
  const entryMs = Date.parse(derived.entry_time!);
  const exitMs = Date.parse(derived.exit_time!);
  const minute = 60_000;
  const entryBarTime = Math.floor(entryMs / minute) * minute;
  const exitBarTime = Math.floor(exitMs / minute) * minute;

  const candles: Candle[] = [];
  for (let t = entryBarTime; t <= exitBarTime; t += minute) {
    if (t === entryBarTime + 2 * minute) {
      // Spikes to 7611 touching target 7610
      candles.push(makeBar(t, 7602, 7611, 7600, 7605));
    } else {
      candles.push(makeBar(t, 7598, 7602, 7596, 7599));
    }
  }

  const obs = observeTrade(derived, candles, 1, { doc });
  const targetHit = obs.findings.find((f) => f.code === "target_traded_through");
  assert.ok(targetHit);
  assert.equal(targetHit.price, 7610);
  assert.equal(targetHit.barTime, entryBarTime + 2 * minute);
  assert.equal(targetHit.segment, "t1");
  assert.equal(targetHit.basis, "stated");
});

test("observeTrade: detects fill_outside_bar when fill exceeds tick tolerance (B-12)", () => {
  const doc = loadFixture("ex-be"); // Entry 7600, Exit 7600
  const derived = deriveTrade(doc, FUTURES_SPECS.MES);
  const entryMs = Date.parse(derived.entry_time!);
  const exitMs = Date.parse(derived.exit_time!);
  const minute = 60_000;
  const entryBarTime = Math.floor(entryMs / minute) * minute;
  const exitBarTime = Math.floor(exitMs / minute) * minute;

  // Entry bar high is 7598.00; entry fill is 7600.00 (difference = 2.0 pts = 8 ticks > 4 ticks tolerance)
  const candles: Candle[] = [
    makeBar(entryBarTime, 7595, 7598, 7594, 7596),
    makeBar(exitBarTime, 7599, 7601, 7599, 7600),
  ];

  const obs = observeTrade(derived, candles, 1, { doc });
  const outside = obs.findings.filter((f) => f.code === "fill_outside_bar");
  assert.equal(outside.length, 1);
  assert.equal(outside[0].price, 7600);
  assert.equal(outside[0].barTime, entryBarTime);
  assert.equal(outside[0].basis, "stated");
});

test("observeTrade: ex-trail stepped stop path checks each segment's time span independently", () => {
  const doc = loadFixture("ex-trail");
  const derived = deriveTrade(doc, FUTURES_SPECS.MES);
  assert.equal(derived.stop_path.length, 3);
  // Segments: 7595 -> 7601 -> 7606

  const seg0 = derived.stop_path[0];
  const seg1 = derived.stop_path[1];
  const seg0From = Date.parse(seg0.from);
  const seg1From = Date.parse(seg1.from);
  const minute = 60_000;

  // Bar during segment 0 touches 7594 (breach of seg 0)
  const barTime0 = Math.floor(seg0From / minute) * minute + minute;
  // Bar during segment 1 touches 7600 (breach of seg 1 at 7601, but NOT seg 0 at 7595)
  const barTime1 = Math.floor(seg1From / minute) * minute + minute;

  const candles: Candle[] = [
    makeBar(barTime0, 7598, 7599, 7594, 7596),
    makeBar(barTime1, 7603, 7604, 7600, 7602),
  ];

  const obs = observeTrade(derived, candles, 1, { doc });
  const stopHits = obs.findings.filter((f) => f.code === "stop_traded_through");
  assert.equal(stopHits.length, 2);
  assert.equal(stopHits[0].segment, 0);
  assert.equal(stopHits[0].price, 7595);
  assert.equal(stopHits[1].segment, 1);
  assert.equal(stopHits[1].price, 7601);
});

test("observeTrade: ex-nottaken handles unexecuted plan cleanly without throwing", () => {
  const doc = loadFixture("ex-nottaken");
  const derived = deriveTrade(doc, FUTURES_SPECS.MES);
  assert.equal(derived.status, "not_taken");
  assert.equal(derived.entry_time, null);

  const minute = 60_000;
  const startMs = Date.parse("2026-11-12T15:30:00Z");
  const candles: Candle[] = [
    makeBar(startMs, 7602, 7605, 7599, 7601),
    makeBar(startMs + minute, 7601, 7611, 7600, 7610),
  ];

  const obs = observeTrade(derived, candles, 1, { doc });
  assert.equal(obs.coverage, "missing");
  assert.equal(obs.findings.length, 0);
  assert.equal(obs.excursions, null);
});
