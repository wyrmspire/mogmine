// Golden tests for mogmine.trade.v1, deriveTrade, and fromLegacy (issue #33, docs/15 §3).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { demoTrades } from "../fixtures.ts";
import {
  TRADE_DOC_SCHEMA,
  deriveTrade,
  fromLegacy,
  isTradeDocument,
} from "../trade-document.ts";
import type { TradeDocument, TradeEvent } from "../trade-document.ts";
import {
  FUTURES_SPECS,
  initialRMultiple,
  isScratch,
  normalizeTrade,
  rMultiple,
  specFor,
  tradePnl,
  tradePoints,
  tradeTicks,
} from "../trades.ts";

function loadFixture(name: string): TradeDocument {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL(`../../fixtures/trades/${name}.json`, import.meta.url), "utf8"),
  );
  assert.ok(isTradeDocument(parsed), `${name}.json must be a valid mogmine.trade.v1 document`);
  return parsed;
}

function makeDoc(events: TradeEvent[], patch: Partial<TradeDocument> = {}): TradeDocument {
  return {
    schema: TRADE_DOC_SCHEMA,
    id: "test-doc",
    user_id: "00000000-0000-0000-0000-000000000000",
    revision: 1,
    instrument: { symbol: "MES", contract: null },
    side: "long",
    source: { kind: "manual", provider: null, imported_at: null },
    is_sample: true,
    events,
    ...patch,
  };
}

// --- Seven golden fixtures (docs/15 §3.5) ---

