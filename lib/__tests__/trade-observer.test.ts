import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveTrade } from "../trade-document.ts";
import type { TradeDocument } from "../trade-document.ts";
import { observeTrade } from "../trade-bar-validation.ts";
import type { TradeBarFinding } from "../trade-bar-validation.ts";
import { DEFAULT_TICK_TOLERANCE_TICKS } from "../trades.ts";
import type { Candle } from "../trades.ts";

function fixture(name: string): TradeDocument {
  return JSON.parse(readFileSync(new URL(`../../fixtures/trades/${name}.json`, import.meta.url), "utf8"));
}

type BarInput = [time: string, low: number, high: number];

function utc(time: string) {
  return Date.parse(time.includes("T") ? time : `2026-11-12T${time}:00Z`);
}

function bars(inputs: BarInput[]): Candle[] {
  return inputs.map(([time, low, high]) => ({ time: utc(time), low, high, open: low, close: high, volume: 1 }));
}

function finding(code: TradeBarFinding["code"], time: string, price: number, segment: number | string): TradeBarFinding {
  return { code, barTime: utc(time), price, segment, basis: "inferred" };
}

const golden: Array<{
  name: string;
  candles: BarInput[];
  findings: TradeBarFinding[];
  excursions: [mae: number, mfe: number] | null;
}> = [
  {
    name: "ex-tp",
    candles: [["15:34", 7599, 7602], ["15:35", 7597, 7608], ["15:36", 7598, 7609], ["15:52", 7594, 7610]],
    findings: [],
    excursions: [7597, 7610],
  },
  {
    name: "ex-sl",
    candles: [["15:34", 7598, 7601], ["15:35", 7594, 7603], ["15:36", 7600, 7611], ["15:41", 7595, 7596]],
    findings: [finding("stop_traded_through", "15:35", 7595, 0), finding("target_traded_through", "15:36", 7610, "t1")],
    excursions: [7594, 7611],
  },
  {
    name: "ex-be",
    candles: [["15:34", 7598, 7602], ["15:43", 7597, 7599], ["15:44", 7599, 7605], ["15:49", 7599, 7600]],
    findings: [finding("stop_traded_through", "15:44", 7600, 1)],
    excursions: [7597, 7605],
  },
  {
    name: "ex-trail",
    candles: [
      ["15:34", 7593, 7600], ["15:35", 7594, 7600], ["15:47", 7594, 7602], ["15:48", 7600, 7604],
      ["15:58", 7594, 7607], ["15:59", 7605, 7607], ["16:03", 7604, 7608],
    ],
    findings: [
      finding("stop_traded_through", "15:35", 7595, 0),
      finding("stop_traded_through", "15:48", 7601, 1),
      finding("stop_traded_through", "15:59", 7606, 2),
    ],
    excursions: [7593, 7607],
  },
  {
    name: "ex-ignored",
    candles: [
      ["15:34", 7593, 7600], ["15:35", 7598, 7603], ["15:39", 7592, 7599], ["15:40", 7592, 7599],
      ["15:46", 7592, 7600], ["15:47", 7590, 7600],
    ],
    findings: [],
    excursions: [7592, 7603],
  },
  {
    name: "ex-nottaken",
    candles: [["15:34", 7593, 7611], ["15:39", 7595, 7600], ["16:11", 7590, 7620]],
    findings: [],
    excursions: null,
  },
  {
    name: "ex-partials",
    candles: [["15:34", 7598, 7602], ["15:42", 7603, 7605], ["15:44", 7602, 7611], ["16:05", 7600, 7612.5]],
    findings: [],
    excursions: [7598, 7612.5],
  },
];

for (const { name, candles, findings, excursions } of golden) {
  test(`observer golden facts for ${name}`, () => {
    const derived = deriveTrade(fixture(name));
    const result = observeTrade(derived, bars(candles).reverse());
    assert.deepEqual(result.findings, findings);
    assert.deepEqual(result.excursions,
      excursions ? { maePrice: excursions[0], mfePrice: excursions[1], coverage: "partial" } : null);
    assert.equal(result.coverage, name === "ex-nottaken" ? "missing" : "partial");
    assert.equal(result.hindsight.last_stop_touch, null);
    const empty = observeTrade(derived, []);
    assert.equal(empty.coverage, "missing");
    assert.deepEqual(empty.findings, []);
    assert.equal(empty.excursions, null);
  });
}

