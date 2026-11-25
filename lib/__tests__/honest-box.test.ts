// Golden tests for honest excursion math (#30) and the box display helpers (#31).
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatR } from "../format.ts";
import { validateTradeAgainstBars } from "../trade-bar-validation.ts";
import { demoTrades } from "../fixtures.ts";
import { getSampleCandles } from "../candles.ts";
import type { SampleBarsPayload } from "../candles.ts";
import sampleBarsData from "../../fixtures/sample-bars.json" with { type: "json" };

const sampleBars = sampleBarsData as unknown as SampleBarsPayload;
import { applyFixtureRefresh } from "../store.ts";
import { exitFlagReason, excursions, isClosed, isScratch, normalizeTrade, plannedRewardRisk, tradeTicks } from "../trades.ts";
import type { Candle, TradeRecord } from "../trades.ts";

const minute = 60_000;

function bar(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 1 };
}

function longTrade(overrides: Partial<TradeRecord> & Pick<TradeRecord, "entry_time" | "exit_time" | "entry_price" | "exit_price">) {
  return normalizeTrade({ id: "ex", symbol: "MES", direction: "LONG", ...overrides });
}

test("entry at bar close does not inherit that bar's earlier high as MFE", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles = [
    bar(start, 100, 108, 99, 100),          // filled at the close; high printed before the fill
    bar(start + minute, 100, 101, 98, 99),
    bar(start + 2 * minute, 99, 100.5, 97, 98),
    bar(start + 3 * minute, 98, 99, 96, 97),
    bar(start + 4 * minute, 96, 98, 95, 97),  // exit at this bar's open; low is after the fill
  ];
  const trade = longTrade({
    // Execution timestamp is the close of the 15:00 bar, not its open.
    entry_time: new Date(start + minute - 1).toISOString(),
    exit_time: new Date(start + 4 * minute).toISOString(),
    entry_price: 100,
    exit_price: 96,
  });
  const ex = excursions(trade, candles);
  assert.ok(ex);
  assert.equal(ex.coverage, "complete");
  // Later complete bars never traded above 101, so the entry bar's 108 is not MFE.
  assert.equal(ex.mfePrice, 101);
  // Exit is at the 15:04 open, so that bar's 95 low is not counted. Lowest complete bar is 96.
  assert.equal(ex.maePrice, 96);
});

test("entry at bar open excludes that bar's range under R-POST-1", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles = [
    bar(start, 100, 108, 99, 102),          // entry bar: R-POST-1 excludes its 108 high even at :00
    bar(start + minute, 102, 103, 101, 102),
    bar(start + 2 * minute, 102, 104, 100, 101),
    bar(start + 3 * minute, 99, 102, 98, 100), // fill at the open; low is not provable
  ];
  const trade = longTrade({
    entry_time: new Date(start).toISOString(),
    exit_time: new Date(start + 3 * minute).toISOString(),
    entry_price: 100,
    exit_price: 99,
  });
  const ex = excursions(trade, candles);
  assert.ok(ex);
  assert.equal(ex.coverage, "complete");
  assert.equal(ex.mfePrice, 104);
  // Exit bar (15:03) starts at the exit timestamp, so it is not fully inside the hold and 98 is not counted.
  // Inside bars (15:01, 15:02) stay >= 100, so MAE is the 99 exit fill.
  assert.equal(ex.maePrice, 99);
});

test("a one-bar trade and a hold with fewer than two complete bars show no excursions", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles = [
    bar(start, 100, 110, 90, 105),
    bar(start + minute, 105, 112, 94, 100),
    bar(start + 2 * minute, 100, 101, 95, 96),
  ];
  const oneBar = longTrade({
    entry_time: new Date(start).toISOString(),
    exit_time: new Date(start + 40_000).toISOString(),
    entry_price: 100,
    exit_price: 105,
  });
  assert.equal(excursions(oneBar, candles), null);

  // Entry mid-bar, exit mid-bar two minutes later: only one completed bar (15:01–15:02).
  const shortHold = longTrade({
    entry_time: new Date(start + 5_000).toISOString(),
    exit_time: new Date(start + 2 * minute + 5_000).toISOString(),
    entry_price: 100,
    exit_price: 96,
  });
  assert.equal(excursions(shortHold, candles), null);
});

