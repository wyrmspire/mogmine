import test from "node:test";
import assert from "node:assert/strict";
import { levelLines, levelRole, missingCandleLevels, stackLabels, tradeLevelWindows, tradeLevels } from "../chart-levels.ts";
import { computeLevelsFromInputs } from "../levels.ts";
import type { Candle } from "../trades.ts";
import fixture from "../../fixtures/levelsets/MES-2026-11-12.json" with { type: "json" };
import { planLevelsAsOf, plannedLineSources } from "../chart-levels.ts";
import { createPlannedLevel, newPlanningSession } from "../plans.ts";
import type { PlanningSession } from "../plans.ts";
import { sanitizePlanningSession } from "../plans-store.ts";

const minute = 60_000;
const flat = (from: string, to: string, price: number, step = minute): Candle[] => Array.from(
  { length: (Date.parse(to) - Date.parse(from)) / step },
  (_, i) => ({ time: Date.parse(from) + i * step, open: price, high: price, low: price, close: price, volume: 1 }),
);
const nov12 = computeLevelsFromInputs({ symbol: "MES", sessionDate: fixture.session_date, inputs: fixture.inputs });

test("roles follow docs/12 §5: ADR yellow, opens/pivot/settlement neutral, others by side of price", () => {
  const at = (key: string) => nov12.find((level) => level.key === key)!;
  assert.equal(levelRole(at("adr_low"), 7600), "adr");
  assert.equal(levelRole(at("pdc"), 7600), "neutral");
  assert.equal(levelRole(at("globex_open"), 7600), "neutral");
  assert.equal(levelRole(at("pdh"), 7600), "resistance");
  assert.equal(levelRole(at("pdl"), 7600), "support");
  assert.equal(levelRole({ type: "onh", price: 7600 }, 7600), "neutral");
});

test("levels at one tick share one pill, highest price first, ADR wins the colour", () => {
  const lines = levelLines(nov12, 7600, "MES");
  const ticks = lines.map((line) => line.price_ticks);
  assert.deepEqual(ticks, [...ticks].sort((a, b) => b - a));
  assert.equal(new Set(ticks).size, ticks.length);
  // PDH and RTH high both printed 7671.50; ADR inner low and RTH low share 7593.
  assert.equal(lines.find((line) => line.price === 7671.5)?.label, "7671.50 PDH / RTH high");
  const shared = lines.find((line) => line.price === 7593)!;
  assert.equal(shared.role, "adr");
  assert.deepEqual(shared.keys.sort(), ["adr_inner_low", "rth_low"]);
});

test("same-session levels start at the bar that formed them; prior-day levels run from the left edge", () => {
  const lines = levelLines(nov12, 7600, "MES");
  assert.equal(lines.find((line) => line.keys.includes("onl"))?.startAt, Date.parse("2026-11-12T07:17:00-06:00"));
  assert.equal(lines.find((line) => line.keys.includes("pdl"))?.startAt, null);
  // A group with any prior-day member draws from the edge.
  assert.equal(lines.find((line) => line.price === 7593)?.startAt, null);
});

test("stacked labels never overlap, keep input order and stay inside the pane", () => {
  const placed = stackLabels([100, 102, 101, 300], 16, 0, 400);
  const sorted = [...placed].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i] - sorted[i - 1] >= 16 - 1e-9);
  assert.equal(placed[0], 100);
  assert.equal(placed[3], 300);
  const bottom = stackLabels([395, 396], 16, 0, 400);
  assert.ok(Math.max(...bottom) <= 392 && Math.min(...bottom) >= 8);
  const top = stackLabels([-20, 1], 16, 0, 400);
  assert.deepEqual(top, [8, 24]);
});

test("windows are the prior session and the trade's session up to entry, across the November DST change", () => {
  // Mon Nov 2 2026 (after the Nov 1 change): prior session is Fri Oct 30, which ran on EDT.
  const windows = tradeLevelWindows("2026-11-02T15:00:00Z");
  assert.equal(windows.sessionDate, "2026-11-02");
  assert.equal(new Date(windows.prior.from).toISOString(), "2026-10-29T22:00:00.000Z");
  assert.equal(new Date(windows.prior.to).toISOString(), "2026-10-30T21:00:00.000Z");
  assert.equal(new Date(windows.today!.from).toISOString(), "2026-11-01T23:00:00.000Z");
  assert.equal(windows.today!.to, Date.parse("2026-11-02T15:00:00Z"));
  // A Saturday entry belongs to Monday's session, which has not opened: no same-session window.
  assert.equal(tradeLevelWindows("2026-11-07T15:00:00Z").today, null);
});

test("trade levels read prior-session and overnight bars as of entry, never after it", () => {
  const trade = { symbol: "MES", entry_time: "2026-11-12T15:00:00Z" };
  const prior = [
    ...flat("2026-11-10T23:00:00Z", "2026-11-11T14:30:00Z", 7600),
    ...flat("2026-11-11T14:30:00Z", "2026-11-11T21:00:00Z", 7650),
    ...flat("2026-11-11T21:00:00Z", "2026-11-11T22:00:00Z", 7640),
  ];
  const today = [
    ...flat("2026-11-11T23:00:00Z", "2026-11-12T14:30:00Z", 7620),
    // After entry: must not move ONH or anything else.
    ...flat("2026-11-12T15:00:00Z", "2026-11-12T16:00:00Z", 9999),
  ];
  const levels = tradeLevels(trade, { candles: prior, baseTimeframe: "1m" }, { candles: today, baseTimeframe: "1m" })!;
  const price = Object.fromEntries(levels.map((level) => [level.key, level.price]));
  assert.equal(price.pdh, 7650);
  assert.equal(price.pdl, 7600);
  assert.equal(price.rth_open, 7650);
  assert.equal(price.globex_open, 7620);
  assert.equal(price.onh, 7620);
  assert.ok(!Object.values(price).includes(9999));
  // No settlement source: PDC and pivots are withheld, never guessed.
  assert.equal(price.pdc, undefined);
  assert.equal(price.pp, undefined);
  // The Monday-to-entry week windows were not loaded, so the week levels are reported missing.
  assert.deepEqual(missingCandleLevels(levels), ["week_high", "week_low"]);
});

