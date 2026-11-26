// DR-1a: daily review model, sanitizer, local store and backup (docs/design-2026-11-24/06 §2 rules 1–6, §2.1; Q-3, Q-4 in 92).
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAILY_REVIEW_LIMITS,
  dailyReviewId,
  dailyReviewScopeKey,
  dailyReviewTotals,
  findExistingDailyReview,
  makeDailyReview,
  proposePlanIds,
  proposeTradeIds,
  unlinkedDayTradeIds,
} from "../daily-review.ts";
import type { DailyReview, ReviewPoint } from "../daily-review.ts";
import {
  getDailyReviews,
  getDailyReviewsBackup,
  getDailyReviewsState,
  removeDailyReview,
  resetDailyReviewsForTests,
  restoreDailyReviews,
  updateDailyReview,
  upsertDailyReview,
} from "../daily-review-store.ts";
import { sanitizeDailyReview, sanitizeDailyReviews, sanitizeDailyReviewsBackup, sanitizeReviewPoint } from "../daily-review-sanitize.ts";
import { buildBackup, parseBackupFile } from "../store.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import type { PlanningSession } from "../plans.ts";

const NOW = "2026-11-23T22:00:00.000Z";

const trade = (id: string, entry_time: string, over: Partial<TradeRecord> = {}): TradeRecord => {
  const entryMs = Date.parse(entry_time);
  return normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    entry_time,
    exit_time: new Date(entryMs + 35 * 60_000).toISOString(),
    entry_price: 7100,
    exit_price: 7120.5,
    stop_loss_price: 7090,
    account_id: "sim-acct-eval-50k",
    ...over,
  });
};

const point = (id: string, over: Partial<ReviewPoint> = {}): ReviewPoint => ({
  id,
  kind: "went_well",
  text: "Waited for the reclaim.",
  trade_id: null,
  ...over,
});

// 2026-11-23 is a Monday. 15:00 ET = 20:00Z; 18:30 ET = 23:30Z (after the 18:00 ET rollover, so session 2026-11-24).
const afternoon = "2026-11-23T20:00:00.000Z";
const globex = "2026-11-23T23:30:00.000Z";

describe("Rule 1: trade proposal by session date and account", () => {
  const trades = [
    trade("t-afternoon", afternoon),
    trade("t-globex", globex),
    trade("t-other-account", "2026-11-23T19:00:00.000Z", { account_id: "other-acct" }),
    trade("t-sample", "2026-11-23T18:00:00.000Z", { is_sample: true }),
  ];

  it("matches sessionDate(entry_time), so an 18:30 ET Globex trade belongs to the next session", () => {
    assert.deepEqual(proposeTradeIds(trades, "2026-11-23", null), ["t-other-account", "t-afternoon"]);
    assert.deepEqual(proposeTradeIds(trades, "2026-11-24", null), ["t-globex"]);
  });

  it("filters by account_id when the scope has one, and keeps all accounts when it is null", () => {
    assert.deepEqual(proposeTradeIds(trades, "2026-11-23", "sim-acct-eval-50k"), ["t-afternoon"]);
    assert.deepEqual(proposeTradeIds(trades, "2026-11-23", "other-acct"), ["t-other-account"]);
    assert.deepEqual(proposeTradeIds(trades, "2026-11-23", null), ["t-other-account", "t-afternoon"]);
  });

  it("leaves sample trades out unless samples are shown", () => {
    assert.ok(!proposeTradeIds(trades, "2026-11-23", null).includes("t-sample"));
    assert.ok(proposeTradeIds(trades, "2026-11-23", null, { includeSamples: true }).includes("t-sample"));
  });

  it("orders proposals chronologically", () => {
    const shuffled = [trade("late", "2026-11-23T20:30:00.000Z"), trade("early", "2026-11-23T19:30:00.000Z")];
    assert.deepEqual(proposeTradeIds(shuffled, "2026-11-23", null), ["early", "late"]);
  });

  it("surfaces a trade logged later for the same day as unlinked", () => {
    const review = makeDailyReview({ session_date: "2026-11-23", account_id: null, trade_ids: ["t-afternoon"], recorded_at: NOW });
    const logged = [...trades, trade("t-new", "2026-11-23T21:00:00.000Z")];
    assert.deepEqual(unlinkedDayTradeIds(review, logged), ["t-other-account", "t-new"]);
  });

  it("proposes plan ids for the same session date, skipping archived plans", () => {
    const plan = (id: string, session_date: string, archived = false): PlanningSession => ({
      id, user_id: "demo-owner", session_date, name: id, preset: null, anchor_time_utc: null,
      created_at: "2026-11-23T12:00:00.000Z", updated_at: "2026-11-23T12:00:00.000Z", observations: "",
      watch_playbook_ids: [], levels: [], revisions: [], archived,
    });
    const plans = [plan("pre", "2026-11-23"), plan("old", "2026-11-23", true), plan("other", "2026-11-20")];
    assert.deepEqual(proposePlanIds(plans, "2026-11-23"), ["pre"]);
  });
});

