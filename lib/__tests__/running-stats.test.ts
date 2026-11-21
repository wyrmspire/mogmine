// Tests for pure cross-day & playbook/tag running stats (R-08a).
import assert from "node:assert/strict";
import { test } from "node:test";
import { runningStats } from "../selectors.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const NOW = "2026-11-26T18:00:00Z";
let nextTradeId = 0;

function makeTrade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({
    id: `test-${++nextTradeId}`,
    user_id: "u1",
    account_id: null,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_price: 6000,
    exit_price: 6005, // +5 pts = +$25
    entry_time: "2026-11-16T15:00:00.000Z",
    exit_time: "2026-11-16T15:30:00.000Z",
    stop_loss_price: 5995, // 5 pts risk -> 1R
    status: "closed",
    is_sample: false,
    ...overrides,
  });
}

test("runningStats handles empty sets and distinguishes omitted R from a scratch", () => {
  const empty = runningStats([], NOW).overall;
  assert.equal(empty.tradeCount, 0);
  assert.equal(empty.wins, 0);
  assert.equal(empty.losses, 0);
  assert.equal(empty.scratches, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.grossPnl, 0);
  assert.equal(empty.totalR, null);
  assert.equal(empty.avgR, null);
  assert.equal(empty.withR, 0);
  assert.equal(empty.skippedRCount, 0);
  assert.equal(empty.ruleAdherence, null);

  const t1 = makeTrade({ entry_price: 6000, exit_price: 6010, stop_loss_price: 5995 }); // +10 pts ($50), risk 5 pts => +2R
  const t2 = makeTrade({ entry_price: 6000, exit_price: 5995, stop_loss_price: 5995 }); // -5 pts (-$25), risk 5 pts => -1R
  const t3 = makeTrade({ entry_price: 6000, exit_price: 6000, stop_loss_price: 5990 }); // 0 pts ($0 scratch), risk 10 pts => 0R
  const t4 = makeTrade({ entry_price: 6000, exit_price: 6005, stop_loss_price: null }); // +5 pts ($25), no stop => null R

  const summary = runningStats([t1, t2, t3, t4], NOW).overall;
  assert.equal(summary.tradeCount, 4);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 1);
  assert.equal(summary.scratches, 1);
  assert.equal(summary.winRate, 2 / 4);
  assert.equal(summary.grossPnl, 50); // 50 - 25 + 0 + 25 = 50
  assert.equal(summary.withR, 3);
  assert.equal(summary.skippedRCount, 1);
  assert.equal(summary.totalR, 1); // 2 - 1 + 0 = 1
  assert.ok(Math.abs((summary.avgR ?? 0) - 1 / 3) < 1e-10);
});

test("unpriceable trades are counted without affecting gross or the win-rate denominator", () => {
  const winner = makeTrade({ symbol: "MNQ", direction: "SHORT", quantity: 3, exit_price: 5999.75 });
  const invalid = makeTrade({ exit_price: 6000.1 });
  const { overall } = runningStats([winner, invalid], NOW);
  assert.equal(overall.tradeCount, 2);
  assert.equal(overall.grossPnl, 1.5);
  assert.equal(overall.pricedCount, 1);
  assert.equal(overall.unpriceableCount, 1);
  assert.equal(overall.incomplete, true);
  assert.equal(overall.winRate, 1);
  assert.equal(overall.scratches, 0);
  assert.equal(overall.skippedRCount, 2);
  assert.equal(runningStats([invalid], NOW).overall.winRate, null);
  assert.equal(runningStats([winner], NOW).overall.incomplete, false);
});

test("runningStats excludes sample trades and open trades", () => {
  const real = makeTrade({ id: "real-1", exit_price: 6005 });
  const sample = makeTrade({ id: "sample-1", is_sample: true, exit_price: 6010 });
  const open = makeTrade({ id: "open-1", status: "open", exit_price: null, exit_time: null });

  const stats = runningStats([real, sample, open], NOW);
  assert.equal(stats.excludedSampleCount, 1);
  assert.equal(stats.excludedOpenCount, 1);
  assert.equal(stats.overall.tradeCount, 1);
  assert.equal(stats.overall.grossPnl, 25);
});