test("fill alignment uses the shared four-tick threshold and skips voided executions", () => {
  assert.equal(DEFAULT_TICK_TOLERANCE_TICKS, 4);
  const doc = fixture("ex-tp");
  doc.events.push(
    { seq: 9, t: "2026-11-12T15:35:00Z", type: "fill", role: "exit", qty: 2, price: 7700, basis: "broker" },
    { seq: 10, t: "2026-11-12T15:36:00Z", type: "void", ref: 9, basis: "broker" },
  );
  const result = observeTrade(deriveTrade(doc), bars([
    ["15:34", 7598, 7599], ["15:35", 7598, 7601], ["15:52", 7608, 7608.75],
  ]));
  assert.deepEqual(result.findings, [finding("fill_outside_bar", "15:52", 7610, 7)]);
});

test("four decimal ticks count as inside the bar at the exact tolerance boundary", () => {
  const doc = fixture("ex-sl");
  doc.instrument.symbol = "MCL";
  doc.events = [
    { seq: 1, t: "2026-11-12T15:34:00Z", type: "fill", role: "entry", qty: 1, price: 60.02, basis: "stated" },
    { seq: 2, t: "2026-11-12T15:41:00Z", type: "fill", role: "exit", qty: 1, price: 60.03, basis: "stated" },
  ];
  const result = observeTrade(deriveTrade(doc), bars([["15:34", 59.96, 59.98], ["15:41", 59.96, 59.98]]));
  assert.deepEqual(result.findings, [finding("fill_outside_bar", "15:41", 60.03, 2)]);
});

test("a stop working before entry can only be crossed while the trade is open", () => {
  const doc = fixture("ex-tp");
  const [stop] = doc.events.splice(3, 1);
  stop.t = "2026-11-12T15:31:30Z";
  doc.events.splice(2, 0, stop);
  doc.events.forEach((event, index) => { event.seq = index + 1; });
  const derived = deriveTrade(doc);
  assert.equal(derived.stop_path[0].from, stop.t);
  const result = observeTrade(derived, bars([
    ["15:32", 7594, 7600], ["15:34", 7594, 7600], ["15:35", 7594, 7601], ["15:36", 7593, 7601],
  ]));
  assert.deepEqual(result.findings, [finding("stop_traded_through", "15:35", 7595, 0)]);
});

test("a bar during a flat gap after a full exit cannot prove a later position crossed its stop", () => {
  const doc = fixture("ex-sl");
  doc.events.push(
    { seq: 5, t: "2026-11-12T15:44:00Z", type: "order", role: "stop", kind: "stop", order: "second-stop", qty: 2, price: 7595, basis: "broker" },
    { seq: 6, t: "2026-11-12T15:46:00Z", type: "fill", role: "entry", qty: 2, price: 7600, basis: "broker" },
    { seq: 7, t: "2026-11-12T15:48:00Z", type: "fill", role: "exit", qty: 2, price: 7600, basis: "broker" },
  );
  const result = observeTrade(deriveTrade(doc), bars([
    ["15:44", 7594, 7611], ["15:45", 7510, 7700], ["15:46", 7598, 7601], ["15:47", 7597, 7601],
  ]));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.excursions, { maePrice: 7595, mfePrice: 7601, coverage: "partial" });
});

test("an open trade uses completed bars and keeps its newest bar and excursions provisional", () => {
  const doc = fixture("ex-sl");
  doc.events = doc.events.filter((event) => event.type !== "fill" || event.role !== "exit");
  const result = observeTrade(deriveTrade(doc), bars([
    ["15:34", 7598, 7601], ["15:35", 7594, 7600], ["15:36", 7600, 7611],
  ]));
  assert.equal(result.coverage, "partial");
  assert.equal(result.excursions, null);
  assert.deepEqual(result.findings, [finding("stop_traded_through", "15:35", 7595, 0)]);
});

test("an open trade waits for the fill bar to complete before flagging its range", () => {
  const doc = fixture("ex-sl");
  doc.events.pop();
  const derived = deriveTrade(doc);
  const prices = bars([["15:34", 7597, 7598]]);
  assert.deepEqual(observeTrade(derived, prices).findings, []);
  prices.push(...bars([["15:35", 7599, 7601]]));
  assert.deepEqual(observeTrade(derived, prices).findings, [finding("fill_outside_bar", "15:34", 7600, 2)]);
});