test("a fill whose price equals the bar open excludes the entry bar whether mid-bar or at :00 (R-POST-1)", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles = [
    bar(start, 100, 110, 99, 101),            // price revisits the open mid-bar; high 110 is before the fill
    bar(start + minute, 101, 102, 100, 101),
    bar(start + 2 * minute, 101, 103, 100, 102),
    bar(start + 3 * minute, 102, 104, 101, 103),
  ];
  const midBar = longTrade({
    entry_time: new Date(start + 20_000).toISOString(),
    exit_time: new Date(start + 3 * minute).toISOString(),
    entry_price: 100, // equals the entry bar's open, but the fill is 20s in
    exit_price: 102,
  });
  const mid = excursions(midBar, candles);
  assert.ok(mid);
  assert.equal(mid.coverage, "complete");
  assert.equal(mid.mfePrice, 103); // later complete bars (15:01-15:03); the 104 wick is on the exit bar
  assert.notEqual(mid.mfePrice, 110);

  // Same prices with a bar-open timestamp: R-POST-1 still excludes the entry bar's 110 high.
  const atOpen = longTrade({
    entry_time: new Date(start).toISOString(),
    exit_time: new Date(start + 3 * minute).toISOString(),
    entry_price: 100,
    exit_price: 102,
  });
  const opened = excursions(atOpen, candles);
  assert.ok(opened);
  assert.equal(opened.coverage, "complete");
  assert.equal(opened.mfePrice, 103);
});

test("a mid-bar fill omits unknown entry and exit extremes", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  const candles = [
    bar(start, 100, 120, 80, 105),
    bar(start + minute, 105, 108, 104, 107),
    bar(start + 2 * minute, 107, 109, 106, 108),
    bar(start + 3 * minute, 108, 130, 70, 100),
  ];
  const trade = longTrade({
    entry_time: new Date(start + 15_000).toISOString(),
    exit_time: new Date(start + 3 * minute + 15_000).toISOString(),
    entry_price: 104,
    exit_price: 100,
  });
  const ex = excursions(trade, candles);
  assert.ok(ex);
  assert.equal(ex.coverage, "complete");
  assert.equal(ex.mfePrice, 109);
  assert.equal(ex.maePrice, 100); // exit fill; the exit-bar 70 low is not in the hold
});

test("a gapped hold returns a partial excursion, not a complete number", () => {
  const start = Date.parse("2026-11-10T15:00:00Z");
  // 5-minute hold with the middle bar missing.
  const candles = [
    bar(start, 100, 101, 99, 100),
    bar(start + minute, 100, 106, 99, 105),
    // start + 2 minutes is missing
    bar(start + 3 * minute, 104, 105, 94, 95),
    bar(start + 4 * minute, 95, 96, 94, 95),
  ];
  const trade = longTrade({
    entry_time: new Date(start).toISOString(),
    exit_time: new Date(start + 5 * minute).toISOString(),
    entry_price: 100,
    exit_price: 95,
  });
  const ex = excursions(trade, candles);
  assert.ok(ex);
  assert.equal(ex.coverage, "partial");
  assert.equal(ex.mfePrice, 106);
  assert.equal(ex.maePrice, 94);
});

test("scalp from the review screenshot: never-in-profit long does not report the entry bar high as MFE", () => {
  // The trade from the review screenshot: long filled at the close of a red bar whose high was +11.50.
  const entryBar = Date.parse("2026-11-09T16:26:00.000Z");
  const exit = entryBar + 10 * minute;
  const trade = normalizeTrade({
    id: "review-scalp", symbol: "MNQ", direction: "LONG",
    entry_time: new Date(entryBar + minute - 1).toISOString(), exit_time: new Date(exit).toISOString(),
    entry_price: 27875.25, exit_price: 27820, stop_loss_price: 27820,
  });

  const candles: Candle[] = [];
  // Entry bar: red, close = fill, high = fill + 11.50. This was the misleading MFE.
  candles.push(bar(entryBar, 27882, 27886.75, 27874.5, 27875.25));
  // Nine later complete bars: price never trades above the fill.
  const laterCloses = [27870, 27862, 27855, 27848, 27840, 27836, 27830, 27826, 27822];
  for (let i = 0; i < laterCloses.length; i++) {
    const close = laterCloses[i];
    candles.push(bar(entryBar + (i + 1) * minute, close + 3, close + 4, close - 2, close));
  }
  // Exit bar opens at the recorded exit time; fill is at the open / stop.
  candles.push(bar(exit, 27820, 27824, 27818, 27821));

  const ex = excursions(trade, candles);
  assert.ok(ex);
  assert.notEqual(ex.mfePrice, 27886.75);
  assert.ok(ex.mfePrice <= trade.entry_price, `MFE ${ex.mfePrice} must not count the entry-bar high 27886.75`);
  // Exit-bar low 27818 is after an open fill, so it is not counted. MAE is the stop/exit at 27820.
  assert.equal(ex.maePrice, 27820);
});