describe("Rules 2 and 6: totals computed from linked trades, samples excluded", () => {
  it("computes counts, net R, points and rules adherence with buildDayCardData", () => {
    const trades = [
      trade("win", afternoon, { checklist_state: [{ id: "c1", label: "Level", checked: true }] }),
      trade("loss", "2026-11-23T20:30:00.000Z", { exit_price: 7090, checklist_state: [{ id: "c1", label: "Level", checked: false }] }),
    ];
    const review = { session_date: "2026-11-23", trade_ids: ["win", "loss"] };
    const totals = dailyReviewTotals(review, trades, false);
    assert.equal(totals.sessionDate, "2026-11-23");
    assert.equal(totals.tradeCount, 2);
    assert.equal(totals.closedTradeCount, 2);
    assert.equal(totals.winCount, 1);
    assert.equal(totals.lossCount, 1);
    assert.equal(totals.netPoints, 20.5 - 10);
    assert.equal(totals.rulesTotal, 2);
    assert.equal(totals.rulesFollowed, 1);
    assert.equal(totals.adherencePercent, 50);
  });

  it("excludes a linked sample trade from totals", () => {
    const trades = [trade("real", afternoon), trade("sample", "2026-11-23T20:10:00.000Z", { is_sample: true })];
    const totals = dailyReviewTotals({ session_date: "2026-11-23", trade_ids: ["real", "sample"] }, trades, false);
    assert.equal(totals.tradeCount, 1);
  });

  it("hides money under Shield", () => {
    const trades = [trade("real", afternoon)];
    const totals = dailyReviewTotals({ session_date: "2026-11-23", trade_ids: ["real"] }, trades, true);
    assert.equal(totals.shield, true);
    assert.equal(totals.formattedNetMoney, null);
  });

  it("uses the linked trade's live account R when its snapshot is absent", () => {
    const legacy = trade("legacy", afternoon, {
      entry_price: 7000,
      exit_price: 7015,
      quantity: 1,
      r_size_cents: null,
      account_id: "acct-300",
    });
    const totals = dailyReviewTotals(
      { session_date: "2026-11-23", trade_ids: [legacy.id] },
      [legacy],
      false,
      { accounts: [{ id: "acct-300", r_size_cents: 30_000 }], prefs: { riskBudgetUsd: 250 } },
    );
    assert.equal(totals.netR, 0.25);
    assert.equal(totals.trades[0].resultR, 0.25);
  });
});