test("target fills count by order and remaining quantity, and reprices stay local to their own span", () => {
  const doc = fixture("ex-partials");
  const plan = doc.events[0];
  assert.equal(plan.type, "plan");
  plan.targets = [{ key: "t1", price: 7605, qty: 2 }];
  const [planEvent, entryEvent, partial, stopMove, exit] = doc.events;
  assert.equal(partial.type, "fill");
  doc.events = [
    planEvent, entryEvent,
    { seq: 3, t: "2026-11-12T15:38:00Z", type: "order", role: "target", kind: "limit", order: "order-1", target: "t1", qty: 2, price: 7605, basis: "broker" },
    { ...partial, seq: 4, order: "order-1", price: 7605.25 },
    { ...stopMove, seq: 5 },
    { seq: 6, t: "2026-11-12T15:45:30Z", type: "modify", order: "order-1", price: 7610, basis: "broker" },
    { ...exit, seq: 7 },
  ];
  const derived = deriveTrade(doc);
  const prices = bars([
    ["15:37", 7602, 7612], ["15:42", 7601, 7606], ["15:45", 7601, 7612], ["15:47", 7601, 7611],
  ]);
  assert.deepEqual(observeTrade(derived, prices).findings, [
    finding("target_traded_through", "15:42", 7605, "t1"),
    finding("target_traded_through", "15:47", 7610, "t1"),
  ]);

  assert.equal(exit.type, "fill");
  doc.events[6] = { ...exit, seq: 7, order: "order-1", price: 7610.25 };
  assert.deepEqual(observeTrade(deriveTrade(doc), prices).findings, [finding("target_traded_through", "15:42", 7605, "t1")]);
});

test("a planned target with only part of its quantity executed is still checked", () => {
  const doc = fixture("ex-partials");
  const plan = doc.events[0];
  assert.equal(plan.type, "plan");
  plan.targets = [{ key: "all", price: 7605, qty: 2 }];
  const result = observeTrade(deriveTrade(doc), bars([["15:38", 7601, 7605]]));
  assert.deepEqual(result.findings, [finding("target_traded_through", "15:38", 7605, "all")]);
});

test("one anonymous execution at a shared target price consumes only its recorded quantity", () => {
  const doc = fixture("ex-partials");
  const plan = doc.events[0];
  assert.equal(plan.type, "plan");
  plan.targets[1].price = plan.targets[0].price;
  const result = observeTrade(deriveTrade(doc), bars([["15:38", 7601, 7605]]));
  assert.deepEqual(result.findings, [finding("target_traded_through", "15:38", 7605, "t2")]);
});

test("an anonymous target execution at the working price clears that quantity", () => {
  const doc = fixture("ex-tp");
  const exit = doc.events[6];
  assert.equal(exit.type, "fill");
  delete exit.order;
  const prices = bars([["15:40", 7600, 7611]]);
  assert.deepEqual(observeTrade(deriveTrade(doc), prices).findings, []);
});

test("anonymous fills are allocated to working orders in plan order and can span orders", () => {
  const doc = fixture("ex-partials");
  const [plan, entry, partial, move, exit] = doc.events;
  assert.equal(plan.type, "plan");
  assert.equal(partial.type, "fill");
  assert.equal(exit.type, "fill");
  plan.targets[1].price = plan.targets[0].price;
  doc.events = [
    plan, entry,
    { seq: 3, t: "2026-11-12T15:37:00Z", type: "order", role: "target", kind: "limit", order: "second", target: "t2", qty: 1, price: 7605, basis: "broker" },
    { seq: 4, t: "2026-11-12T15:37:00Z", type: "order", role: "target", kind: "limit", order: "first", target: "t1", qty: 1, price: 7605, basis: "broker" },
    { ...partial, seq: 5 },
    { ...move, seq: 6 },
    { ...exit, seq: 7, reason: "manual" },
  ];
  const prices = bars([["15:38", 7601, 7605]]);
  assert.deepEqual(observeTrade(deriveTrade(doc), prices).findings, [
    finding("target_traded_through", "15:38", 7605, "t2"),
  ]);

  doc.events = doc.events.slice(0, 5);
  doc.events[4] = { ...partial, seq: 5, qty: 2 };
  assert.deepEqual(observeTrade(deriveTrade(doc), prices).findings, []);
});

