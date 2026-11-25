import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContextCard, decisionIndexFor, deriveCardState, etToUtc, markTimeUtc,
  type CardRSize, type ContextCard,
} from "../strategy-lab/context-card.ts";
import { SKILLS } from "../strategy-lab/registry.ts";
import { buildBarSeries, truncateSeries } from "../strategy-lab/series.ts";
import type { SourceBar } from "../strategy-lab/types.ts";

// One MES session, Wed 2026-11-25 (EST). 08:00 ET = 13:00Z. Bar k opens at 08:00 + k minutes.
const SESSION_START = Date.parse("2026-11-25T13:00:00Z");
const SIM_EVAL: CardRSize = { usd: 300, source: "account", accountName: "SIM Eval 50K" };
const DEFAULT_BUDGET: CardRSize = { usd: 250, source: "default", accountName: null };

/** Bars 0–13 are hand-set: bar 10 makes the low (5890), bar 11 closes below its high (no reclaim at the mark),
 * bar 13 closes above bar 10's high (5896), which is the reclaim after the mark at 08:14. Later bars drift flat. */
function sessionBars(): SourceBar[] {
  const hand: Array<[number, number, number, number]> = [
    // [open, high, low, close]
    [5905, 5906, 5903, 5904], // 08:00 (volume artifact: 0)
    [5904, 5905, 5901, 5902],
    [5902, 5903, 5899, 5900],
    [5900, 5901, 5897, 5898],
    [5898, 5899, 5895, 5896],
    [5896, 5897, 5894, 5895],
    [5895, 5896, 5892, 5893],
    [5893, 5894, 5891, 5892],
    [5892, 5893, 5891, 5892],
    [5892, 5893, 5891, 5891.5],
    [5895, 5896, 5890, 5893], // 08:10 the low
    [5893, 5894.5, 5892, 5894], // 08:11 decision bar for a 08:12 mark: closes below 5896, no reclaim
    [5894, 5895.5, 5893, 5895], // 08:12
    [5895, 5897, 5894.5, 5897], // 08:13 closes above 5896: reclaim, shown at 08:14
  ];
  const bars: SourceBar[] = hand.map(([open, high, low, close], k) => ({
    time: SESSION_START + k * 60_000, open, high, low, close, volume: k === 0 ? 0 : 1000 + k,
  }));
  for (let k = hand.length; k < 40; k += 1) {
    const close = 5897 + ((k % 3) - 1) * 0.25;
    bars.push({ time: SESSION_START + k * 60_000, open: close, high: close + 0.5, low: close - 0.5, close, volume: 900 });
  }
  return bars;
}

const series = () => buildBarSeries("MES", sessionBars());
const MARK = { date: "2026-11-25", minuteOfDay: 8 * 60 + 12, price: 5894.25, side: "long" as const };

function rowsOf(card: ContextCard) {
  return card.groups.flatMap((group) => group.rows.map((row) => ({ group: group.id, ...row })));
}

test("etToUtc is DST-correct for an EST and an EDT date", () => {
  assert.equal(etToUtc("2026-11-25", 8 * 60 + 12), Date.parse("2026-11-25T13:12:00Z"));
  assert.equal(etToUtc("2026-07-15", 8 * 60 + 12), Date.parse("2026-07-15T12:12:00Z"));
  assert.equal(markTimeUtc(MARK), Date.parse("2026-11-25T13:12:00Z"));
});

test("the decision bar is the one that closed at the marked minute", () => {
  const s = series();
  // The bar that opened 08:11 closes at 08:12, so a mark at 08:12 decides on index 11.
  assert.equal(decisionIndexFor(s, markTimeUtc(MARK)), 11);
  const card = buildContextCard(s, MARK, { rSize: SIM_EVAL, shield: false });
  assert.equal(card.decisionIndex, 11);
  assert.equal(card.decisionTime, Date.parse("2026-11-25T13:12:00Z"));
});

test("a mark on a minute with no bar gives a named gap and no rows", () => {
  const s = series();
  const card = buildContextCard(s, { ...MARK, minuteOfDay: 6 * 60 }, { rSize: SIM_EVAL, shield: false });
  assert.equal(card.decisionIndex, null);
  assert.equal(card.groups.length, 0);
  assert.match(card.missing[0], /No 1m bar closes at 06:00 ET/);
  assert.equal(deriveCardState({ loading: false, error: null, offline: false, card }), "partial");
});

test("groups are in spec order, with Candle and Volume open by default", () => {
  const card = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: false });
  assert.deepEqual(card.groups.map((g) => [g.id, g.open]), [
    ["candle", true], ["levels", false], ["stops", false], ["ranges", false], ["volume", true],
  ]);
  assert.equal(card.groups[0].title, "Candle / MTF");
  assert.equal(card.groups[4].title, "Volume");
});

test("after the mark: facts from later bars are only in after-mark rows", () => {
  const card = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: false });
  const rows = rowsOf(card);
  const atMark = rows.find((row) => row.key === "reclaimAtMark");
  assert.ok(atMark);
  assert.equal(atMark.when, "at-mark");
  assert.equal(atMark.value, "no", "no reclaim is known at 08:12");
  const after = rows.find((row) => row.key === "reclaimAfter");
  assert.ok(after, "the reclaim after the mark is shown");
  assert.equal(after.when, "after-mark");
  assert.equal(after.value, "08:14 ET");
  assert.equal(after.note, "after the mark");
  assert.ok(rows.filter((row) => row.when === "after-mark").every((row) => row.key === "reclaimAfter"));
});