describe("Rules 3 and 4: text limits and status never touches trades", () => {
  beforeEach(() => resetDailyReviewsForTests());

  it("keeps lesson and point text at exactly 500 characters and cuts longer text", () => {
    const max = "x".repeat(DAILY_REVIEW_LIMITS.lesson);
    const review = sanitizeDailyReview({ ...makeDailyReview({ session_date: "2026-11-23", recorded_at: NOW, lesson: max }), lesson: `${max}yyy` });
    assert.ok(review);
    assert.equal(review.lesson.length, 500);
    const pt = sanitizeReviewPoint({ id: "p", kind: "mistake", text: "y".repeat(600), trade_id: null });
    assert.equal(pt?.text.length, 500);
  });

  it("drops points with an unknown kind or empty text", () => {
    assert.equal(sanitizeReviewPoint({ id: "p", kind: "praise", text: "hi", trade_id: null }), null);
    assert.equal(sanitizeReviewPoint({ id: "p", kind: "observation", text: "   ", trade_id: null }), null);
  });

  it("marking a review done never mutates any trade's review_status", () => {
    const trades = [trade("t1", afternoon), trade("t2", globex)];
    const before = JSON.stringify(trades);
    const statusesBefore = trades.map((t) => t.review_status);
    const saved = upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", trade_ids: ["t1", "t2"], recorded_at: NOW }));
    assert.ok(saved);
    const done = updateDailyReview(saved.id, { status: "done", lesson: "Wait for the close." });
    assert.equal(done?.status, "done");
    assert.equal(JSON.stringify(trades), before);
    assert.deepEqual(trades.map((t) => t.review_status), statusesBefore);
  });
});

describe("Rule 5: one review per (session_date, account_id)", () => {
  beforeEach(() => resetDailyReviewsForTests());

  it("allows a null-scope and an account-scope review on the same day", () => {
    upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", recorded_at: NOW }));
    upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", account_id: "sim-acct-eval-50k", recorded_at: NOW }));
    assert.equal(getDailyReviews().length, 2);
    assert.equal(dailyReviewId("2026-11-23", null), "review-2026-11-23");
    assert.equal(dailyReviewId("2026-11-23", "sim-acct-eval-50k"), "review-2026-11-23-sim-acct-eval-50k");
    assert.equal(dailyReviewScopeKey("2026-11-23", null), "2026-11-23|*");
  });

  it("returns the existing review instead of creating a second null-scope one", () => {
    const first = upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", recorded_at: NOW, lesson: "one" }));
    const second = upsertDailyReview(makeDailyReview({ id: "review-other-id", session_date: "2026-11-23", recorded_at: "2026-11-23T23:00:00.000Z", lesson: "two" }));
    assert.equal(getDailyReviews().length, 1);
    assert.equal(second?.id, first?.id);
    assert.equal(second?.lesson, "two");
    assert.equal(second?.recorded_at, NOW);
    assert.equal(findExistingDailyReview(getDailyReviews(), "2026-11-23", null)?.id, first?.id);
    assert.equal(findExistingDailyReview(getDailyReviews(), "2026-11-23", "sim-acct-eval-50k"), undefined);
  });

  it("sanitizer keeps the first record when a list repeats a (date, account) scope", () => {
    const a = makeDailyReview({ session_date: "2026-11-23", lesson: "first", recorded_at: NOW });
    const b = makeDailyReview({ id: "review-dup", session_date: "2026-11-23", lesson: "second", recorded_at: NOW });
    const list = sanitizeDailyReviews([a, b]);
    assert.equal(list.length, 1);
    assert.equal(list[0].lesson, "first");
  });

  it("rejects impossible session dates and invalid recorded_at", () => {
    assert.equal(sanitizeDailyReview(makeDailyReview({ session_date: "2026-02-30", recorded_at: NOW })), null);
    assert.equal(sanitizeDailyReview(makeDailyReview({ session_date: "11/23/2026", recorded_at: NOW })), null);
    assert.equal(sanitizeDailyReview(makeDailyReview({ session_date: "2026-11-23", recorded_at: "yesterday" })), null);
  });
});

