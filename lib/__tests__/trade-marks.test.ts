import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { observeTrade } from "../trade-bar-validation.ts";
import { deriveTrade } from "../trade-document.ts";
import type { TradeDocument, TradeEvent } from "../trade-document.ts";
import { buildMarks } from "../trade-marks.ts";
import type { Mark } from "../trade-marks.ts";
import { aggregateCandles, TIMEFRAME_MINUTES } from "../trades.ts";
import type { Candle } from "../trades.ts";

function fixture(name: string): TradeDocument {
  return JSON.parse(readFileSync(new URL(`../../fixtures/trades/${name}.json`, import.meta.url), "utf8"));
}

function utc(time: string) {
  return Date.parse(`2026-11-12T${time.length === 5 ? time + ":00" : time}Z`);
}

function candles(inputs: Array<[string, number, number]>): Candle[] {
  return inputs.map(([time, low, high]) => ({ time: utc(time), low, high, open: low, close: high, volume: 1 }));
}

const examples: Record<string, Candle[]> = {
  "ex-tp": candles([["15:31", 7599, 7601], ["15:34", 7599, 7602], ["15:35", 7597, 7608], ["15:40", 7598, 7609],
    ["15:52", 7594, 7610], ["15:55", 7595, 7611], ["16:15", 7597, 7611]]),
  "ex-sl": candles([["15:34", 7598, 7601], ["15:35", 7594, 7603], ["15:36", 7600, 7611], ["15:41", 7595, 7596],
    ["15:45", 7594, 7611], ["16:15", 7597, 7611]]),
  "ex-be": candles([["15:34", 7598, 7602], ["15:40", 7597, 7599], ["15:44", 7599, 7605], ["15:49", 7599, 7600],
    ["16:15", 7605, 7611]]),
  "ex-trail": candles([["15:34", 7593, 7600], ["15:35", 7594, 7600], ["15:47", 7594, 7602], ["15:48", 7600, 7604],
    ["15:58", 7594, 7607], ["15:59", 7605, 7607], ["16:03", 7604, 7608], ["16:15", 7605, 7610]]),
  "ex-ignored": candles([["15:34", 7593, 7600], ["15:35", 7598, 7603], ["15:39", 7592, 7599], ["15:40", 7592, 7599],
    ["15:46", 7592, 7600], ["15:50", 7590, 7600], ["16:15", 7590, 7600]]),
  "ex-nottaken": candles([["15:31", 7593, 7611], ["16:10", 7590, 7620], ["16:15", 7590, 7620]]),
  "ex-partials": candles([["15:34", 7598, 7602], ["15:42", 7603, 7605], ["15:44", 7602, 7611], ["16:05", 7600, 7612.5],
    ["16:15", 7599, 7613]]),
};

const goldenFile = new URL("../../fixtures/trades/build-marks.golden.json", import.meta.url);
const expected = JSON.parse(readFileSync(goldenFile, "utf8"));

function readableMarks(marks: Mark[]): unknown[] {
  return JSON.parse(JSON.stringify(marks, (key, value) => {
    if (key !== "t" && key !== "t0" && key !== "t1") return value;
    return new Date(value).toISOString().replace(/^2026-11-12T(.*):00\.000Z$/, "$1");
  }));
}

for (const [name, minuteBars] of Object.entries(examples)) {
  for (const timeframe of ["1m", "5m"] as const) {
    const key = `${name} ${timeframe}`;
    test(`${key}: exact ordered mark list on displayed candles`, () => {
      const derived = deriveTrade(fixture(name));
      const bars = aggregateCandles(minuteBars, timeframe);
      const facts = observeTrade(derived, bars, TIMEFRAME_MINUTES[timeframe]);
      const options = { candleTimes: bars.map((bar) => bar.time) };
      const marks = buildMarks(derived, facts, timeframe, "medium", false, options);
      assert.deepEqual(readableMarks(marks), expected[key]);
      for (const mark of marks) {
        const times = "t" in mark ? [mark.t] : "anchor" in mark ? [mark.anchor.t] : [mark.t0, mark.t1];
        assert.ok(times.every((time) => options.candleTimes.includes(time)), JSON.stringify(mark));
      }
    });
  }
}

