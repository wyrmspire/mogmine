import test from "node:test";
import assert from "node:assert/strict";
import { reviewWindow, sessionReview } from "../session-review.ts";
import { createPlannedLevel } from "../plans.ts";
import type { PlanningSession } from "../plans.ts";
import { resetPlansForTests, sanitizePlanningSession, setPlanLesson, addPlan, getPlan } from "../plans-store.ts";
import type { TradeRecord } from "../trades.ts";

const lvl = (id: string, price: number, label: string) => createPlannedLevel({ id, price, symbol: "MES", label })!;
const plan = (over: Partial<PlanningSession> = {}): PlanningSession => ({
  id: "pm", user_id: "demo-owner", session_date: "2026-11-12", symbol: "MES", name: "Pre-market", preset: "pre_market",
  anchor_time_utc: "2026-11-12T14:30:00Z", created_at: "2026-11-12T13:00:00Z", updated_at: "2026-11-12T13:00:00Z",
  observations: "", watch_playbook_ids: ["orb"], levels: [lvl("a", 7610, "Shelf"), lvl("b", 7590, "Floor")], revisions: [],
  ...over,
});
const trade = (id: string, entry_time: string, entry_price: number, over: Partial<TradeRecord> = {}) => ({
  id, symbol: "MES", entry_time, entry_price, playbook_id: "orb",
  checklist_state: [{ id: "r1", label: "Stop", checked: true }, { id: "r2", label: "Wait", checked: false }],
  ...over,
}) as TradeRecord;

test("PS-4: the window runs from this checkpoint to the next one, else to the 17:00 ET close", () => {
  const powerHour = plan({ id: "ph", anchor_time_utc: "2026-11-12T19:00:00Z" });
  assert.deepEqual(reviewWindow(plan(), powerHour), { from: Date.parse("2026-11-12T14:30:00Z"), to: Date.parse("2026-11-12T19:00:00Z") });
  assert.equal(reviewWindow(plan()).to, Date.parse("2026-11-12T22:00:00Z"));
  // An event preset has no anchor: it starts when it was written.
  assert.equal(reviewWindow(plan({ anchor_time_utc: null })).from, Date.parse("2026-11-12T13:00:00Z"));
  // A checkpoint from another day, or one before this one, does not shorten the window.
  assert.equal(reviewWindow(plan(), plan({ session_date: "2026-11-13", anchor_time_utc: "2026-11-13T14:30:00Z" })).to, Date.parse("2026-11-12T22:00:00Z"));
});

test("PS-4: rows show the rules seal, the nearest level in ticks and the watch list, in entry order", () => {
  const review = sessionReview(plan(), [
    trade("late", "2026-11-12T16:00:00Z", 7592.5, { playbook_id: "fade" }),
    trade("early", "2026-11-12T14:45:00Z", 7611.25),
    trade("before", "2026-11-12T14:00:00Z", 7600),       // before the checkpoint
    trade("mnq", "2026-11-12T15:00:00Z", 26000, { symbol: "MNQ" }), // other instrument
    trade("no-pb", "2026-11-12T17:00:00Z", 7600, { playbook_id: null, checklist_state: [] }),
  ], plan({ id: "ph", anchor_time_utc: "2026-11-12T19:00:00Z" }));
  assert.deepEqual(review.rows.map((row) => row.trade_id), ["early", "late", "no-pb"]);
  assert.deepEqual(review.rows[0], {
    trade_id: "early", entry_time: "2026-11-12T14:45:00Z", rules: { followed: 1, total: 2 },
    nearest: { label: "Shelf", price: 7610, distance_ticks: 5 }, watched: true,
  });
  assert.deepEqual(review.rows[1].nearest, { label: "Floor", price: 7590, distance_ticks: 10 });
  assert.equal(review.rows[1].watched, false);
  // 7600 is 40 ticks from both levels: the first one listed wins, deterministically.
  assert.equal(review.rows[2].nearest?.label, "Shelf");
  assert.equal(review.rows[2].rules, null);
  assert.equal(review.rows[2].watched, null);
  assert.deepEqual(review.rules, { followed: 2, total: 4 });
  assert.deepEqual(review.watched, { yes: 1, of: 2 });
});

test("PS-4: levels and the watch list are read as they stood at each entry (B-14)", () => {
  const edited = plan({
    levels: [lvl("c", 7600.25, "Added later")], watch_playbook_ids: ["fade"],
    revisions: [{ id: "r", saved_at: "2026-11-12T15:30:00Z", after_the_fact: true, observations: "", watch_playbook_ids: ["orb"], levels: [lvl("a", 7610, "Shelf")] }],
  });
  const review = sessionReview(edited, [trade("t1", "2026-11-12T15:00:00Z", 7601), trade("t2", "2026-11-12T16:00:00Z", 7601)]);
  assert.deepEqual(review.rows.map((row) => [row.nearest?.label, row.watched]), [["Shelf", true], ["Added later", false]]);
});

test("PS-4: a session with no trades is a valid review", () => {
  const review = sessionReview(plan({ lesson: "Wait for the reclaim" }), []);
  assert.deepEqual(review.rows, []);
  assert.deepEqual(review.rules, { followed: 0, total: 0 });
  assert.deepEqual(review.watched, { yes: 0, of: 0 });
  assert.equal(review.lesson, "Wait for the reclaim");
});

test("PS-4: the lesson is saved without a plan revision, trimmed to its limit, and cleared by empty text", () => {
  resetPlansForTests();
  addPlan(plan());
  setPlanLesson("pm", "x".repeat(400));
  assert.equal(getPlan("pm")?.lesson?.length, 280);
  assert.equal(getPlan("pm")?.revisions.length, 0);
  setPlanLesson("pm", "   ");
  assert.equal("lesson" in getPlan("pm")!, false);
  assert.equal(sanitizePlanningSession({ ...plan(), lesson: "Keep it" })?.lesson, "Keep it");
  resetPlansForTests();
});
