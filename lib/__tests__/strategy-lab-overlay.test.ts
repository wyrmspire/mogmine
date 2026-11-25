import test from "node:test";
import assert from "node:assert/strict";
import type { TradeRecord } from "../trades.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { validateRecipe } from "../strategy-lab/recipe.ts";
import { runRecipe } from "../strategy-lab/runner.ts";
import { decisionIndexAt, overlayHeadline, overlayRecipe } from "../strategy-lab/overlay.ts";
import type { Match, Outcome, Recipe, RunResult, SourceBar } from "../strategy-lab/types.ts";

const MINUTE = 60_000;
const SESSION = "2026-07-14"; // EDT (UTC−4): 09:45 ET = 13:45Z
const R250 = { usd: 250, source: "default" as const };
const R300 = { usd: 300, source: "account" as const };

// ---- Fixtures ------------------------------------------------------------------------------------------------

/** The previous calendar day, YYYY-MM-DD. */
function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** One session's 1m bars, 18:00 ET the previous evening to 16:59 ET (1380 bars), flat at `price`. */
function sessionBars(date: string, price: number, skipTimes: ReadonlySet<number> = new Set()): SourceBar[] {
  const start = Date.parse(`${previousDay(date)}T22:00:00Z`);
  const bars: SourceBar[] = [];
  for (let k = 0; k < 1380; k += 1) {
    const time = start + k * MINUTE;
    if (skipTimes.has(time)) continue;
    bars.push({ time, open: price, high: price, low: price, close: price, volume: 1000 });
  }
  return bars;
}

const RECIPE_INPUT = {
  schema: "mogmine.strategy-recipe.v1",
  id: "rcp-open-long", version: 1, name: "Early open long",
  playbookId: "pb-open",
  symbol: "MES", side: "long",
  window: { startEt: "09:30", endEt: "10:29" },
  trigger: { all: [{ skill: "sessionClock", out: "minutesFromRthOpen", op: "<=", value: 20 }] },
  entry: { at: "trigger-close" },
  stop: { type: "points", points: 4 },
  target: { type: "rr", multiple: 2 },
  maxHoldMinutes: 60, flatAtEt: "16:59",
  sizing: { mode: "risk-r", riskR: 0.25 },
  account: { accountId: null },
  slippageTicks: { stop: 1, market: 1 },
  dedupe: { maxPerSession: 1, cooldownMinutes: 30, oneAtATime: true },
  sliceBy: [{ skill: "sessionClock", out: "todBucket" }],
  measure: {},
};

function recipe(overrides: Record<string, unknown> = {}): Recipe {
  const checked = validateRecipe({ ...RECIPE_INPUT, ...overrides });
  if (!checked.ok) throw new Error(`fixture recipe invalid: ${JSON.stringify(checked.errors)}`);
  return checked.recipe;
}

/** A closed or open MES trade with only the fields the overlay reads. ET times are EDT (UTC−4). */
function trade(overrides: Partial<TradeRecord> & { id: string }): TradeRecord {
  return {
    user_id: "owner", account_id: null, symbol: "MES", yahoo_ticker: "MES=F",
    direction: "LONG", trade_style: "scalp", status: "closed",
    entry_time: `${SESSION}T13:45:00.000Z`, exit_time: `${SESSION}T14:05:00.000Z`,
    entry_price: 5000, exit_price: 5010, quantity: 1,
    stop_loss_price: 4996, initial_stop_price: 4996, initial_stop_set_at: null,
    planned_target_price: null, key_level_price: null,
    note: "", review_status: "unreviewed", playbook_id: "pb-open",
    quick_tags: [], checklist_state: [], pre_trade_thesis: "", management_notes: "", post_exit_notes: "",
    flagged: false, take_again: null, take_again_at: null, is_sample: false, sparkline: [],
    exit_reason: null,
    ...overrides,
  } as unknown as TradeRecord;
}

// Entry times, all on the 2026-07-14 session (EDT).
const A_0945 = `${SESSION}T13:45:00.000Z`; // 09:45 ET, long, +40 ticks → +$50
const B_1010 = `${SESSION}T14:10:00.000Z`; // 10:10 ET, long, −20 ticks → −$25 (trigger fails, 40 min)
const C_0940 = `${SESSION}T13:40:00.000Z`; // 09:40 ET, short, +40 ticks → +$50 (side fails)