test("fixture 1 (ex-tp): TP hit, +2.0R, +$100.00, working entry order, clean stop path", () => {
  const derived = deriveTrade(loadFixture("ex-tp"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "target");
  assert.equal(derived.outcome_basis, "broker");
  assert.equal(derived.max_size, 2);
  assert.equal(derived.avg_entry_price, 7600);
  assert.equal(derived.avg_exit_price, 7610);
  assert.equal(derived.ticks, 40);
  assert.equal(derived.contract_ticks, 80);
  assert.equal(derived.points, 10);
  assert.equal(derived.pnl_cents, 10_000);
  assert.equal(derived.pnl_usd, 100);
  assert.equal(derived.fees_cents, 0);
  assert.equal(derived.initial_stop?.price, 7595);
  assert.equal(derived.initial_risk_usd, 50);
  assert.equal(derived.r_multiple, 2);
  assert.equal(derived.is_scratch, false);
  assert.equal(derived.planned_targets.length, 1);
  assert.equal(derived.planned_targets[0].planned_r, 2);
  assert.equal(derived.planned_r, 2);
  assert.equal(derived.stop_path.length, 1);
  assert.equal(derived.stop_path[0].from, "2026-11-12T15:34:42Z");
  assert.equal(derived.stop_path[0].to, "2026-11-12T15:52:18Z");
  assert.equal(derived.stop_path[0].order, "o2");
  assert.equal(derived.stop_path[0].price, 7595);
  // Working entry order span 15:31:10 -> 15:34:42
  const entryWork = derived.working_orders.find((w) => w.role === "entry");
  assert.equal(entryWork?.from, "2026-11-12T15:31:10Z");
  assert.equal(entryWork?.to, "2026-11-12T15:34:42Z");
  assert.equal(entryWork?.end_reason, "filled");
  assert.deepEqual(derived.facts, []);
  assert.deepEqual(derived.errors, []);
});

test("fixture 2 (ex-sl): SL hit, -1.0R, -$50.00, manual stop from plan", () => {
  const derived = deriveTrade(loadFixture("ex-sl"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "stop");
  assert.equal(derived.outcome_basis, "stated");
  assert.equal(derived.ticks, -20);
  assert.equal(derived.points, -5);
  assert.equal(derived.pnl_cents, -5_000);
  assert.equal(derived.pnl_usd, -50);
  assert.equal(derived.initial_risk_usd, 50);
  assert.equal(derived.r_multiple, -1);
  assert.equal(derived.is_scratch, false);
  assert.equal(derived.stop_path.length, 1);
  assert.equal(derived.stop_path[0].order, "stop");
  assert.equal(derived.stop_path[0].price, 7595);
  assert.equal(derived.stop_path[0].end_reason, "filled");
  assert.deepEqual(derived.facts, []);
  assert.deepEqual(derived.errors, []);
});

test("fixture 3 (ex-be): breakeven scratch, +0.0R, stepped stop path to entry", () => {
  const derived = deriveTrade(loadFixture("ex-be"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "scratch");
  assert.equal(derived.ticks, 0);
  assert.equal(derived.points, 0);
  assert.equal(derived.pnl_cents, 0);
  assert.equal(derived.pnl_usd, 0);
  assert.equal(derived.initial_stop?.price, 7595);
  assert.equal(derived.r_multiple, 0);
  assert.equal(derived.is_scratch, true);
  assert.equal(derived.stop_move_count, 1);
  assert.equal(derived.stop_widened, false);
  assert.equal(derived.stop_path.length, 2);
  assert.equal(derived.stop_path[0].price, 7595);
  assert.equal(derived.stop_path[0].to, "2026-11-12T15:44:00Z");
  assert.equal(derived.stop_path[1].price, 7600);
  assert.equal(derived.stop_path[1].from, "2026-11-12T15:44:00Z");
  assert.equal(derived.stop_path[1].to, "2026-11-12T15:49:00Z");
  assert.equal(derived.stop_path[1].locked_profit, true);
  assert.deepEqual(derived.errors, []);
});

test("fixture 4 (ex-trail): trailed stop, +1.2R against initial 5pt stop, 3 stop segments, no target invented", () => {
  const derived = deriveTrade(loadFixture("ex-trail"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "trail");
  assert.equal(derived.outcome_basis, "broker");
  assert.equal(derived.ticks, 24);
  assert.equal(derived.points, 6);
  assert.equal(derived.pnl_cents, 6_000);
  assert.equal(derived.pnl_usd, 60);
  assert.equal(derived.initial_stop?.price, 7595);
  assert.equal(derived.initial_risk_usd, 50);
  assert.equal(derived.r_multiple, 1.2);
  assert.equal(derived.stop_move_count, 2);
  assert.equal(derived.stop_widened, false);
  assert.equal(derived.stop_path.length, 3);
  assert.deepEqual(
    derived.stop_path.map((s) => ({ price: s.price, locked: s.locked_profit, widened: s.widened })),
    [
      { price: 7595, locked: false, widened: false },
      { price: 7601, locked: true, widened: false },
      { price: 7606, locked: true, widened: false },
    ],
  );
  assert.equal(derived.plan, null);
  assert.deepEqual(derived.planned_targets, []);
  assert.deepEqual(derived.errors, []);
});

test("fixture 5 (ex-ignored): stop cancelled while open at 15:39:20, manual exit at -1.6R, past-stop -0.6R", () => {
  const derived = deriveTrade(loadFixture("ex-ignored"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "manual");
  assert.equal(derived.outcome_basis, "broker");
  assert.equal(derived.ticks, -32);
  assert.equal(derived.points, -8);
  assert.equal(derived.pnl_cents, -8_000);
  assert.equal(derived.pnl_usd, -80);
  assert.equal(derived.initial_stop?.price, 7595);
  assert.equal(derived.initial_risk_usd, 50);
  assert.equal(derived.r_multiple, -1.6);
  assert.equal(derived.stop_path.length, 1);
  assert.equal(derived.stop_path[0].to, "2026-11-12T15:39:20Z");
  assert.equal(derived.stop_path[0].end_reason, "cancelled");
  const removed = derived.facts.find((f) => f.code === "stop_removed_while_open");
  assert.ok(removed, "must report stop_removed_while_open fact");
  assert.equal(removed.t, "2026-11-12T15:39:20Z");
  assert.equal(removed.price, 7595);
  const pastStop = derived.facts.find((f) => f.code === "exit_past_stop");
  assert.ok(pastStop, "must report exit_past_stop fact");
  assert.equal(pastStop.extra_r, -0.6);
  assert.deepEqual(derived.errors, []);
});

test("fixture 6 (ex-nottaken): planned, not taken — no result, no R, planned target R preserved", () => {
  const derived = deriveTrade(loadFixture("ex-nottaken"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "not_taken");
  assert.equal(derived.outcome, "not_taken");
  assert.equal(derived.max_size, 0);
  assert.equal(derived.entry_time, null);
  assert.equal(derived.exit_time, null);
  assert.equal(derived.ticks, null);
  assert.equal(derived.points, null);
  assert.equal(derived.pnl_cents, null);
  assert.equal(derived.pnl_usd, null);
  assert.equal(derived.r_multiple, null);
  assert.equal(derived.is_scratch, false);
  assert.deepEqual(derived.stop_path, []);
  assert.equal(derived.planned_targets.length, 1);
  assert.equal(derived.planned_targets[0].planned_r, 2);
  assert.deepEqual(derived.errors, []);
});

test("fixture 7 (ex-partials): two partial targets, +$87.50, +1.75R, T1 1.0R and T2 2.5R, stop moved to BE", () => {
  const derived = deriveTrade(loadFixture("ex-partials"), FUTURES_SPECS.MES);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "partial_targets");
  assert.equal(derived.outcome_basis, "stated");
  assert.equal(derived.max_size, 2);
  assert.equal(derived.closed_lots.length, 2);
  assert.equal(derived.closed_lots[0].pnl_cents, 2_500);
  assert.equal(derived.closed_lots[1].pnl_cents, 6_250);
  assert.equal(derived.contract_ticks, 70);
  assert.equal(derived.ticks, 35);
  assert.equal(derived.points, 8.75);
  assert.equal(derived.pnl_cents, 8_750);
  assert.equal(derived.pnl_usd, 87.5);
  assert.equal(derived.initial_risk_usd, 50);
  assert.equal(derived.r_multiple, 1.75);
  assert.deepEqual(
    derived.planned_targets.map((t) => ({ key: t.key, qty: t.qty, planned_r: t.planned_r })),
    [
      { key: "t1", qty: 1, planned_r: 1 },
      { key: "t2", qty: 1, planned_r: 2.5 },
    ],
  );
  assert.equal(derived.planned_r, 1.75);
  assert.equal(derived.stop_path.length, 2);
  assert.equal(derived.stop_path[0].price, 7595);
  assert.equal(derived.stop_path[1].price, 7600);
  assert.equal(derived.stop_path[1].from, "2026-11-12T15:42:00Z");
  assert.equal(derived.stop_path[1].to, "2026-11-12T16:05:00Z");
  assert.deepEqual(derived.errors, []);
});

// --- Scratch rule: 0.1R or 2 ticks, whichever is larger (D-010) ---

test("scratch threshold: 0.1R governs on wide stop (40 ticks -> 4-tick threshold)", () => {
  const build = (exitPrice: number) =>
    deriveTrade(
      makeDoc([
        {
          seq: 1,
          t: "2026-11-12T15:30:00Z",
          type: "plan",
          basis: "stated",
          qty: 1,
          entry: { order: "market", price: 7600 },
          stop: 7590, // 40 ticks -> 0.1R = 4 ticks (1.00 pt)
          targets: [],
        },
        { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
        { seq: 3, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: exitPrice, reason: "manual" },
      ]),
    );

  // +3 ticks (0.075R) and +4 ticks (0.10R) are scratch; +5 ticks (0.125R) is not.
  assert.equal(build(7600.75).is_scratch, true);
  assert.equal(build(7600.75).outcome, "scratch");
  assert.equal(build(7601.0).is_scratch, true);
  assert.equal(build(7601.0).outcome, "scratch");
  assert.equal(build(7599.0).is_scratch, true);
  assert.equal(build(7601.25).is_scratch, false);
  assert.equal(build(7601.25).outcome, "manual");
});

test("scratch threshold: 2-tick floor governs on tight stop (8 ticks -> 0.1R is 0.8 ticks)", () => {
  const build = (exitPrice: number) =>
    deriveTrade(
      makeDoc([
        {
          seq: 1,
          t: "2026-11-12T15:30:00Z",
          type: "plan",
          basis: "stated",
          qty: 1,
          entry: { order: "market", price: 7600 },
          stop: 7598, // 8 ticks -> 0.1R = 0.8 ticks, 2-tick floor wins
          targets: [],
        },
        { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
        { seq: 3, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: exitPrice, reason: "manual" },
      ]),
    );

  assert.equal(build(7600.5).is_scratch, true); // +2 ticks
  assert.equal(build(7599.5).is_scratch, true); // -2 ticks
  assert.equal(build(7600.75).is_scratch, false); // +3 ticks
});

test("scratch threshold without a stop uses the 2-tick floor", () => {
  const twoTicks = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
      { seq: 2, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 7600.5, reason: "manual" },
    ]),
  );
  assert.equal(twoTicks.r_multiple, null);
  assert.equal(twoTicks.is_scratch, true);
  assert.equal(twoTicks.outcome, "scratch");
});

// --- Short trades, scale-ins, voided fills, fees, open/working statuses, binary-float tick sizes ---

test("short trade: direction sign, widened stop detection, and exact MCL 0.01 integer-tick math", () => {
  const doc = makeDoc(
    [
      {
        seq: 1,
        t: "2026-11-12T15:30:00Z",
        type: "plan",
        basis: "stated",
        qty: 1,
        entry: { order: "market", price: 70.30 },
        stop: 70.50,
        targets: [{ key: "t1", price: 69.90, qty: 1 }],
      },
      { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", role: "entry", qty: 1, price: 70.30, fees: 0.62 },
      // Widening a short stop means moving it UP (70.50 -> 70.60)
      { seq: 3, t: "2026-11-12T15:35:00Z", type: "modify", basis: "broker", order: "stop", price: 70.60 },
      { seq: 4, t: "2026-11-12T15:40:00Z", type: "fill", basis: "broker", role: "exit", qty: 1, price: 69.90, reason: "target", fees: 0.62 },
    ],
    { instrument: { symbol: "MCL", contract: null }, side: "short" },
  );

  const derived = deriveTrade(doc);
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "target");
  assert.equal(derived.ticks, 40);
  assert.equal(derived.points, 0.4);
  assert.equal(derived.pnl_cents, 4_000); // 40 ticks * $1/tick = $40
  assert.equal(derived.pnl_usd, 40);
  assert.equal(derived.fees_cents, 124);
  assert.equal(derived.fees_usd, 1.24);
  // Initial risk uses initial stop 70.50 (20 ticks = $20), NOT widened 70.60
  assert.equal(derived.initial_risk_usd, 20);
  assert.equal(derived.r_multiple, 2);
  assert.equal(derived.stop_widened, true);
  assert.equal(derived.stop_path[1].widened, true);
  assert.ok(derived.facts.some((f) => f.code === "stop_widened"));
  assert.deepEqual(derived.errors, []);
});

test("scale-in + voided fill: FIFO P&L, B-32 initial risk, and void excludes cancelled leg", () => {
  const doc = makeDoc([
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", role: "entry", qty: 1, price: 7600 },
    { seq: 2, t: "2026-11-12T15:30:01Z", type: "order", basis: "broker", order: "s1", role: "stop", kind: "stop", qty: 1, price: 7595 },
    { seq: 3, t: "2026-11-12T15:32:00Z", type: "fill", basis: "broker", role: "entry", qty: 1, price: 7602 },
    // Duplicate fill later voided by broker
    { seq: 4, t: "2026-11-12T15:32:00Z", type: "fill", basis: "broker", role: "entry", qty: 1, price: 7602 },
    { seq: 5, t: "2026-11-12T15:32:05Z", type: "void", basis: "broker", ref: 4 },
    { seq: 6, t: "2026-11-12T15:40:00Z", type: "fill", basis: "broker", role: "exit", qty: 2, price: 7606, reason: "manual" },
  ]);

  const derived = deriveTrade(doc);
  assert.equal(derived.status, "closed");
  assert.equal(derived.max_size, 2);
  assert.equal(derived.total_entry_qty, 2);
  assert.equal(derived.avg_entry_price, 7601);
  // Lot 1: 7600 -> 7606 = +6 pts (+24 ticks = $30). Lot 2: 7602 -> 7606 = +4 pts (+16 ticks = $20). Total = $50.
  assert.equal(derived.contract_ticks, 40);
  assert.equal(derived.pnl_usd, 50);
  // B-32 initial risk: |7600 - 7595| * max_size(2) * $5 = $50 -> R = 1.0
  assert.equal(derived.initial_risk_usd, 50);
  assert.equal(derived.r_multiple, 1);
  assert.deepEqual(derived.errors, []);
});

test("open, working, and planned statuses keep money and outcome null (OD-38)", () => {
  const openDoc = makeDoc([
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "plan", basis: "stated", qty: 2, entry: { order: "market", price: 7600 }, stop: 7595, targets: [{ key: "t1", price: 7610, qty: 2 }] },
    { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 2, price: 7600 },
  ]);
  const openDerived = deriveTrade(openDoc);
  assert.equal(openDerived.status, "open");
  assert.equal(openDerived.outcome, null);
  assert.equal(openDerived.open_qty, 2);
  assert.equal(openDerived.pnl_usd, null);
  assert.equal(openDerived.r_multiple, null);
  assert.equal(openDerived.initial_risk_usd, 50);
  assert.equal(openDerived.stop_path[0].to, null);

  const workingDoc = makeDoc([
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "order", basis: "broker", order: "o1", role: "entry", kind: "limit", qty: 2, price: 7600 },
  ]);
  const workingDerived = deriveTrade(workingDoc);
  assert.equal(workingDerived.status, "working");
  assert.equal(workingDerived.outcome, null);
  assert.equal(workingDerived.pnl_usd, null);

  const plannedDoc = makeDoc([
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "plan", basis: "stated", qty: 2, entry: { order: "limit", price: 7600 }, stop: 7595, targets: [{ key: "t1", price: 7610, qty: 2 }] },
  ]);
  const plannedDerived = deriveTrade(plannedDoc);
  assert.equal(plannedDerived.status, "planned");
  assert.equal(plannedDerived.outcome, null);
  assert.equal(plannedDerived.pnl_usd, null);
});

test("out-of-order events sort by seq without mutating input, and missing exit reason infers from plan price", () => {
  const events: TradeEvent[] = [
    { seq: 3, t: "2026-11-12T15:45:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 7610 },
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "plan", basis: "stated", qty: 1, entry: { order: "market", price: 7600 }, stop: 7595, targets: [{ key: "t1", price: 7610, qty: 1 }] },
    { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
  ];
  const doc = makeDoc(events);
  const derived = deriveTrade(doc);
  assert.equal(doc.events[0].seq, 3, "input events array must not be mutated");
  assert.equal(derived.status, "closed");
  assert.equal(derived.outcome, "target");
  assert.equal(derived.outcome_basis, "inferred");
  assert.equal(derived.r_multiple, 2);
});

// --- Structural errors: reported, never thrown ---

test("structural errors: negative position and closed_not_flat are reported, never thrown", () => {
  const doc = makeDoc([
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", role: "entry", qty: 2, price: 7600 },
    { seq: 2, t: "2026-11-12T15:35:00Z", type: "fill", basis: "broker", role: "exit", qty: 3, price: 7605, reason: "manual" },
  ]);
  const derived = deriveTrade(doc);
  assert.ok(derived.errors.some((e) => e.code === "negative_position"));
  assert.ok(derived.errors.some((e) => e.code === "closed_not_flat"));
  assert.equal(derived.pnl_usd, null, "unbalanced overshot trade must not report a plausible P&L");
});

test("structural errors: OCO stop cancel while position remains open reports closed_not_flat", () => {
  const doc = makeDoc([
    { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", role: "entry", qty: 2, price: 7600 },
    { seq: 2, t: "2026-11-12T15:30:01Z", type: "order", basis: "broker", order: "o2", role: "stop", kind: "stop", qty: 2, price: 7595 },
    { seq: 3, t: "2026-11-12T15:35:00Z", type: "fill", basis: "broker", role: "exit", qty: 1, price: 7605, reason: "target" },
    { seq: 4, t: "2026-11-12T15:35:00Z", type: "cancel", basis: "broker", order: "o2", reason: "oco" },
  ]);
  const derived = deriveTrade(doc);
  assert.ok(derived.errors.some((e) => e.code === "closed_not_flat"));
});

test("structural errors: exit before entry (both sequence and timestamp) is reported", () => {
  const bySeq = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 7605 },
      { seq: 2, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
    ]),
  );
  assert.ok(bySeq.errors.some((e) => e.code === "exit_before_entry"));

  const byTime = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
      { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 7605 },
    ]),
  );
  assert.ok(byTime.errors.some((e) => e.code === "exit_before_entry"));
});

