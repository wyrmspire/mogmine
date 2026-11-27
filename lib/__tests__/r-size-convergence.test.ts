// R-04 (MOGMINE-BLUEPRINT §2.6): every library consumer resolves R the same way. A legacy trade with
// `r_size_cents: null` must use its account's $300 R size (or prefs.riskBudgetUsd when unassigned),
// never the $250 DEFAULT_PREFS fallback. The fixture makes +$150: +0.50R at $300, +0.60R at $250.
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTrade } from "../describe.ts";
import { DEFAULT_MOOD_REGISTRY, moodOutcomeStats } from "../mood.ts";
import type { MoodRecord } from "../mood.ts";
import { takeVsPass } from "../drills.ts";
import type { DrillRecord } from "../drills.ts";
import { playbookCardData } from "../playbook-card.ts";
import { binderView } from "../playbook-binder.ts";
import type { Playbook } from "../playbooks.ts";
import { dayStats, groupByDay, runningStats } from "../selectors.ts";
import { normalizeTrade } from "../trades.ts";
import type { RSizeOptions, TradeRecord } from "../trades.ts";

const NOW = Date.parse("2026-11-26T18:00:00Z");
const DAY = "2026-11-16";
const ACCOUNT = { id: "acct", r_size_cents: 30_000 };

/** A legacy closed MES long: 6000 → 6030 is 30 points, +$150 (1 MES = $5/point). */
const legacy = (id: string, patch: Partial<TradeRecord> = {}): TradeRecord =>
  normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: `${DAY}T15:00:00.000Z`,
    exit_time: `${DAY}T15:30:00.000Z`,
    entry_price: 6000,
    exit_price: 6030,
    stop_loss_price: 5995,
    initial_stop_price: 5995,
    status: "closed",
    is_sample: false,
    playbook_id: "pb",
    account_id: "acct",
    r_size_cents: null,
    ...patch,
  });

const playbook: Playbook = {
  id: "pb",
  user_id: "u",
  name: "Opening drive",
  default_style: "session_90m",
  checklist_rules: [],
  archived: false,
};

const trade = legacy("t1");
const tenTrades = Array.from({ length: 10 }, (_, index) => legacy(`t${index + 1}`));
const thirtyAnswers: DrillRecord[] = Array.from({ length: 30 }, (_, index) => ({
  id: `d${index}`,
  user_id: "u",
  trade_id: `t${(index % 10) + 1}`,
  kind: "take_it",
  answer: "take",
  answered_at: new Date(Date.parse("2026-11-20T12:00:00Z") + index * 60_000).toISOString(),
  hidden: [],
}));
const moodRecords: MoodRecord[] = [{
  id: "m1",
  trade_id: "t1",
  spoke_set_version: DEFAULT_MOOD_REGISTRY.version,
  scores: { calm: 0.9 },
  evidence: {},
  source: "user",
  model: null,
  captured_at: null,
  created_at: "2026-11-16T16:00:00.000Z",
}];

/** Runs every R-consuming library function and returns the R each one reports for `trade`. */
function reportedR(opts: RSizeOptions) {
  const description = describeTrade(trade, "America/Chicago", false, opts);
  const mood = moodOutcomeStats([trade], moodRecords, DEFAULT_MOOD_REGISTRY, { rSize: opts });
  const card = playbookCardData(playbook, tenTrades, thirtyAnswers, NOW, opts);
  const binder = binderView([playbook], tenTrades, thirtyAnswers, NOW, opts);
  return {
    dayStats: dayStats([trade], opts).netR,
    groupByDay: groupByDay([trade], opts)[0].stats.netR,
    runningStats: runningStats([trade], NOW, opts).overall.avgR,
    takeVsPass: takeVsPass(thirtyAnswers, tenTrades, opts).take.avgR,
    playbookCardData: card.stats.avgR,
    binderModel: binder.cards[0].stats.avgR,
    moodOutcomeStats: mood.byDominant.flatMap((group) => group.summary.values),
    describeTrade: description.includes("plus 0.50 R") ? 0.5 : description,
  };
}

const EXPECTED_ALL = {
  dayStats: 0.5,
  groupByDay: 0.5,
  runningStats: 0.5,
  takeVsPass: 0.5,
  playbookCardData: 0.5,
  binderModel: 0.5,
  moodOutcomeStats: [0.5],
  describeTrade: 0.5,
};

test("legacy trade on a $300 account reports +0.50R everywhere, never the $250 fallback", () => {
  assert.equal(trade.account_id, "acct");
  assert.equal(trade.r_size_cents, null);
  assert.deepEqual(reportedR({ accounts: [ACCOUNT] }), EXPECTED_ALL);
});

test("unassigned legacy trade with prefs.riskBudgetUsd 300 reports +0.50R everywhere", () => {
  const unassigned = legacy("t1", { account_id: null });
  const single = [unassigned];
  const prefs = { riskBudgetUsd: 300 };
  assert.equal(dayStats(single, { prefs }).netR, 0.5);
  assert.equal(groupByDay(single, { prefs })[0].stats.netR, 0.5);
  assert.equal(runningStats(single, NOW, { prefs }).overall.avgR, 0.5);
  assert.equal(takeVsPass(thirtyAnswers, tenTrades.map((t) => ({ ...t, account_id: null })), { prefs }).take.avgR, 0.5);
  assert.equal(playbookCardData(playbook, tenTrades.map((t) => ({ ...t, account_id: null })), thirtyAnswers, NOW, { prefs }).stats.avgR, 0.5);
  assert.equal(binderView([playbook], tenTrades.map((t) => ({ ...t, account_id: null })), thirtyAnswers, NOW, { prefs }).cards[0].stats.avgR, 0.5);
  const mood = moodOutcomeStats(single, moodRecords, DEFAULT_MOOD_REGISTRY, { rSize: { prefs } });
  assert.deepEqual(mood.byDominant.flatMap((group) => group.summary.values), [0.5]);
  assert.ok(describeTrade(unassigned, "America/Chicago", false, { prefs }).includes("plus 0.50 R"));
});

test("without opts the default R size still applies ($300 owner default)", () => {
  // Legacy trade with no account and no prefs uses DEFAULT_R_SIZE_CENTS ($300): +$150 is +0.50R.
  const unassigned = legacy("t1", { account_id: null });
  assert.equal(dayStats([unassigned]).netR, 0.5);
  assert.ok(describeTrade(unassigned, "America/Chicago").includes("plus 0.50 R"));
});