function setup(name: string) {
  const derived = deriveTrade(fixture(name));
  const bars = examples[name];
  return { derived, facts: observeTrade(derived, bars, 1), options: { candleTimes: bars.map((bar) => bar.time) } };
}

test("B-23 and OD-28 anchor a fill inside its bar, mark a nearby fallback, and omit unresolved geometry", () => {
  const { derived } = setup("ex-tp");
  const marks = (times: string[]) => buildMarks(derived, null, "1m", "medium", false, { candleTimes: times.map(utc) });
  const entry = (items: Mark[]) => items.find((mark) => mark.kind === "flag" && mark.shape === "arrow_up");
  const containing = entry(marks(["15:33", "15:34", "15:52"]));
  assert.ok(containing?.kind === "flag");
  assert.equal(containing.t, utc("15:34"));
  assert.equal(containing.approximate, undefined);
  const nearby = entry(marks(["15:33", "15:52"]));
  assert.ok(nearby?.kind === "flag");
  assert.equal(nearby.t, utc("15:33"));
  assert.equal(nearby.approximate, true);
  const unresolved = marks(["15:52"]);
  assert.equal(entry(unresolved), undefined);
  assert.ok(!unresolved.some((mark) => mark.kind === "zone"));
  assert.deepEqual(marks([]), []);
});

test("each observer finding keeps its exact bar, price, and basis, and a missing bar cannot be substituted", () => {
  const { derived, options } = setup("ex-sl");
  const bars = examples["ex-sl"].map((bar) => bar.time === utc("15:41")
    ? { ...bar, open: 7592, low: 7592, close: 7593, high: 7593 } : bar);
  const facts = observeTrade(derived, bars);
  const findings = buildMarks(derived, facts, "1m", "medium", false, options)
    .flatMap((mark) => mark.kind === "flag" && mark.finding
      ? [{ ...mark.finding, price: mark.price, basis: mark.basis, barTime: mark.t }] : []);
  assert.equal(findings.length, 3);
  assert.deepEqual(findings, facts.findings);
  const without = buildMarks(derived, facts, "1m", "medium", false, { candleTimes: [utc("15:36"), utc("15:41")] });
  assert.ok(!without.some((mark) => mark.kind === "flag" && mark.finding?.code === "stop_traded_through"));
});

test("target exit flags use linked plan keys even when working prices change", () => {
  const doc = fixture("ex-partials");
  const [plan, entry, partial, stopMove, exit] = doc.events;
  assert.ok(partial.type === "fill" && exit.type === "fill");
  doc.events = [
    plan, entry,
    { seq: 3, t: "2026-11-12T15:38:00Z", type: "order", role: "target", kind: "limit", order: "first",
      target: "t1", qty: 1, price: 7605, basis: "broker" },
    { seq: 4, t: "2026-11-12T15:38:00Z", type: "order", role: "target", kind: "limit", order: "t2",
      qty: 1, price: 7612.5, basis: "broker" },
    { ...partial, seq: 5, order: "first", basis: "broker" },
    { ...stopMove, seq: 6 },
    { seq: 7, t: "2026-11-12T15:44:00Z", type: "modify", order: "t2", price: 7605, basis: "broker" },
    { ...exit, seq: 8, order: "t2", price: 7605, basis: "broker" },
  ];
  const { options } = setup("ex-partials");
  const marks = buildMarks(deriveTrade(doc), null, "1m", "medium", false, options);
  const flags = marks.flatMap((mark) => mark.kind === "flag" && mark.shape === "triangle_down"
    ? [[mark.t, mark.text, mark.basis]] : []);
  assert.deepEqual(flags, [[utc("15:42"), "T1", "broker"], [utc("16:05"), "T2", "broker"]]);
});