test("structural errors: stop on the wrong side at placement yields error and null R", () => {
  const badPlan = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:30:00Z", type: "plan", basis: "stated", qty: 1, entry: { order: "market", price: 7600 }, stop: 7605, targets: [] },
      { seq: 2, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600 },
      { seq: 3, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 7610, reason: "manual" },
    ]),
  );
  assert.ok(badPlan.errors.some((e) => e.code === "stop_wrong_side"));
  assert.equal(badPlan.initial_risk_usd, null);
  assert.equal(badPlan.r_multiple, null);

  const badOrder = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", role: "entry", qty: 1, price: 7600 },
      { seq: 2, t: "2026-11-12T15:30:01Z", type: "order", basis: "broker", order: "o2", role: "stop", kind: "stop", qty: 1, price: 7600 },
      { seq: 3, t: "2026-11-12T15:35:00Z", type: "fill", basis: "broker", role: "exit", qty: 1, price: 7610, reason: "manual" },
    ]),
  );
  assert.ok(badOrder.errors.some((e) => e.code === "stop_wrong_side"));
  assert.equal(badOrder.r_multiple, null);
});

test("structural errors: target quantity exceeding position (plan and working orders) is reported", () => {
  const badPlan = deriveTrade(
    makeDoc([
      {
        seq: 1,
        t: "2026-11-12T15:30:00Z",
        type: "plan",
        basis: "stated",
        qty: 2,
        entry: { order: "market", price: 7600 },
        stop: 7595,
        targets: [
          { key: "t1", price: 7605, qty: 2 },
          { key: "t2", price: 7610, qty: 1 },
        ],
      },
    ]),
  );
  assert.ok(badPlan.errors.some((e) => e.code === "target_qty_exceeds_position"));

  const badOrders = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", role: "entry", qty: 1, price: 7600 },
      { seq: 2, t: "2026-11-12T15:30:01Z", type: "order", basis: "broker", order: "t1", role: "target", kind: "limit", qty: 2, price: 7610 },
    ]),
  );
  assert.ok(badOrders.errors.some((e) => e.code === "target_qty_exceeds_position"));
});

