// DR-2: day review behaviour at the store boundary, and the dry-run 11/23 migration helper.
// Fixtures only: no network, no Supabase, no /api/v1, no real accounts. The migration script is imported, never run against live data.
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeDailyReview } from "../daily-review.ts";
import type { ReviewPoint } from "../daily-review.ts";
import {
  getDailyReviews, resetDailyReviewsForTests, updateDailyReview, upsertDailyReview,
} from "../daily-review-store.ts";
import { dayStatus, markLinkedTradesReviewed, recentTradingDays } from "../day-review-screen.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import type { PlanningSession } from "../plans.ts";
// @ts-expect-error: plain .mjs script, no type declarations
import { migratePlanReview, proposeDailyReviewFromPlan } from "../../scripts/migrate-1123-daily-review.mjs";

const base = { symbol: "MNQ", direction: "LONG" as const, exit_time: "2026-11-23T16:00:00.000Z", entry_price: 25000, exit_price: 25020 };
function trade(id: string, patch: Partial<TradeRecord> = {}): TradeRecord {
  return normalizeTrade({ ...base, id, entry_time: "2026-11-23T15:10:00.000Z", account_id: "acct-eval", ...patch });
}

beforeEach(() => resetDailyReviewsForTests());

describe("Days strip (last 14 trading days)", () => {
  it("skips Saturdays and Sundays and pairs each date with none, draft, or done", () => {
    const days = recentTradingDays("2026-11-22"); // Sunday -> starts at Friday 2026-11-20
    assert.equal(days.length, 14);
    assert.equal(days[0], "2026-11-20");
    for (const date of days) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      assert.notEqual(weekday, 0);
      assert.notEqual(weekday, 6);
    }
    const reviews = [
      makeDailyReview({ session_date: "2026-11-20", status: "done", recorded_at: "2026-11-20T22:00:00.000Z" }),
      makeDailyReview({ session_date: "2026-11-19", status: "draft", recorded_at: "2026-11-19T22:00:00.000Z" }),
    ];
    assert.equal(dayStatus(reviews, "2026-11-20"), "done");
    assert.equal(dayStatus(reviews, "2026-11-19"), "draft");
    assert.equal(dayStatus(reviews, "2026-11-18"), "none");
  });
});

describe("Done for the day and mark linked trades reviewed (Q-4)", () => {
  it("sets status done on the review and leaves every linked trade's review_status untouched", () => {
    const trades = [trade("t-new", { review_status: "new" }), trade("t-tagged", { review_status: "tagged" })];
    const before = trades.map((item) => ({ id: item.id, review_status: item.review_status }));
    const saved = upsertDailyReview(makeDailyReview({ session_date: "2026-11-23", trade_ids: ["t-new", "t-tagged"], recorded_at: "2026-11-23T22:00:00.000Z" }));
    assert.ok(saved);
    const done = updateDailyReview(saved.id, { status: "done" });
    assert.equal(done?.status, "done");
    assert.equal(getDailyReviews().length, 1);
    assert.deepEqual(trades.map((item) => ({ id: item.id, review_status: item.review_status })), before);
  });

  it("marks linked unreviewed trades reviewed and restores exact prior statuses on undo", () => {
    const statuses = new Map<string, TradeRecord["review_status"]>([
      ["t-new", "new"],
      ["t-tagged", "tagged"],
      ["t-done", "reviewed"],
    ]);
    const linked = [...statuses.entries()].map(([id, review_status]) => ({ id, review_status }));
    const { count, undo } = markLinkedTradesReviewed(linked, (id, status) => statuses.set(id, status));
    assert.equal(count, 2);
    assert.equal(statuses.get("t-new"), "reviewed");
    assert.equal(statuses.get("t-tagged"), "reviewed");
    assert.equal(statuses.get("t-done"), "reviewed");
    undo();
    assert.equal(statuses.get("t-new"), "new");
    assert.equal(statuses.get("t-tagged"), "tagged");
    assert.equal(statuses.get("t-done"), "reviewed");
  });
});

describe("Zero-trade day", () => {
  it("saves a valid DailyReview with trade_ids [], points and a 500-character lesson", () => {
    const lesson = "x".repeat(500);
    const points: ReviewPoint[] = [{ id: "p-1", kind: "observation", text: "Chop all morning, no setup met the plan", trade_id: null }];
    const saved = upsertDailyReview(makeDailyReview({ session_date: "2026-11-24", trade_ids: [], points, lesson, status: "draft", recorded_at: "2026-11-24T23:00:00.000Z" }));
    assert.ok(saved);
    const [stored] = getDailyReviews();
    assert.equal(getDailyReviews().length, 1);
    assert.deepEqual(stored.trade_ids, []);
    assert.equal(stored.points.length, 1);
    assert.equal(stored.lesson.length, 500);
    assert.equal(stored.id, "review-2026-11-24");
  });
});