test("an order's explicit target takes precedence over same-price fallback", () => {
  const doc = fixture("ex-partials");
  const [plan, entry, partial, move, exit] = doc.events;
  assert.equal(plan.type, "plan");
  assert.equal(partial.type, "fill");
  plan.targets[1].price = plan.targets[0].price;
  doc.events = [
    plan, entry,
    { seq: 3, t: "2026-11-12T15:37:00Z", type: "order", role: "target", kind: "limit", order: "anonymous", qty: 1, price: 7605, basis: "broker" },
    { seq: 4, t: "2026-11-12T15:37:00Z", type: "order", role: "target", kind: "limit", order: "explicit", target: "t1", qty: 1, price: 7605, basis: "broker" },
    { ...partial, seq: 5, order: "explicit" },
    { ...move, seq: 6 },
    { ...exit, seq: 7 },
  ];
  assert.deepEqual(observeTrade(deriveTrade(doc), bars([["15:38", 7601, 7605]])).findings, [
    finding("target_traded_through", "15:38", 7605, "t2"),
  ]);
});

test("a 5m scalp reports alignment without using the entry/exit wick as an excursion", () => {
  const doc = fixture("ex-sl");
  doc.events[3].t = "2026-11-12T15:34:40Z";
  const result = observeTrade(deriveTrade(doc), bars([["15:30", 7500, 7700]]), 5);
  assert.equal(result.coverage, "complete");
  assert.equal(result.chronology, "unresolved");
  assert.equal(result.excursions, null);
  assert.deepEqual(result.findings, []);
});

test("an exact bar-open entry counts and an exact bar-open exit excludes that entire candle", () => {
  const doc = fixture("ex-sl");
  doc.events[3].t = "2026-11-12T15:36:00Z";
  const result = observeTrade(deriveTrade(doc), bars([
    ["15:34", 7599, 7607], ["15:35", 7598, 7603], ["15:36", 7500, 7700],
  ]));
  assert.equal(result.coverage, "complete");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.excursions, { maePrice: 7595, mfePrice: 7607, coverage: "complete" });
});

test("a short uses lows for its target and MFE and highs for its stop and MAE", () => {
  const doc = fixture("ex-sl");
  doc.side = "short";
  const plan = doc.events[0];
  const exit = doc.events[3];
  assert.equal(plan.type, "plan");
  assert.equal(exit.type, "fill");
  plan.stop = 7605;
  plan.targets = [{ key: "t1", price: 7590, qty: 2 }];
  exit.price = 7605;
  const result = observeTrade(deriveTrade(doc), bars([
    ["15:34", 7599, 7601], ["15:35", 7595, 7606], ["15:36", 7589, 7601], ["15:41", 7600, 7605],
  ]));
  assert.deepEqual(result.excursions, { maePrice: 7606, mfePrice: 7589, coverage: "partial" });
  assert.deepEqual(result.findings, [
    finding("stop_traded_through", "15:35", 7605, 0),
    finding("target_traded_through", "15:36", 7590, "t1"),
  ]);
});

test("hindsight keeps the last stop in force and each target separate from trade facts", () => {
  const doc = fixture("ex-partials");
  const result = observeTrade(deriveTrade(doc), bars([
    ["16:05", 7597, 7615], ["16:07", 7601, 7605], ["16:08", 7599, 7602], ["16:10", 7601, 7613],
  ]));
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.hindsight, {
    last_stop_touch: { kind: "stop", time: utc("16:08"), delayMs: 180_000, price: 7600 },
    target_touches: [
      { kind: "target", time: utc("16:07"), delayMs: 120_000, price: 7605, target: "t1" },
      { kind: "target", time: utc("16:10"), delayMs: 300_000, price: 7612.5, target: "t2" },
    ],
  });
});

for (const close of ["2026-03-06T22:00:00Z", "2026-03-09T21:00:00Z", "2026-10-30T21:00:00Z", "2026-11-02T22:00:00Z"]) {
  test(`hindsight stops at New York session close ${close} around a DST weekend`, () => {
    const doc = fixture("ex-sl");
    const closeMs = utc(close);
    const minute = 60_000;
    const iso = (offset: number) => new Date(closeMs + offset * minute).toISOString();
    doc.events.forEach((event, index) => { event.t = iso(index - 6); });
    const result = observeTrade(deriveTrade(doc), bars([
      [iso(-3), 7590, 7610], [iso(-2), 7594, 7602], [iso(0), 7594, 7611], [iso(120), 7594, 7611],
    ]));
    assert.equal(result.hindsight.last_stop_touch?.time, closeMs - 2 * minute);
    assert.deepEqual(result.hindsight.target_touches, []);
  });
}