test("structural errors: unknown symbol and off-tick price keep money null without throwing", () => {
  const unknown = deriveTrade(
    makeDoc(
      [
        { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 100 },
        { seq: 2, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 105 },
      ],
      { instrument: { symbol: "UNKNOWN", contract: null } },
    ),
  );
  assert.ok(unknown.errors.some((e) => e.code === "unknown_symbol"));
  assert.equal(unknown.pnl_usd, null);

  const offTick = deriveTrade(
    makeDoc([
      { seq: 1, t: "2026-11-12T15:30:00Z", type: "fill", basis: "stated", role: "entry", qty: 1, price: 7600.1 },
      { seq: 2, t: "2026-11-12T15:35:00Z", type: "fill", basis: "stated", role: "exit", qty: 1, price: 7605 },
    ]),
  );
  assert.ok(offTick.errors.some((e) => e.code === "off_tick_price"));
  assert.equal(offTick.pnl_usd, null);
});

// --- fromLegacy(record) ---

test("fromLegacy: exit reason is inferred ONLY when exit equals stop or target", () => {
  const tpRecord = normalizeTrade({
    id: "leg-tp",
    symbol: "MES",
    direction: "LONG",
    quantity: 2,
    entry_time: "2026-11-12T15:30:00Z",
    exit_time: "2026-11-12T15:45:00Z",
    entry_price: 7600,
    exit_price: 7610,
    stop_loss_price: 7595,
    planned_target_price: 7610,
  });
  const tpDoc = fromLegacy(tpRecord);
  const tpExit = tpDoc.events.find((e) => e.type === "fill" && e.role === "exit");
  assert.equal(tpExit?.type === "fill" ? tpExit.reason : null, "target");
  assert.equal(tpExit?.type === "fill" ? tpExit.reason_basis : null, "inferred");
  const tpDerived = deriveTrade(tpDoc);
  assert.equal(tpDerived.outcome, "target");
  assert.equal(tpDerived.outcome_basis, "inferred");
  assert.equal(tpDerived.r_multiple, 2);

  const slRecord = normalizeTrade({
    ...tpRecord,
    id: "leg-sl",
    exit_price: 7595,
  });
  const slDoc = fromLegacy(slRecord);
  const slExit = slDoc.events.find((e) => e.type === "fill" && e.role === "exit");
  assert.equal(slExit?.type === "fill" ? slExit.reason : null, "stop");
  assert.equal(deriveTrade(slDoc).outcome, "stop");
  assert.equal(deriveTrade(slDoc).outcome_basis, "inferred");

  const midRecord = normalizeTrade({
    ...tpRecord,
    id: "leg-mid",
    exit_price: 7604, // neither stop nor target
  });
  const midDoc = fromLegacy(midRecord);
  const midExit = midDoc.events.find((e) => e.type === "fill" && e.role === "exit");
  assert.equal(midExit?.type === "fill" ? midExit.reason : "unexpected", undefined);
  assert.equal(deriveTrade(midDoc).outcome, "manual");
});