describe("recorded_at integrity", () => {
  beforeEach(() => resetDailyReviewsForTests());

  it("keeps the wall-clock recorded_at across updateDailyReview", () => {
    const created = upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", recorded_at: NOW }));
    assert.ok(created);
    const updated = updateDailyReview(created.id, { lesson: "Later edit", points: [point("p1")] });
    assert.equal(updated?.recorded_at, NOW);
    assert.equal(updated?.lesson, "Later edit");
    assert.equal(updated?.points.length, 1);
    assert.ok(updated?.updated_at);
    assert.equal(updateDailyReview("missing", { lesson: "x" }), null);
  });

  it("removes a review by id", () => {
    const created = upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", recorded_at: NOW }));
    removeDailyReview(created!.id);
    assert.equal(getDailyReviewsState().reviews.length, 0);
  });
});

describe("Backup round-trip and older backups", () => {
  beforeEach(() => resetDailyReviewsForTests());

  const reviewA: DailyReview = makeDailyReview({
    session_date: "2026-11-23",
    account_id: "sim-acct-eval-50k",
    trade_ids: ["t1"],
    points: [point("p1", { kind: "mistake", trade_id: "t1", text: "Chased the open." })],
    lesson: "Wait for the retest.",
    status: "done",
    recorded_at: NOW,
  });

  it("buildBackup → parseBackupFile → restoreDailyReviews restores the reviews", () => {
    const payload = buildBackup([trade("t1", afternoon)], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [reviewA]);
    assert.ok(payload.daily_reviews);
    const parsed = parseBackupFile(JSON.stringify(JSON.parse(JSON.stringify(payload))));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.daily_reviews, [reviewA]);

    resetDailyReviewsForTests();
    restoreDailyReviews(parsed.daily_reviews);
    assert.deepEqual(getDailyReviews(), [reviewA]);
  });

  it("omits the daily_reviews key when there are none, so older backup shapes stay clean", () => {
    const payload = buildBackup([trade("t1", afternoon)]);
    assert.equal("daily_reviews" in payload, false);
  });

  it("a backup that only carries daily reviews passes the non-empty check", () => {
    const payload = buildBackup([], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, [reviewA]);
    const parsed = parseBackupFile(JSON.stringify(payload));
    assert.equal(parsed.ok, true);
  });

  it("a daily-review-only restore cannot clear the device trade journal", () => {
    const tuneSource = readFileSync(new URL("../../components/TuneScreen.tsx", import.meta.url), "utf8");
    assert.match(tuneSource, /if \(pending\.trades\.length\) replaceTrades\(pending\.trades\);/);
  });

  it("a legacy backup without daily_reviews leaves existing device reviews untouched", () => {
    upsertDailyReview(reviewA);
    const withTrades = parseBackupFile(JSON.stringify({ app: "mogmine", version: 1, exportedAt: NOW, includesCandles: false, trades: [trade("t1", afternoon)] }));
    assert.equal(withTrades.ok, true);
    if (!withTrades.ok) return;
    assert.equal(withTrades.daily_reviews, undefined);
    restoreDailyReviews(withTrades.daily_reviews);
    assert.deepEqual(getDailyReviews(), [reviewA]);
  });

  it("restore merges by scope: the backup's copy wins and device-only reviews stay", () => {
    upsertDailyReview(reviewA);
    const deviceOnly = makeDailyReview({ session_date: "2026-11-20", recorded_at: NOW, lesson: "device" });
    upsertDailyReview(deviceOnly);
    const edited = { ...reviewA, lesson: "From backup" };
    restoreDailyReviews([edited]);
    const restored = getDailyReviewsBackup();
    assert.equal(restored.length, 2);
    assert.equal(restored.find((r) => r.session_date === "2026-11-23")?.lesson, "From backup");
    assert.ok(restored.some((r) => r.session_date === "2026-11-20"));
  });

  it("sanitizeDailyReviewsBackup treats an empty list as absent", () => {
    assert.equal(sanitizeDailyReviewsBackup([]), null);
    assert.equal(sanitizeDailyReviewsBackup(undefined), null);
  });
});