test("scratch threshold is 0.1R or 2 ticks, whichever is larger", () => {
  const base = {
    id: "scratch", symbol: "MES" as const, direction: "LONG" as const,
    entry_time: "2026-11-10T15:00:00.000Z", exit_time: "2026-11-10T15:10:00.000Z",
    entry_price: 7000, stop_loss_price: 6987.5, // 12.5 pts = 50 ticks, so 0.1R = 5 ticks
  };
  // 4 ticks from entry (under the 5-tick / 0.1R threshold).
  assert.equal(isScratch(normalizeTrade({ ...base, exit_price: 7001 })), true);
  // 5 ticks is still within 0.1R.
  assert.equal(isScratch(normalizeTrade({ ...base, exit_price: 7001.25 })), true);
  // 6 ticks is a real result, not a scratch.
  assert.equal(isScratch(normalizeTrade({ ...base, exit_price: 7001.5 })), false);
  assert.ok(tradeTicks(normalizeTrade({ ...base, exit_price: 7001.5 }))! > 5);

  // Tight stop: 8 ticks of risk, 0.1R = 0.8 ticks, so the 2-tick floor wins.
  const tight = { ...base, stop_loss_price: 6998 };
  assert.equal(isScratch(normalizeTrade({ ...tight, exit_price: 7000.5 })), true);  // 2 ticks
  assert.equal(isScratch(normalizeTrade({ ...tight, exit_price: 7000.75 })), false); // 3 ticks

  // No stop: threshold is 2 ticks.
  const noStop = { ...base, stop_loss_price: null as number | null };
  assert.equal(isScratch(normalizeTrade({ ...noStop, exit_price: 7000.5 })), true);
  assert.equal(isScratch(normalizeTrade({ ...noStop, exit_price: 7000.75 })), false);
});

test("planned R and exit flag reason", () => {
  const scalp = demoTrades.find((item) => item.id === "mnq-late-chase");
  const winner = demoTrades.find((item) => item.id === "mnq-trend-hold");
  assert.ok(scalp && winner);

  const scalpPlan = plannedRewardRisk(scalp);
  assert.ok(scalpPlan != null);
  assert.equal(formatR(scalpPlan), "+2.0R");
  assert.equal(formatR(plannedRewardRisk(winner)!), "+3.0R");
  assert.equal(exitFlagReason(scalp), "SL");
  assert.equal(exitFlagReason(winner), "TP");
  assert.equal(exitFlagReason({ ...scalp, exit_price: 27870 }), null);
});

// ---- Sample trades: plan fixed at entry, outcome walked from real Yahoo 1m bars ----

const POINT_VALUE: Record<string, number> = { MES: 5, MNQ: 2 };
const TICK = 0.25;

function barsFor(id: string): Candle[] {
  return getSampleCandles(id, sampleBars) ?? [];
}

test("every sample trade has a realistic plan fixed at entry", () => {
  for (const trade of demoTrades) {
    assert.equal(trade.is_sample, true, trade.id);
    const stop = trade.stop_loss_price!;
    const target = trade.planned_target_price!;
    assert.ok(stop != null && target != null, `${trade.id} needs a stop and a target`);
    const sign = trade.direction === "LONG" ? 1 : -1;
    const risk = (trade.entry_price - stop) * sign;
    const reward = (target - trade.entry_price) * sign;
    assert.ok(risk > 0 && reward > 0, `${trade.id}: stop and target must sit on opposite sides of entry`);
    const [minStop, maxStop] = trade.symbol === "MES" ? [3, 15] : [15, 80];
    assert.ok(risk >= minStop && risk <= maxStop, `${trade.id}: ${risk}-point stop is outside ${minStop}-${maxStop}`);
    const rr = reward / risk;
    assert.ok(rr >= 1.5 - 1e-9 && rr <= 3 + 1e-9, `${trade.id}: planned ${rr.toFixed(2)}R is outside 1.5R-3R`);
    const dollars = risk * POINT_VALUE[trade.symbol] * trade.quantity;
    assert.ok(dollars >= 200 && dollars <= 260, `${trade.id}: risk $${dollars} is not about $250`);
  }
});