// The 11/23 plan-review fixture (06 §2.2): the observations name the trades by id.
const TRADES = [
  trade("trade-20261123-a", { entry_time: "2026-11-23T15:10:00.000Z" }),
  trade("trade-20261123-b", { entry_time: "2026-11-23T16:20:00.000Z" }),
  trade("trade-20261123-c", { entry_time: "2026-11-23T17:05:00.000Z", is_sample: true }),
];
const PLAN: PlanningSession = {
  id: "review-2026-11-23",
  user_id: "demo-owner",
  session_date: "2026-11-23",
  name: "Review 11/23",
  preset: null,
  anchor_time_utc: null,
  created_at: "2026-11-23T23:00:00.000Z",
  updated_at: "2026-11-23T23:00:00.000Z",
  observations: "Good patience on trade-20261123-a. Chased trade-20261123-b. Sample trade-20261123-c not real.",
  watch_playbook_ids: [],
  levels: [],
  revisions: [],
  lesson: "Wait for the retest before size.",
};

function fakeCommands(plan: PlanningSession | undefined, existing: unknown[] = []) {
  const writes: unknown[] = [];
  return {
    writes,
    commands: {
      getPlan: async (id: string) => (plan && plan.id === id ? structuredClone(plan) : undefined),
      listTrades: async () => TRADES,
      findDailyReview: async (sessionDate: string, accountId: string | null) =>
        existing.find((r) => (r as { session_date: string; account_id: string | null }).session_date === sessionDate && (r as { account_id: string | null }).account_id === accountId),
      saveDailyReview: async (review: unknown) => { writes.push(review); return review; },
    },
  };
}

describe("migrate-1123-daily-review.mjs", () => {
  it("proposes trades named in the text, skipping samples, and one observation point plus the lesson", () => {
    const { review, warnings } = proposeDailyReviewFromPlan(PLAN, TRADES);
    assert.equal(review.id, "review-2026-11-23");
    assert.equal(review.session_date, "2026-11-23");
    assert.deepEqual(review.trade_ids, ["trade-20261123-a", "trade-20261123-b"]);
    assert.equal(review.points.length, 1);
    assert.equal(review.points[0].kind, "observation");
    assert.equal(review.lesson, "Wait for the retest before size.");
    assert.equal(review.status, "draft");
    assert.ok(warnings.some((w: string) => w.includes("trade-20261123-c") && w.includes("sample")));
  });

  it("dry-run (default) makes zero writes and leaves the source plan unchanged", async () => {
    const before = structuredClone(PLAN);
    const { commands, writes } = fakeCommands(PLAN);
    const result = await migratePlanReview(commands, PLAN.id, {});
    assert.equal(result.status, "dry-run");
    assert.equal(result.writes, 0);
    assert.equal(writes.length, 0);
    assert.deepEqual(PLAN, before);
  });

  it("--apply creates one daily_reviews record and leaves the plan intact", async () => {
    const before = structuredClone(PLAN);
    const { commands, writes } = fakeCommands(PLAN);
    const result = await migratePlanReview(commands, PLAN.id, { apply: true });
    assert.equal(result.status, "applied");
    assert.equal(writes.length, 1);
    assert.equal((writes[0] as { id: string }).id, "review-2026-11-23");
    assert.deepEqual(PLAN, before);
  });

  it("does nothing when a review already exists for the scope (rule 5)", async () => {
    const { commands, writes } = fakeCommands(PLAN, [{ id: "review-2026-11-23", session_date: "2026-11-23", account_id: null }]);
    const result = await migratePlanReview(commands, PLAN.id, { apply: true });
    assert.equal(result.status, "exists");
    assert.equal(writes.length, 0);
  });

  it("truncates an over-long lesson to 500 characters and reports it", () => {
    const { review, warnings } = proposeDailyReviewFromPlan({ ...PLAN, lesson: "y".repeat(600) }, TRADES);
    assert.equal(review.lesson.length, 500);
    assert.ok(warnings.some((w: string) => w.includes("lesson")));
  });
});