test("mixed timeframes, unsupported symbols and empty windows draw nothing", () => {
  const trade = { symbol: "MES", entry_time: "2026-11-12T15:00:00Z" };
  const prior = flat("2026-11-10T23:00:00Z", "2026-11-11T22:00:00Z", 7600);
  assert.equal(tradeLevels(trade, { candles: prior, baseTimeframe: "1m" }, { candles: [], baseTimeframe: "5m" }), null);
  assert.equal(tradeLevels({ ...trade, symbol: "ES" }, { candles: prior, baseTimeframe: "1m" }, null), null);
  assert.equal(tradeLevels(trade, { candles: [], baseTimeframe: "1m" }, null), null);
});

// PS-3: planning-session levels on trade charts.

const lvl = (id: string, price: number, label: string) => createPlannedLevel({ id, price, symbol: "MES", label })!;
const plan = (over: Partial<PlanningSession> = {}): PlanningSession => ({
  id: "p1", user_id: "owner", session_date: "2026-11-12", symbol: "MES", name: "Pre-market", preset: "pre_market",
  anchor_time_utc: "2026-11-12T14:30:00Z", created_at: "2026-11-12T13:00:00Z", updated_at: "2026-11-12T16:00:00Z",
  observations: "", watch_playbook_ids: [], levels: [lvl("a", 7610, "Shelf"), lvl("c", 7580, "Late add")],
  // Each revision holds the levels its edit replaced: [Shelf] until 14:00, [Shelf, Old] until 16:00, then [Shelf, Late add].
  revisions: [
    { id: "r1", saved_at: "2026-11-12T14:00:00Z", after_the_fact: false, observations: "", watch_playbook_ids: [], levels: [lvl("a", 7610, "Shelf")] },
    { id: "r2", saved_at: "2026-11-12T16:00:00Z", after_the_fact: true, observations: "", watch_playbook_ids: [], levels: [lvl("a", 7610, "Shelf"), lvl("b", 7590.25, "Old")] },
  ],
  ...over,
});
const entry = { symbol: "MES", entry_time: "2026-11-12T15:00:00Z" };

test("PS-3: plan levels are read as they stood at entry, never from a later edit (B-14)", () => {
  assert.deepEqual(planLevelsAsOf(plan(), Date.parse(entry.entry_time)).map((level) => level.label), ["Shelf", "Old"]);
  assert.deepEqual(planLevelsAsOf(plan(), Date.parse("2026-11-12T13:30:00Z")).map((level) => level.label), ["Shelf"]);
  assert.deepEqual(planLevelsAsOf(plan(), Date.parse("2026-11-12T17:00:00Z")).map((level) => level.label), ["Shelf", "Late add"]);
  assert.deepEqual(planLevelsAsOf(plan(), Date.parse("2026-11-12T12:00:00Z")), []);
});

test("PS-3: only same-instrument, same-session, live plans with a symbol are drawn (OD-15)", () => {
  assert.equal(plannedLineSources([plan()], entry).length, 2);
  assert.equal(plannedLineSources([plan({ symbol: "MNQ" })], entry).length, 0);
  assert.equal(plannedLineSources([plan({ symbol: undefined })], entry).length, 0);
  assert.equal(plannedLineSources([plan({ session_date: "2026-11-11" })], entry).length, 0);
  assert.equal(plannedLineSources([plan({ archived: true })], entry).length, 0);
});

test("PS-3: a planned level at a computed tick shares its pill and is coloured by side of price", () => {
  const computed = nov12.filter((level) => level.key === "rth_open"); // 7612
  const planned = plannedLineSources([plan({ levels: [lvl("x", 7612, "Plan open")], revisions: [] })], entry);
  const lines = levelLines([...computed, ...planned, ...plannedLineSources([plan({ id: "p2", levels: [lvl("y", 7630, "Supply")], revisions: [] })], entry)], 7600, "MES");
  assert.equal(lines.find((line) => line.price === 7612)?.label, "7612.00 RTH open / Plan open");
  assert.equal(lines.find((line) => line.price === 7630)?.role, "resistance");
  assert.equal(lines.find((line) => line.price === 7630)?.startAt, null);
});

test("PS-3: the plans store keeps a known symbol and drops an unknown one", () => {
  assert.equal(sanitizePlanningSession({ ...plan(), symbol: "mnq" })?.symbol, "MNQ");
  assert.equal(sanitizePlanningSession({ ...plan(), symbol: "BTC" })?.symbol, undefined);
  assert.equal("symbol" in sanitizePlanningSession({ ...plan(), symbol: undefined })!, false);
});

test("PS-3 regression for #158: a plan saved from the sheet carries its instrument and the owner id, so it draws", () => {
  const saved = newPlanningSession({
    id: "p9", session_date: "2026-11-12", symbol: "mes", name: "Pre-market", preset: "pre_market",
    anchor_time_utc: "2026-11-12T14:30:00Z", observations: "", bias: null, watch_playbook_ids: [],
    levels: [lvl("s", 7610, "Shelf")], now: "2026-11-12T13:00:00Z",
  });
  assert.equal(saved.symbol, "MES");
  assert.equal(saved.user_id, "demo-owner");
  assert.equal(plannedLineSources([saved], entry).length, 1);
});