test("runningStats calculates last 20 rolling window", () => {
  const trades: TradeRecord[] = [];
  for (let i = 1; i <= 25; i++) {
    trades.push(
      makeTrade({
        id: `t-${i}`,
        entry_time: `2026-11-${String(i).padStart(2, "0")}T15:00:00.000Z`,
        exit_time: `2026-11-${String(i).padStart(2, "0")}T15:30:00.000Z`,
        entry_price: 6000,
        exit_price: 6000 + i, // +i points => i * $5
      }),
    );
  }

  const stats = runningStats(trades.reverse(), NOW);
  assert.equal(stats.overall.tradeCount, 25);
  assert.equal(stats.last20.tradeCount, 20);

  // The last 20 trades are i = 6 to 25.
  // sum(6..25) = (6 + 25) * 20 / 2 = 310 points => 310 * $5 = $1550
  assert.equal(stats.last20.grossPnl, 1550);
});

test("last 20 uses id to break a tie at the cutoff", () => {
  const trades = Array.from({ length: 20 }, (_, i) => makeTrade({ id: `trade-${i}` }));
  const first = makeTrade({ id: "a", exit_price: 5995 });
  assert.equal(runningStats([...trades, first], NOW).last20.grossPnl, 500);
  assert.equal(runningStats([first, ...trades], NOW).last20.grossPnl, 500);
});

test("runningStats calculates thisWeek and thisMonth windows based on session date", () => {
  // Session week Monday for 2026-11-16 is 2026-11-16.
  // Friday 2026-11-20 is same week.
  // Monday 2026-11-23 is next week.
  // October 2026-10-30 is previous month.
  const tNov1 = makeTrade({
    id: "nov-16",
    entry_time: "2026-11-16T15:00:00.000Z",
    exit_time: "2026-11-16T15:30:00.000Z",
    exit_price: 6010, // +$50
  });
  const tNov2 = makeTrade({
    id: "nov-18",
    entry_time: "2026-11-18T15:00:00.000Z",
    exit_time: "2026-11-18T15:30:00.000Z",
    exit_price: 6010, // +$50
  });
  const tNovPriorWeek = makeTrade({
    id: "nov-10",
    entry_time: "2026-11-10T15:00:00.000Z",
    exit_time: "2026-11-10T15:30:00.000Z",
    exit_price: 6010, // +$50
  });
  const tOct = makeTrade({
    id: "oct-30",
    entry_time: "2026-10-30T15:00:00.000Z",
    exit_time: "2026-10-30T15:30:00.000Z",
    exit_price: 6010, // +$50
  });

  // Reference now is during the Nov 16-20 week
  const stats = runningStats([tOct, tNovPriorWeek, tNov1, tNov2], "2026-11-19T18:00:00Z");

  assert.equal(stats.overall.tradeCount, 4);
  assert.equal(stats.overall.grossPnl, 200);

  // This month: 3 trades (nov-10, nov-16, nov-18)
  assert.equal(stats.thisMonth.tradeCount, 3);
  assert.equal(stats.thisMonth.grossPnl, 150);

  // This week: 2 trades (nov-16, nov-18)
  assert.equal(stats.thisWeek.tradeCount, 2);
  assert.equal(stats.thisWeek.grossPnl, 100);

  const inactive = runningStats([tNov2], "2026-12-01T18:00:00Z");
  assert.equal(inactive.overall.tradeCount, 1);
  assert.equal(inactive.last20.tradeCount, 1);
  assert.equal(inactive.thisWeek.tradeCount, 0);
  assert.equal(inactive.thisMonth.tradeCount, 0);
});

test("Sunday Globex open moves the exit into a new week and month", () => {
  const friday = makeTrade({ entry_time: "2026-10-30T19:00:00Z", exit_time: "2026-10-30T19:30:00Z" });
  const sunday = makeTrade({ entry_time: "2026-10-30T19:00:00Z", exit_time: "2026-11-01T23:00:00Z", exit_price: 6010 });
  const stats = runningStats([friday, sunday], Date.parse("2026-11-02T01:00:00Z"));
  assert.equal(stats.thisWeek.tradeCount, 1);
  assert.equal(stats.thisWeek.grossPnl, 50);
  assert.equal(stats.thisMonth.tradeCount, 1);
  assert.equal(stats.thisMonth.grossPnl, 50);
});