test("fromLegacy: omits plan when no stop/target, preserves R-10 moved stop, open trade, notes, and metadata", () => {
  const noPlan = normalizeTrade({
    id: "leg-noplan",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-12T15:30:00Z",
    exit_time: "2026-11-12T15:40:00Z",
    entry_price: 7600,
    exit_price: 7604,
  });
  const noPlanDoc = fromLegacy(noPlan);
  assert.equal(noPlanDoc.events.some((e) => e.type === "plan"), false);
  assert.equal(deriveTrade(noPlanDoc).r_multiple, null);
  assert.equal(deriveTrade(noPlanDoc).pnl_usd, 20);

  // R-10: frozen initial_stop_price moved to breakeven
  const movedStop = normalizeTrade({
    id: "leg-r10",
    symbol: "MES",
    direction: "LONG",
    quantity: 2,
    entry_time: "2026-11-12T15:30:00Z",
    exit_time: "2026-11-12T15:45:00Z",
    entry_price: 7600,
    exit_price: 7606,
    initial_stop_price: 7595,
    initial_stop_set_at: "2026-11-12T15:35:00Z",
    stop_loss_price: 7600,
    planned_target_price: 7610,
    account_id: "acct-1",
    playbook_id: "pb-1",
    quick_tags: ["clean"],
    note: "Held to trail",
    pre_trade_thesis: "Opening drive",
    key_level_price: 7598,
    flagged: true,
    take_again: "yes",
  });
  const movedDoc = fromLegacy(movedStop);
  const modifyEv = movedDoc.events.find((e) => e.type === "modify");
  assert.equal(modifyEv?.basis, "inferred", "timing of legacy stop move is uncertain, hence inferred basis");
  const movedDerived = deriveTrade(movedDoc);
  assert.equal(movedDerived.initial_stop?.price, 7595);
  assert.equal(movedDerived.r_multiple, 1.2); // measured against frozen initial stop 7595
  assert.equal(movedDerived.stop_path.length, 2);
  assert.equal(movedDerived.stop_path[1].price, 7600);
  assert.equal(movedDerived.stop_path[1].basis, "inferred");
  assert.equal(movedDoc.annotations?.account_id, "acct-1");
  assert.equal(movedDoc.annotations?.playbook_id, "pb-1");
  assert.equal(movedDoc.annotations?.key_level_price, 7598);
  assert.equal(movedDoc.annotations?.flagged, true);
  assert.equal(movedDoc.annotations?.take_again, "yes");
  assert.equal(movedDoc.events.filter((e) => e.type === "note").length, 2);

  // Open trade (R-03)
  const openTrade = normalizeTrade({
    id: "leg-open",
    symbol: "MES",
    direction: "SHORT",
    status: "open",
    quantity: 1,
    entry_time: "2026-11-12T15:30:00Z",
    exit_time: null,
    entry_price: 7600,
    exit_price: null,
    stop_loss_price: 7605,
  });
  const openDerived = deriveTrade(fromLegacy(openTrade));
  assert.equal(openDerived.status, "open");
  assert.equal(openDerived.pnl_usd, null);
  assert.equal(openDerived.r_multiple, null);
  assert.equal(openDerived.initial_risk_usd, 25);
});