test("UTC anchors disambiguate the two 01:30 times during Central fall-back", () => {
  const doc = fixture("ex-be");
  doc.events = [
    { seq: 1, t: "2026-11-01T06:30:42Z", type: "fill", role: "entry", price: 7600, qty: 1, basis: "stated" },
    { seq: 2, t: "2026-11-01T07:30:18Z", type: "fill", role: "exit", price: 7605, qty: 1, basis: "stated" },
  ];
  const candleTimes = ["2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z"].map(Date.parse);
  const marks = buildMarks(deriveTrade(doc), null, "5m", "medium", false, { candleTimes });
  const band = marks.find((mark) => mark.kind === "zone");
  assert.ok(band);
  assert.deepEqual([band.t0, band.t1], candleTimes);
});

test("the past-stop hatch starts at the moved stop and keeps a manual comparison inferred", () => {
  const doc = fixture("ex-be");
  doc.events = doc.events.map((event): TradeEvent => {
    if (event.type === "modify") return { ...event, price: 7597 };
    if (event.type === "fill" && event.role === "exit") return { ...event, price: 7594, reason: "manual" };
    return event;
  });
  const { options } = setup("ex-be");
  const marks = buildMarks(deriveTrade(doc), null, "1m", "medium", false, options);
  const hatch = marks.find((mark) => mark.kind === "hatch");
  assert.ok(hatch);
  assert.deepEqual([hatch.p0, hatch.p1, hatch.basis, hatch.label], [7597, 7594, "inferred", "≈ PAST STOP −0.6R"]);
});

test("an explicit cancelled entry spans the working order and creates no execution geometry", () => {
  const doc = fixture("ex-nottaken");
  const plan = doc.events[0];
  assert.ok(plan.type === "plan");
  doc.events = [
    plan,
    { seq: 2, t: "2026-11-12T15:35:00Z", type: "order", order: "o1", role: "entry", kind: "limit",
      price: plan.entry.price, qty: plan.qty, basis: "broker" },
    { seq: 3, t: "2026-11-12T15:45:00Z", type: "cancel", order: "o1", basis: "broker" },
  ];
  const marks = buildMarks(deriveTrade(doc), null, "1m", "medium", false, {
    candleTimes: ["15:31", "15:35", "15:45", "15:50"].map(utc),
  });
  assert.ok(marks.some((mark) => mark.kind === "label" && mark.text === "PLAN · cancelled" && mark.basis === "broker"));
  const zones = marks.filter((mark) => mark.kind === "zone");
  assert.equal(zones.length, 2);
  assert.ok(zones.every((mark) => mark.layer === "plan" && mark.t0 === utc("15:35") && mark.t1 === utc("15:45")));
  assert.ok(!marks.some((mark) => mark.kind === "flag"));
});

test("a scale-in ends the locked-profit hatch when the unchanged stop falls below the open average", () => {
  const doc = fixture("ex-be");
  const [plan, entry, move] = doc.events;
  assert.ok(move.type === "modify");
  doc.events = [
    plan, entry, { ...move, price: 7601 },
    { seq: 4, t: "2026-11-12T15:45:00Z", type: "fill", role: "entry", price: 7604, qty: 2, basis: "stated" },
  ];
  const derived = deriveTrade(doc);
  assert.equal(derived.avg_entry_price, 7602);
  const marks = buildMarks(derived, null, "1m", "medium", false, {
    candleTimes: ["15:34", "15:44", "15:45", "15:50"].map(utc),
  });
  const hatches = marks.filter((mark) => mark.kind === "hatch");
  assert.deepEqual(hatches.map(({ t0, t1, p0, p1 }) => [t0, t1, p0, p1]), [
    [utc("15:44"), utc("15:45"), 7600, 7601],
  ]);
});

