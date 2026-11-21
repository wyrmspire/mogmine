// Data and formatting cases used by the running stats card (R-08b).
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMoney, formatPercent, formatR } from "../format.ts";
import { playbookName } from "../playbooks.ts";
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
    exit_price: 6010, // +$50 gross
    entry_time: "2026-11-20T15:00:00.000Z",
    exit_time: "2026-11-20T15:30:00.000Z",
    stop_loss_price: 5995, // 5 pts risk = +2R
    status: "closed",
    is_sample: false,
    ...overrides,
  });
}

test("R-08b data: a sample-only journal has no eligible trades", () => {
  const sample1 = makeTrade({ is_sample: true });
  const sample2 = makeTrade({ is_sample: true });

  const stats = runningStats([sample1, sample2], NOW);
  assert.equal(stats.overall.tradeCount, 0);
  assert.equal(stats.excludedSampleCount, 2);
  assert.equal(stats.excludedOpenCount, 0);
  assert.equal(stats.undatedCount, 0);
});

test("R-08b data: mixed priced, unpriced, open and undated trades", () => {
  const closedWinner = makeTrade({
    entry_price: 6000,
    exit_price: 6010,
    stop_loss_price: 5995,
  }); // +$50, +2R
  const closedUnpriceable = makeTrade({
    exit_price: 6000.1, // off-tick -> unpriceable
    stop_loss_price: 5995,
  }); // unpriceable
  const closedNoStop = makeTrade({
    entry_price: 6000,
    exit_price: 6005,
    stop_loss_price: null,
  }); // +$25, null R
  const openTrade = makeTrade({
    status: "open",
    exit_time: null,
    exit_price: null,
  });
  const undatedTrade = makeTrade({
    exit_time: "invalid-time",
    entry_price: 6000,
    exit_price: 6005,
  });

  const stats = runningStats(
    [closedWinner, closedUnpriceable, closedNoStop, openTrade, undatedTrade],
    NOW,
  );

  // Overall counts 4 closed trades (including undated)
  assert.equal(stats.overall.tradeCount, 4);
  assert.equal(stats.overall.pricedCount, 3);
  assert.equal(stats.overall.unpriceableCount, 1);
  assert.equal(stats.overall.incomplete, true);
  assert.equal(stats.overall.grossPnl, 100); // 50 + 25 + 25
  assert.equal(stats.overall.skippedRCount, 2); // closedUnpriceable (no valid R) + closedNoStop
  assert.equal(stats.excludedOpenCount, 1);
  assert.equal(stats.undatedCount, 1);

  // Formatting checks
  assert.equal(formatMoney(stats.overall.grossPnl), "+$100.00");
  assert.equal(formatPercent(stats.overall.winRate), "100%");
  assert.equal(formatR(stats.overall.totalR), "+3.0R");

  assert.equal(stats.thisWeek.tradeCount, 0);
});

test("R-08b data: an unpriceable trade and a scratch without a stop have distinct counts", () => {
  const unpriceable = makeTrade({ exit_price: 6000.1 });
  const noPrice = runningStats([unpriceable], NOW).overall;
  assert.equal(noPrice.pricedCount, 0);
  assert.equal(noPrice.winRate, null);
  assert.equal(noPrice.incomplete, true);

  const scratch = makeTrade({ exit_price: 6000, stop_loss_price: null });
  const summary = runningStats([unpriceable, scratch], NOW).overall;
  assert.equal(summary.pricedCount, 1);
  assert.equal(summary.scratches, 1);
  assert.equal(summary.skippedRCount, 2);
  assert.equal(summary.totalR, null);
});

test("R-08b running stats breakdowns: playbook name mapping and tag aggregation", () => {
  const p1 = makeTrade({
    playbook_id: "orb-reclaim",
    quick_tags: ["Opening Drive", "A+ Patience"],
  });
  const p2 = makeTrade({
    playbook_id: "onl-sweep-smt",
    quick_tags: ["Opening Drive"],
  });
  const p3 = makeTrade({
    playbook_id: null,
    quick_tags: [],
  });

  const stats = runningStats([p1, p2, p3], NOW);

  assert.equal(stats.byPlaybook.length, 3);
  const orb = stats.byPlaybook.find((p) => p.playbookId === "orb-reclaim");
  assert.ok(orb);
  assert.equal(playbookName(orb.playbookId), "ORB Reclaim");
  assert.equal(orb.tradeCount, 1);

  const unassigned = stats.byPlaybook.find((p) => p.playbookId === null);
  assert.ok(unassigned);
  assert.equal(playbookName(unassigned.playbookId), null);

  assert.equal(stats.byTag.length, 2);
  const openingDrive = stats.byTag.find((t) => t.tag === "Opening Drive");
  assert.ok(openingDrive);
  assert.equal(openingDrive.tradeCount, 2);
});