test("at-mark rows do not change when every later bar is removed (no lookahead)", () => {
  const full = series();
  const trimmed = truncateSeries(full, 11);
  const fullAt = rowsOf(buildContextCard(full, MARK, { rSize: SIM_EVAL, shield: false })).filter((r) => r.when === "at-mark");
  const trimmedAt = rowsOf(buildContextCard(trimmed, MARK, { rSize: SIM_EVAL, shield: false })).filter((r) => r.when === "at-mark");
  assert.deepEqual(trimmedAt, fullAt);
});

test("every row names a registered feature or label skill, and skipped rows carry a reason", () => {
  const card = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: false });
  for (const row of rowsOf(card)) {
    const [id, major] = row.skill.split("@");
    const skill = SKILLS[`${id}@${major}`];
    assert.ok(skill, `${row.skill} is registered`);
    assert.notEqual(skill.meta.kind, "measure", `${row.skill} is not a measure, so it never shows at the mark`);
    if (row.status === "skipped") assert.ok(row.reason, `${row.label} says why it is missing`);
    else assert.ok(row.value !== null, `${row.label} has a value`);
  }
});

test("R is the fixed account size and is named once; the default falls back to $250", () => {
  const sim = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: false });
  assert.equal(sim.basis, "R = $300 (SIM Eval 50K)");
  const fallback = buildContextCard(series(), MARK, { rSize: DEFAULT_BUDGET, shield: false });
  assert.equal(fallback.basis, "R = $250 (default risk budget)");
  assert.throws(() => buildContextCard(series(), MARK, { rSize: { usd: 0, source: "default", accountName: null }, shield: false }), RangeError);
});

test("Shield hides every dollar amount and keeps R and points", () => {
  const card = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: true });
  const text = JSON.stringify(card);
  assert.equal(text.includes("$"), false, "no dollar sign anywhere on the card");
  assert.equal(card.basis, "R · SIM Eval 50K");
  assert.equal(rowsOf(card).some((row) => row.key === "stopUsd"), false);
  const ok = rowsOf(card).filter((row) => row.status === "ok");
  assert.ok(ok.every((row) => !(row.note ?? "").includes("/ct")), "per-contract dollars are dropped");
  const stops = ok.filter((row) => row.group === "stops");
  // The qty row states the actual risk at that quantity in R (3 ct × 4.75 pt × $5 = $71.25 = 0.24R at $300).
  assert.ok(stops.some((row) => row.key === "qtyAtRisk" && /risk 0\.2\dR/.test(row.note ?? "")), "R stays");
  assert.ok(stops.some((row) => row.key === "stopPrice" && (row.note ?? "").includes("pt")), "points stay");
});

test("no card text is NaN, undefined or null; a gap is a named skipped row", () => {
  const card = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: false });
  const texts = [card.header, card.basis, card.dataLine, ...rowsOf(card).flatMap((row) => [row.value ?? "", row.note ?? "", row.label])];
  for (const text of texts) assert.equal(/NaN|undefined|null|Infinity/.test(text), false, text);
  const yesterday = rowsOf(card).find((row) => row.key === "yesterday");
  assert.ok(yesterday, "the prior session row exists");
  assert.equal(yesterday.status, "skipped", "no prior session in the fixture, so the row is a gap");
  assert.equal(yesterday.reason, "no-value");
});

test("volume 0 is missing, not zero activity: the data line counts it and no volume row reads 0", () => {
  const s = series();
  assert.ok(Number.isNaN(s.volume[0]));
  const card = buildContextCard(s, MARK, { rSize: SIM_EVAL, shield: false });
  assert.match(card.dataLine, /1 bars without volume/);
  const rvol = rowsOf(card).find((row) => row.key === "rvol");
  assert.ok(rvol);
  assert.notEqual(rvol.value, "0.0×");
});

test("excluded sessions are shown and make the card partial", () => {
  const card = buildContextCard(series(), MARK, { rSize: SIM_EVAL, shield: false, excludedSessions: 2 });
  assert.equal(card.excludedSessions, 2);
  assert.match(card.dataLine, /2 excluded/);
  assert.equal(deriveCardState({ loading: false, error: null, offline: false, card }), "partial");
});

test("deriveCardState: loading, error and offline win in that order; ready needs no gaps", () => {
  const complete: ContextCard = {
    header: "", basis: "", dataLine: "", decisionIndex: 0, decisionTime: 0, groups: [], missing: [], skippedRows: 0, excludedSessions: 0,
  };
  assert.equal(deriveCardState({ loading: true, error: "boom", offline: true, card: null }), "loading");
  assert.equal(deriveCardState({ loading: false, error: "Could not load bars, retry", offline: true, card: complete }), "error");
  assert.equal(deriveCardState({ loading: false, error: null, offline: true, card: complete }), "offline");
  assert.equal(deriveCardState({ loading: false, error: null, offline: false, card: complete }), "ready");
  assert.equal(deriveCardState({ loading: false, error: null, offline: false, card: { ...complete, skippedRows: 1 } }), "partial");
  assert.equal(deriveCardState({ loading: false, error: null, offline: false, card: null }), "partial");
});