test("D-010 and OD-32 bound default hindsight to Medium detail and the last visible real bar", () => {
  const { derived, facts, options } = setup("ex-tp");
  const marks = (detail: "low" | "medium" | "high", viewRightTime: number, showContinuation?: boolean) =>
    buildMarks(derived, facts, "1m", detail, false, { ...options, viewRightTime, showContinuation });
  const entryContinuation = (items: Mark[]) => items.find((mark) =>
    mark.kind === "segment" && mark.t0 === utc("15:52") && mark.tone === "muted" && mark.faint);
  const line = entryContinuation(marks("medium", utc("15:55:31")));
  assert.ok(line?.kind === "segment");
  assert.equal(line.t1, utc("15:55"));
  assert.equal(entryContinuation(marks("low", utc("16:15"))), undefined);
  assert.equal(entryContinuation(marks("high", utc("16:15"), true)), undefined);
  assert.equal(entryContinuation(marks("medium", utc("16:15"), false)), undefined);
  const clipped = marks("medium", utc("15:54"));
  assert.equal(entryContinuation(clipped), undefined);
  assert.ok(!clipped.some((mark) => mark.kind === "flag" && mark.hollow && mark.t === utc("15:55")));
});

test("Shield hides counts and quantities and retains R, and archive emits actual geometry alone", () => {
  const { derived, facts, options } = setup("ex-partials");
  const planLabels = (shield: boolean) => buildMarks(derived, facts, "1m", "medium", shield, options)
    .flatMap((mark) => mark.kind === "zone" && mark.label ? [mark.label] : []);
  assert.deepEqual(planLabels(false), ["T1 1.0R · 1 of 2", "T2 2.5R · 1 of 2"]);
  assert.deepEqual(planLabels(true), ["T1 1.0R", "T2 2.5R"]);
  const archive = buildMarks(derived, facts, "1m", "medium", true, { ...options, archived: true });
  assert.equal(archive.length, 2);
  assert.ok(archive.every((mark) => mark.kind === "zone" && mark.layer === "archived" && mark.style === "dotted"));
  const ignored = setup("ex-ignored");
  assert.ok(buildMarks(ignored.derived, ignored.facts, "1m", "medium", true, ignored.options)
    .some((mark) => mark.kind === "hatch" && mark.label === "PAST STOP −0.6R"));
});

test("same-bar scale fills collapse, retain the right arrow and expose their fill count only with Shield off", () => {
  const doc = fixture("ex-partials");
  doc.side = "short";
  doc.events = [
    { seq: 1, t: "2026-11-12T15:34:05Z", type: "fill", role: "entry", price: 7600, qty: 1, basis: "stated" },
    { seq: 2, t: "2026-11-12T15:34:45Z", type: "fill", role: "entry", price: 7601, qty: 2, basis: "stated" },
    { seq: 3, t: "2026-11-12T15:42:18Z", type: "fill", role: "exit", price: 7595, qty: 1, basis: "stated", reason: "manual" },
    { seq: 4, t: "2026-11-12T15:42:21Z", type: "fill", role: "exit", price: 7594, qty: 2, basis: "stated", reason: "manual" },
  ];
  const derived = deriveTrade(doc);
  const bars = candles([["15:34", 7598, 7602], ["15:35", 7599, 7603], ["15:36", 7597, 7602], ["15:42", 7592, 7596]]);
  const facts = observeTrade(derived, bars);
  const marks = (shield: boolean) =>
    buildMarks(derived, facts, "1m", "medium", shield, { candleTimes: bars.map((bar) => bar.time) });
  const flags = (items: Mark[]) => items.flatMap((mark) =>
    mark.kind === "flag" && mark.shape !== "dot" ? [[mark.shape, mark.price, mark.text]] : []);
  assert.deepEqual(flags(marks(false)), [["arrow_down", 7600, "×2"], ["triangle_up", 7595, "MKT ×2"]]);
  assert.deepEqual(flags(marks(true)), [["arrow_down", 7600, ""], ["triangle_up", 7595, "MKT"]]);
  const bracket = marks(true).find((mark) => mark.kind === "bracket");
  assert.ok(bracket);
  assert.equal(bracket.pLow, 7594);
  assert.equal(bracket.pHigh, 7603);
  assert.ok(bracket.pMid > bracket.pLow && bracket.pMid < bracket.pHigh);
  assert.deepEqual(bracket.labels, { low: "MFE ≈ +6.67 pts", high: "MAE ≈ −2.33 pts" });
});