function fixtureTrades(): TradeRecord[] {
  return [
    trade({ id: "A" }),
    trade({ id: "B", entry_time: B_1010, exit_price: 4995 }),
    trade({ id: "C", direction: "SHORT", entry_time: C_0940, exit_price: 4990 }),
    trade({ id: "D-sample", is_sample: true }),
    trade({ id: "E-other-playbook", playbook_id: "pb-other" }),
    trade({ id: "F-older", entry_time: "2026-01-05T14:00:00.000Z", exit_time: "2026-01-05T14:10:00.000Z" }),
    trade({ id: "G-open", status: "open", exit_time: null, exit_price: null }),
    trade({ id: "H-after", entry_time: "2026-07-20T13:45:00.000Z", exit_time: "2026-07-20T14:05:00.000Z" }),
  ];
}

function seriesFor(skip: ReadonlySet<number> = new Set()) {
  return buildBarSeries("MES", sessionBars(SESSION, 5000, skip));
}

// ---- Tests ---------------------------------------------------------------------------------------------------

test("decision bar is the bar that closed at or before the entry time", () => {
  const series = seriesFor();
  const at0945 = Date.parse(A_0945);
  const idx = decisionIndexAt(series, at0945);
  assert.notEqual(idx, null);
  assert.equal(series.time[idx as number], at0945 - MINUTE, "09:45:00 ET decides on the bar opened 09:44");
  assert.equal(decisionIndexAt(series, at0945 + 30_000), idx, "09:45:30 still decides on the 09:44 bar");
  assert.equal(decisionIndexAt(series, at0945 - 30_000), (idx as number) - 1, "09:44:30 decides on the 09:43 bar");
  assert.equal(decisionIndexAt(series, Number.NaN), null);
});

test("per-condition pass/fail with actual values, and fit vs not-fit in account R", () => {
  const summary = overlayRecipe({ recipe: recipe(), series: seriesFor(), trades: fixtureTrades(), rSize: R250 });

  assert.equal(summary.tagged, 5, "closed MES trades on pb-open, samples excluded");
  assert.equal(summary.inRange, 3, "A, B, C are inside the loaded bars");
  assert.equal(summary.noBarAtEntry, 0);
  assert.equal(summary.samplesExcluded, 1);

  const byId = new Map(summary.rows.map((row) => [row.tradeId, row]));
  const a = byId.get("A");
  const b = byId.get("B");
  const c = byId.get("C");
  assert.ok(a && b && c);

  // Trigger leaf: minutes from the open at the decision minute (09:45 → 15; 10:10 → 40).
  const aTrigger = a.conditions.find((x) => x.path === "trigger.all[0]");
  assert.deepEqual(aTrigger, { path: "trigger.all[0]", passed: true, actual: 15 });
  const bTrigger = b.conditions.find((x) => x.path === "trigger.all[0]");
  assert.deepEqual(bTrigger, { path: "trigger.all[0]", passed: false, actual: 40 });
  assert.equal(c.conditions.find((x) => x.path === "side")?.passed, false);
  assert.equal(c.conditions.find((x) => x.path === "side")?.actual, "SHORT");

  assert.equal(a.fits, true);
  assert.equal(b.fits, false);
  assert.equal(c.fits, false);

  // Account R at a fixed $250: A +$50 → +0.20R, B −$25 → −0.10R, C +$50 → +0.20R.
  assert.ok(Math.abs((a.realResultR ?? NaN) - 0.2) < 1e-9);
  assert.ok(Math.abs((b.realResultR ?? NaN) + 0.1) < 1e-9);
  assert.ok(Math.abs((c.realResultR ?? NaN) - 0.2) < 1e-9);

  assert.equal(summary.fit.n, 1);
  assert.ok(Math.abs((summary.fit.avgR ?? NaN) - 0.2) < 1e-9);
  assert.equal(summary.notFit.n, 2);
  assert.ok(Math.abs((summary.notFit.avgR ?? NaN) - 0.05) < 1e-9);
  assert.ok(Math.abs((summary.notFit.totalR ?? NaN) - 0.1) < 1e-9);
});

test("older-than-history and after-history trades are counted and never computed", () => {
  const summary = overlayRecipe({ recipe: recipe(), series: seriesFor(), trades: fixtureTrades(), rSize: R250 });
  assert.deepEqual(summary.olderThanHistory, { count: 1, tradeIds: ["F-older"] });
  assert.equal(summary.afterHistory, 1);
  assert.equal(summary.rows.some((row) => row.tradeId === "F-older" || row.tradeId === "H-after"), false);
});

test("samples are excluded by default and included on request", () => {
  const included = overlayRecipe({
    recipe: recipe(), series: seriesFor(), trades: fixtureTrades(), rSize: R250, includeSamples: true,
  });
  assert.equal(included.samplesExcluded, 0);
  assert.equal(included.tagged, 6);
  assert.equal(included.rows.some((row) => row.tradeId === "D-sample"), true);
  assert.equal(included.fit.n, 2, "the sample is a fitting long at 09:45 and joins A");
});