test("fromLegacy + deriveTrade matches legacy money math across all demo trades", () => {
  for (const record of demoTrades) {
    const doc = fromLegacy(record);
    const derived = deriveTrade(doc);
    assert.equal(derived.ticks, tradeTicks(record), `${record.id}: ticks`);
    assert.equal(derived.points, tradePoints(record), `${record.id}: points`);
    assert.equal(derived.pnl_usd, tradePnl(record), `${record.id}: pnl_usd`);
    const expectedR = record.initial_stop_price != null ? initialRMultiple(record) : rMultiple(record);
    assert.equal(derived.r_multiple, expectedR, `${record.id}: r_multiple`);
    assert.equal(derived.is_scratch, isScratch(record), `${record.id}: is_scratch`);
    assert.deepEqual(derived.errors, [], `${record.id}: zero structural errors`);
  }
});

test("regression (cycle 2): stop in force at entry fill is captured as initialStop even if pre-entry stop was modified", () => {
  // A long trade with a stop placed at 95, moved to 97 before entry at 100, and exited at 106.
  // The stop in force at entry (97) implies 100 - 97 = 3 pts initial risk.
  // PnL = 106 - 100 = +6 pts. R = 6 / 3 = 2.0R (NOT 6 / (100 - 95) = 1.2R).
  const doc: TradeDocument = {
    schema: "mogmine.trade.v1",
    id: "regress-pre-entry-stop-mod",
    user_id: "00000000-0000-0000-0000-000000000000",
    revision: 1,
    instrument: { symbol: "MES", contract: null },
    side: "long",
    source: { kind: "broker", provider: "topstepx", imported_at: null },
    is_sample: false,
    events: [
      { seq: 1, t: "2026-11-12T15:20:00Z", type: "order", basis: "broker", order: "s1", role: "stop", kind: "stop", qty: 1, price: 95 },
      { seq: 2, t: "2026-11-12T15:25:00Z", type: "modify", basis: "broker", order: "s1", price: 97 },
      { seq: 3, t: "2026-11-12T15:30:00Z", type: "fill", basis: "broker", order: "e1", role: "entry", qty: 1, price: 100 },
      { seq: 4, t: "2026-11-12T15:35:00Z", type: "fill", basis: "broker", order: "x1", role: "exit", qty: 1, price: 106, reason: "manual" },
    ],
  };

  const derived = deriveTrade(doc, specFor("MES"));
  assert.equal(derived.initial_stop?.price, 97);
  assert.equal(derived.initial_risk_usd, 15); // 3 pts * $5
  assert.equal(derived.r_multiple, 2.0); // +6 pts / 3 pts = 2.0R
});

test("regression (cycle 2): legacy stop move and cancellation preserve inferred basis", () => {
  const modRecord = normalizeTrade({
    id: "leg-r10-mod",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-12T15:30:00Z",
    exit_time: "2026-11-12T15:45:00Z",
    entry_price: 7600,
    exit_price: 7605,
    initial_stop_price: 7595,
    stop_loss_price: 7600, // moved
  });
  const modDoc = fromLegacy(modRecord);
  const modEv = modDoc.events.find((e) => e.type === "modify");
  assert.equal(modEv?.type === "modify" ? modEv.basis : null, "inferred");

  const cancelRecord = normalizeTrade({
    id: "leg-r10-cancel",
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: "2026-11-12T15:30:00Z",
    exit_time: "2026-11-12T15:45:00Z",
    entry_price: 7600,
    exit_price: 7605,
    initial_stop_price: 7595,
    stop_loss_price: null, // stop removed
  });
  const cancelDoc = fromLegacy(cancelRecord);
  const cancelEv = cancelDoc.events.find((e) => e.type === "cancel");
  assert.equal(cancelEv?.type === "cancel" ? cancelEv.basis : null, "inferred");
});