test("the 18:00 ET session cutoff uses the winter offset at month end", () => {
  const november = makeTrade({ exit_time: "2026-11-30T22:59:59Z" });
  const december = makeTrade({ exit_time: "2026-11-30T23:00:00Z", exit_price: 6010 });
  const stats = runningStats([november, december], "2026-11-30T23:01:00Z");
  assert.equal(stats.thisWeek.tradeCount, 2);
  assert.equal(stats.thisMonth.tradeCount, 1);
  assert.equal(stats.thisMonth.grossPnl, 50);
});

test("an invalid saved exit is reported and stays in all-time results only", () => {
  const undated = makeTrade({ exit_time: "invalid", playbook_id: "orb-reclaim", quick_tags: ["Opening Drive"] });
  const dated = makeTrade({ exit_time: "2026-11-26T17:00:00Z" });
  const stats = runningStats([undated, dated], NOW);
  assert.equal(stats.undatedCount, 1);
  assert.equal(stats.overall.grossPnl, 50);
  assert.equal(stats.byPlaybook.find((group) => group.playbookId === "orb-reclaim")?.grossPnl, 25);
  assert.equal(stats.byTag[0].grossPnl, 25);
  assert.equal(stats.last20.tradeCount, 1);
  assert.equal(stats.thisWeek.tradeCount, 1);
  assert.equal(stats.thisMonth.tradeCount, 1);
});

test("runningStats groups by playbook and tag with rule adherence", () => {
  const p1 = makeTrade({
    id: "p1",
    playbook_id: "orb-reclaim",
    quick_tags: ["Opening Drive", "A+ Patience", "Opening Drive"],
    checklist_state: [
      { id: "r1", label: "Rule 1", checked: true },
      { id: "r2", label: "Rule 2", checked: true },
    ],
    exit_price: 6010, // +$50, +2R
    stop_loss_price: 5995,
  });

  const p2 = makeTrade({
    id: "p2",
    playbook_id: "orb-reclaim",
    quick_tags: ["Opening Drive", "Chased Entry"],
    checklist_state: [
      { id: "r1", label: "Rule 1", checked: true },
      { id: "r2", label: "Rule 2", checked: false },
    ],
    exit_price: 5995, // -$25, -1R
    stop_loss_price: 5995,
  });

  const p3 = makeTrade({
    id: "p3",
    playbook_id: "vwap-trend-push",
    quick_tags: ["VWAP Hold"],
    checklist_state: [],
    exit_price: 6005, // +$25
    stop_loss_price: null, // no stop -> skipped R
  });

  const stats = runningStats([p1, p2, p3], NOW);

  // Playbooks: orb-reclaim (2 trades), vwap-trend-push (1 trade)
  assert.equal(stats.byPlaybook.length, 2);
  const orb = stats.byPlaybook.find((p) => p.playbookId === "orb-reclaim")!;
  assert.ok(orb);
  assert.equal(orb.tradeCount, 2);
  assert.equal(orb.wins, 1);
  assert.equal(orb.losses, 1);
  assert.equal(orb.winRate, 0.5);
  assert.equal(orb.grossPnl, 25);
  assert.equal(orb.totalR, 1);
  assert.equal(orb.avgR, 0.5);
  assert.equal(orb.withR, 2);
  assert.equal(orb.skippedRCount, 0);
  assert.deepEqual(orb.ruleAdherence, {
    followed: 3,
    total: 4,
    ratio: 0.75,
    perfectTrades: 1,
    gradedTrades: 2,
  });

  const vwap = stats.byPlaybook.find((p) => p.playbookId === "vwap-trend-push")!;
  assert.ok(vwap);
  assert.equal(vwap.tradeCount, 1);
  assert.equal(vwap.totalR, null);
  assert.equal(vwap.avgR, null);
  assert.equal(vwap.withR, 0);
  assert.equal(vwap.skippedRCount, 1);
  assert.equal(vwap.ruleAdherence, null);

  // Tags
  const openingDrive = stats.byTag.find((t) => t.tag === "Opening Drive")!;
  assert.ok(openingDrive);
  assert.equal(openingDrive.tradeCount, 2);
  assert.equal(openingDrive.wins, 1);
  assert.equal(openingDrive.losses, 1);

  const patience = stats.byTag.find((t) => t.tag === "A+ Patience")!;
  assert.ok(patience);
  assert.equal(patience.tradeCount, 1);
  assert.equal(patience.wins, 1);
});