test("the R basis is the fixed account R size, never a stop width", () => {
  const trades = fixtureTrades();
  const at250 = overlayRecipe({ recipe: recipe(), series: seriesFor(), trades, rSize: R250 });
  const at300 = overlayRecipe({
    recipe: recipe(), series: seriesFor(), trades, rSize: R300, accountName: "SIM Eval 50K",
  });
  assert.equal(at250.basis, "R = $250 (default risk budget)");
  assert.equal(at300.basis, "R = $300 (SIM Eval 50K)");
  const a250 = at250.rows.find((row) => row.tradeId === "A")?.realResultR ?? NaN;
  const a300 = at300.rows.find((row) => row.tradeId === "A")?.realResultR ?? NaN;
  assert.ok(Math.abs(a250 - 0.2) < 1e-9);
  assert.ok(Math.abs(a300 - 50 / 300) < 1e-9);
  assert.throws(() => overlayRecipe({ recipe: recipe(), series: seriesFor(), trades, rSize: { usd: 0, source: "default" } }));
});

test("a trade whose decision bar is missing is counted as no bar, not guessed", () => {
  const gap = new Set([Date.parse(`${SESSION}T13:44:00.000Z`)]); // drops the 09:44 bar that decides A
  const summary = overlayRecipe({ recipe: recipe(), series: seriesFor(gap), trades: fixtureTrades(), rSize: R250 });
  assert.equal(summary.noBarAtEntry, 1);
  assert.equal(summary.inRange, 2);
  assert.equal(summary.rows.some((row) => row.tradeId === "A"), false);
});

test("the recipe's simulated outcome is shown only where its run fired at that bar", () => {
  const series = seriesFor();
  const aIndex = decisionIndexAt(series, Date.parse(A_0945)) as number;
  const outcome: Outcome = {
    exitReason: "target", exitTime: Date.parse(A_0945) + 10 * MINUTE, pnlPoints: 8, pnlUsd: 80, resultR: 0.32,
    riskMultiple: 2, mfePoints: 8, maePoints: 0, mfeR: 2, maeR: 0, minutesToExit: 10, minutesToTarget: 10,
  };
  const run = { matches: [{ i: aIndex, outcome } as unknown as Match] } as unknown as Pick<RunResult, "matches">;
  const summary = overlayRecipe({ recipe: recipe(), series, trades: fixtureTrades(), rSize: R250, run });
  assert.deepEqual(summary.rows.find((row) => row.tradeId === "A")?.simulated, outcome);
  assert.equal(summary.rows.find((row) => row.tradeId === "B")?.simulated, null);
});

test("no playbook on the recipe means nothing is tagged", () => {
  const summary = overlayRecipe({ recipe: recipe({ playbookId: null }), series: seriesFor(), trades: fixtureTrades(), rSize: R250 });
  assert.equal(summary.tagged, 0);
  assert.equal(summary.rows.length, 0);
  assert.equal(overlayHeadline(summary), "No closed trades are tagged with this recipe's playbook yet.");
});

test("headline and legend read in plain words", () => {
  const summary = overlayRecipe({ recipe: recipe(), series: seriesFor(), trades: fixtureTrades(), rSize: R250 });
  assert.equal(
    overlayHeadline(summary),
    "3 tagged trades in range · 1 meet the recipe · real avg +0.20R on those 1 · +0.05R on the other 2 · 1 older than the bar history",
  );
  assert.equal(summary.legend[0].label, "In window 09:30–10:29");
  assert.equal(summary.legend[1].label, "Side is long");
  assert.equal(summary.legend[2].path, "trigger.all[0]");
  assert.match(summary.legend[2].label, /≤ 20$/);
});

test("Shield omits dollars from basis and runRecipe populates overlays when trades are supplied", () => {
  const shielded = overlayRecipe({
    recipe: recipe(), series: seriesFor(), trades: fixtureTrades(), rSize: R300, accountName: "SIM Eval 50K", shield: true,
  });
  assert.equal(shielded.basis, "R · SIM Eval 50K");
  assert.equal(shielded.basis.includes("$"), false);

  const result = runRecipe(recipe(), seriesFor(), { rSizeUsd: 300, rSizeSource: "account", trades: fixtureTrades() });
  assert.equal(result.overlays.length, 3);
  assert.equal(result.overlays.filter((row) => row.fits).length, 1);
});