test("every sample outcome is coherent with real 1m bars", () => {
  const kinds = new Set<string>();
  for (const trade of demoTrades) {
    assert.ok(isClosed(trade), `${trade.id} is a closed fixture`);
    const candles = barsFor(trade.id);
    assert.ok(candles.length >= 2, `${trade.id} needs recorded bars`);
    const entryBarTime = Date.parse(trade.entry_time);
    const entryBar = candles.find((c) => c.time === entryBarTime);
    assert.ok(entryBar, `${trade.id}: entry bar is recorded`);
    assert.equal(entryBar.open, trade.entry_price, `${trade.id}: entry price is that bar's open`);
    const check = validateTradeAgainstBars(trade, candles);
    assert.equal(check.coverage, "complete", `${trade.id} should have complete bar coverage`);
    assert.deepEqual(check.issues, [], `${trade.id} must have no validator findings`);

    const sign = trade.direction === "LONG" ? 1 : -1;
    const stop = trade.stop_loss_price!;
    const target = trade.planned_target_price!;
    const exitBarTime = Math.floor(Date.parse(trade.exit_time) / minute) * minute;
    // During the hold, no bar before the exit bar touched either plan level (the exit bar is where it was hit, if at all).
    for (const candle of candles.filter((c) => c.time >= entryBarTime && c.time < exitBarTime)) {
      const stopHit = sign > 0 ? candle.low <= stop : candle.high >= stop;
      const targetHit = sign > 0 ? candle.high >= target : candle.low <= target;
      assert.ok(!stopHit && !targetHit, `${trade.id}: a plan level traded at ${new Date(candle.time).toISOString()} before the exit`);
    }
    const exitBar = candles.find((c) => c.time === exitBarTime);
    assert.ok(exitBar, `${trade.id}: exit bar is recorded`);
    const nearStop = Math.abs(trade.exit_price - stop) <= TICK;
    const nearTarget = Math.abs(trade.exit_price - target) <= TICK;
    if (trade.exit_price === stop) {
      assert.ok(sign > 0 ? exitBar.low <= stop : exitBar.high >= stop, `${trade.id}: stop exit bar must reach the stop`);
      kinds.add("SL");
    } else if (trade.exit_price === target) {
      assert.ok(sign > 0 ? exitBar.high >= target : exitBar.low <= target, `${trade.id}: target exit bar must reach the target`);
      kinds.add("TP");
    } else {
      assert.ok(!nearStop && !nearTarget, `${trade.id}: a manual exit may not sit within a tick of the stop or target`);
      assert.equal(trade.exit_price, exitBar.close, `${trade.id}: manual exit is at its bar's close`);
      kinds.add(isScratch(trade) ? "scratch" : (trade.exit_price - trade.entry_price) * sign > 0 ? "manual-profit" : "manual-loss");
    }
  }
  for (const kind of ["TP", "SL", "manual-profit", "scratch"]) assert.ok(kinds.has(kind), `samples need a ${kind} outcome`);
});

test("sample refresh preserves user notes, checklist, tags and playbook", () => {
  const fixture = demoTrades[0];
  assert.ok(isClosed(fixture));
  const stored = normalizeTrade({
    ...fixture,
    note: "My review of this scenario.",
    playbook_id: "orb-reclaim",
    quick_tags: ["My Tag"],
    checklist_state: [{ id: "a", label: "Plan written", checked: true }],
    pre_trade_thesis: "Thesis I typed",
    management_notes: "Managed it this way",
    post_exit_notes: "Would not take it again",
    flagged: true,
    take_again: "pass",
    take_again_at: "2026-11-15T08:00:00.000Z",
    review_status: "reviewed",
    // Stale fixture facts that a new build should replace:
    entry_price: fixture.entry_price + 10,
    exit_price: fixture.exit_price + 10,
    stop_loss_price: (fixture.stop_loss_price ?? 0) + 10,
  });
  const refreshed = applyFixtureRefresh(stored, fixture);
  assert.equal(refreshed.entry_price, fixture.entry_price);
  assert.equal(refreshed.exit_price, fixture.exit_price);
  assert.equal(refreshed.stop_loss_price, fixture.stop_loss_price);
  assert.equal(refreshed.planned_target_price, fixture.planned_target_price);
  assert.equal(refreshed.entry_time, fixture.entry_time);
  assert.equal(refreshed.note, "My review of this scenario.");
  assert.equal(refreshed.playbook_id, "orb-reclaim");
  assert.deepEqual(refreshed.quick_tags, ["My Tag"]);
  assert.deepEqual(refreshed.checklist_state, [{ id: "a", label: "Plan written", checked: true }]);
  assert.equal(refreshed.pre_trade_thesis, "Thesis I typed");
  assert.equal(refreshed.management_notes, "Managed it this way");
  assert.equal(refreshed.post_exit_notes, "Would not take it again");
  assert.equal(refreshed.flagged, true);
  assert.equal(refreshed.take_again, "pass");
  assert.equal(refreshed.take_again_at, "2026-11-15T08:00:00.000Z");
  assert.equal(refreshed.review_status, "reviewed");
  assert.equal(refreshed.is_sample, true);
});

test("a first-time sample keeps fixture default annotations", () => {
  const fixture = demoTrades[0];
  // No stored copy: the fixture itself is what a new device gets.
  assert.ok(fixture.note.length > 0);
  assert.equal(applyFixtureRefresh(fixture, fixture).note, fixture.note);
  assert.deepEqual(applyFixtureRefresh(fixture, fixture).quick_tags, fixture.quick_tags);
  assert.equal(applyFixtureRefresh(fixture, fixture).playbook_id, fixture.playbook_id);
});
