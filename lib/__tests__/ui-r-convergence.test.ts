// R3-09 (MOGMINE-BLUEPRINT §2.6, docs/04-r-size §3.5): every screen that shows R passes live accounts
// and prefs into the R-consuming selectors. A $300 account trade with r_size_cents null and +$75 is +0.25R
// in each of them; the $250 fallback would say +0.30R. Source checks pin the wiring; selector checks pin the maths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_MOOD_REGISTRY, moodOutcomeStats } from "../mood.ts";
import type { MoodRecord } from "../mood.ts";
import { takeVsPass } from "../drills.ts";
import type { DrillRecord } from "../drills.ts";
import { binderView } from "../playbook-binder.ts";
import type { Playbook } from "../playbooks.ts";
import { groupByDay, runningStats } from "../selectors.ts";
import { normalizeTrade } from "../trades.ts";
import type { RSizeOptions, TradeRecord } from "../trades.ts";

const NOW = Date.parse("2026-11-26T18:00:00Z");
const DAY = "2026-11-16";
const ACCOUNT = { id: "acct", r_size_cents: 30_000 };
const OPTS: RSizeOptions = { accounts: [ACCOUNT], prefs: { riskBudgetUsd: 250 } };

/** A legacy closed MES long: 6000 → 6015 is 15 points at $5/point, +$75 on a $300 account. */
const winner = (id: string, patch: Partial<TradeRecord> = {}): TradeRecord =>
  normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    entry_time: `${DAY}T15:00:00.000Z`,
    exit_time: `${DAY}T15:30:00.000Z`,
    entry_price: 6000,
    exit_price: 6015,
    stop_loss_price: 5995,
    initial_stop_price: 5995,
    status: "closed",
    is_sample: false,
    playbook_id: "pb",
    account_id: "acct",
    r_size_cents: null,
    ...patch,
  });

const trade = winner("t1");
const tenTrades = Array.from({ length: 10 }, (_, index) => winner(`t${index + 1}`));
const playbook: Playbook = {
  id: "pb",
  user_id: "u",
  name: "Opening drive",
  default_style: "session_90m",
  checklist_rules: [],
  archived: false,
};
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

const read = (relativePath: string) => readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("fixture: the $300 account trade has no snapshot R and +$75 P&L", () => {
  assert.equal(trade.r_size_cents, null);
  assert.equal(trade.account_id, "acct");
});

test("each screen imports useAccounts and passes accounts + prefs into its R selector", () => {
  const today = read("components/TodayScreen.tsx");
  assert.match(today, /import \{ useAccounts \} from "@\/lib\/accounts-store"/);
  assert.match(today, /groupByDay\(trades, \{ accounts: accounts\.accounts, prefs \}\)/);

  const feed = read("components/FeedScreen.tsx");
  assert.match(feed, /import \{ useAccounts \} from "@\/lib\/accounts-store"/);
  assert.match(feed, /groupByDay\(shown, \{ accounts: accounts\.accounts, prefs \}\)/);

  const running = read("components/RunningStatsCard.tsx");
  assert.match(running, /import \{ useAccounts \} from "@\/lib\/accounts-store"/);
  assert.match(running, /import \{ usePrefs \} from "@\/lib\/prefs"/);
  assert.match(running, /runningStats\(trades, now, \{ accounts: accounts\.accounts, prefs \}\)/);
  assert.match(running, /\[trades, now, accounts\.accounts, prefs\]/);

  const drills = read("components/DrillScreen.tsx");
  assert.match(drills, /const accounts = useAccounts\(\)/);
  assert.match(drills, /missesDeck\(journal\.trades, records, now, hasBars, rSize\)/);
  assert.match(drills, /takeVsPass\(records, journal\.trades, rSize\)/);
  assert.match(drills, /isMiss\(answer, trade, \{ accounts: accounts\.accounts, prefs \}\)/);

  const binder = read("components/PlaybookBinder.tsx");
  assert.match(binder, /import \{ useAccounts \} from "@\/lib\/accounts-store"/);
  assert.match(binder, /binderView\(playbooks\.playbooks, journal\.trades, records, now, \{ accounts: accounts\.accounts, prefs \}\)/);

  const mood = read("components/MoodCard.tsx");
  assert.match(mood, /import \{ useAccounts \} from "@\/lib\/accounts-store"/);
  assert.match(mood, /import \{ usePrefs \} from "@\/lib\/prefs"/);
  assert.match(mood, /similarTrades\(trade, journal\.trades, mood\.records, mood\.registry, \{ rSize \}\)/);
  assert.match(mood, /moodOutcomeStats\(trades, mood\.records, mood\.registry, \{ phase: preExit \? "pre_exit" : "any", rSize \}\)/);
});

test("Feed and Today day groups report +0.25R on a $300 account", () => {
  assert.equal(groupByDay([trade], OPTS)[0].stats.netR, 0.25);
});

test("Today running stats report +0.25R on a $300 account", () => {
  assert.equal(runningStats([trade], NOW, OPTS).overall.avgR, 0.25);
});

test("Playbook binder reports +0.25R on a $300 account", () => {
  const binder = binderView([playbook], tenTrades, thirtyAnswers, NOW, OPTS);
  assert.equal(binder.cards[0].stats.avgR, 0.25);
});

test("Drills take-vs-pass reports +0.25R on a $300 account", () => {
  assert.equal(takeVsPass(thirtyAnswers, tenTrades, OPTS).take.avgR, 0.25);
});

test("Mood shape outcome stats report +0.25R on a $300 account", () => {
  const mood = moodOutcomeStats([trade], moodRecords, DEFAULT_MOOD_REGISTRY, { rSize: OPTS });
  assert.deepEqual(mood.byDominant.flatMap((group) => group.summary.values), [0.25]);
});

test("the $250 fallback would say +0.30R, so omitting the accounts fails the check", () => {
  assert.equal(groupByDay([trade], { prefs: { riskBudgetUsd: 250 } })[0].stats.netR, 0.3);
});
