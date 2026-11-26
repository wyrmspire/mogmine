// Issue #36 G2 (manual entry): optional "I moved my stop" rows, validated and saved (R-10, SM-3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { entryDraftAfterSave, entryStopFields, freshEntryDraft, resolveDraftStopMoves, upgradeDraft } from "../entry-form.ts";
import type { DraftStopMove } from "../entry-form.ts";
import { deriveTrade, fromLegacy } from "../trade-document.ts";
import { normalizeTrade } from "../trades.ts";

const CT = "America/Chicago";
const ENTRY_MS = Date.parse("2026-11-20T15:00:00.000Z"); // 09:00 CST
const EXIT_MS = Date.parse("2026-11-20T15:40:00.000Z"); // 09:40 CST

function resolve(stopMoves: DraftStopMove[], overrides: Partial<Parameters<typeof resolveDraftStopMoves>[0]> = {}) {
  return resolveDraftStopMoves({
    stopMoves, initialStopPrice: 7595, entryPrice: 7590, direction: "LONG", symbol: "MES",
    date: "2026-11-20", entryMs: ENTRY_MS, exitMs: EXIT_MS, zone: CT, ...overrides,
  });
}

test("freshEntryDraft and upgradeDraft start with no stop moves or quick tags", () => {
  const fresh = freshEntryDraft(new Date("2026-11-20T15:10:00.000Z"), CT);
  assert.deepEqual(fresh.stopMoves, []);
  assert.deepEqual(fresh.quickTags, []);
  assert.deepEqual(upgradeDraft({}, new Date("2026-11-20T15:10:00.000Z"), CT).stopMoves, []);
});

test("upgradeDraft round-trips valid stop moves and drops malformed ones", () => {
  const raw = {
    stopMoves: [{ price: "7600", clock: "09:20" }, { price: 7, clock: "09:21" }, null, { price: "7601" }],
    quickTags: ["Moved Stop", 3],
  };
  const draft = upgradeDraft(raw, new Date("2026-11-20T15:10:00.000Z"), CT);
  assert.deepEqual(draft.stopMoves, [{ price: "7600", clock: "09:20" }]);
  assert.deepEqual(draft.quickTags, ["Moved Stop"]);
  const again = upgradeDraft(JSON.parse(JSON.stringify(draft)), new Date("2026-11-20T15:10:00.000Z"), CT);
  assert.deepEqual(again.stopMoves, draft.stopMoves);
  assert.deepEqual(upgradeDraft({ stopMoves: "nope" }, new Date(), CT).stopMoves, []);
});

test("entryDraftAfterSave clears stop moves on a confirmed save and keeps them when storage is blocked", () => {
  const draft = { ...freshEntryDraft(new Date("2026-11-20T15:10:00.000Z"), CT), stopMoves: [{ price: "7600", clock: "09:20" }] };
  assert.equal(entryDraftAfterSave(draft, "t1", true), null);
  assert.deepEqual(entryDraftAfterSave(draft, "t1", false)?.stopMoves, [{ price: "7600", clock: "09:20" }]);
});

test("resolveDraftStopMoves: blank rows are ignored", () => {
  const result = resolve([{ price: " ", clock: "" }]);
  assert.deepEqual(result, { error: null, moves: [], workingStopPrice: 7595, widened: false });
  assert.equal(resolve([]).error, null);
});

test("resolveDraftStopMoves: a move needs an initial stop first", () => {
  const result = resolve([{ price: "7600", clock: "09:20" }], { initialStopPrice: null });
  assert.equal(result.error, "Enter the initial stop first");
  assert.deepEqual(result.moves, []);
});

test("resolveDraftStopMoves: off-tick prices and bad clocks are refused", () => {
  assert.match(resolve([{ price: "7600.1", clock: "09:20" }]).error ?? "", /tick grid/);
  assert.match(resolve([{ price: "abc", clock: "09:20" }]).error ?? "", /tick grid/);
  assert.match(resolve([{ price: "7600", clock: "" }]).error ?? "", /Pick the time/);
});

test("resolveDraftStopMoves: a move before the entry or after the exit is refused", () => {
  // 08:55 is earlier than the 09:00 entry clock, so it reads as the next day: after the exit.
  assert.equal(resolve([{ price: "7600", clock: "08:55" }]).error, "A stop move cannot be after the exit");
  assert.equal(resolve([{ price: "7600", clock: "09:45" }]).error, "A stop move cannot be after the exit");
  // The guard itself: a move dated before the entry's day is refused.
  assert.equal(resolve([{ price: "7600", clock: "09:20" }], { date: "2026-11-19" }).error, "A stop move cannot be before the entry");
  assert.equal(resolve([{ price: "7600", clock: "09:45" }], { exitMs: null }).error, null);
});

test("resolveDraftStopMoves: a trail to breakeven is sorted, not widened, and leaves the stop at 7600", () => {
  const result = resolve([{ price: "7600", clock: "09:20" }]);
  assert.equal(result.error, null);
  assert.deepEqual(result.moves, [{ price: 7600, time: "2026-11-20T15:20:00.000Z" }]);
  assert.equal(result.workingStopPrice, 7600);
  assert.equal(result.widened, false);
});

test("resolveDraftStopMoves: rows are time-sorted whatever the typed order", () => {
  const result = resolve([{ price: "7600", clock: "09:30" }, { price: "7597.5", clock: "09:20" }]);
  assert.deepEqual(result.moves.map((move) => move.price), [7597.5, 7600]);
  assert.equal(result.workingStopPrice, 7600);
});

test("resolveDraftStopMoves: a widening move (7592 below 7595 on LONG) is flagged", () => {
  const result = resolve([{ price: "7592", clock: "09:20" }]);
  assert.equal(result.error, null);
  assert.equal(result.widened, true);
  assert.equal(result.workingStopPrice, 7592);
});

test("resolveDraftStopMoves: a clock earlier than the entry clock rolls to the next day, as entryTimes does", () => {
  // Entry 23:40 CST on Nov 20, exit 00:30 CST on Nov 21; a move at 00:10 is the next day.
  const entryMs = Date.parse("2026-11-21T05:40:00.000Z");
  const exitMs = Date.parse("2026-11-21T06:30:00.000Z");
  const result = resolveDraftStopMoves({
    stopMoves: [{ price: "7600", clock: "00:10" }], initialStopPrice: 7595, entryPrice: 7590, direction: "LONG",
    symbol: "MES", date: "2026-11-20", entryMs, exitMs, zone: CT,
  });
  assert.equal(result.error, null);
  assert.equal(result.moves[0].time, "2026-11-21T06:10:00.000Z");
});

test("a trail saved from manual entry keeps the frozen initial stop, the working stop, and the stop path", () => {
  const resolved = resolve([{ price: "7600", clock: "09:20" }]);
  assert.equal(resolved.error, null);
  const saved = normalizeTrade({
    id: "entry-moved-stop", symbol: "MES", direction: "LONG", quantity: 1,
    entry_time: new Date(ENTRY_MS).toISOString(), entry_price: 7590,
    exit_time: new Date(EXIT_MS).toISOString(), exit_price: 7605, status: "closed",
    ...entryStopFields(7595, resolved, new Date(ENTRY_MS).toISOString(), "2026-11-20T15:45:00.000Z"),
    planned_target_price: null, key_level_price: null, note: "", quick_tags: [],
  });
  assert.equal(saved.initial_stop_price, 7595);
  assert.equal(saved.initial_stop_set_at, new Date(ENTRY_MS).toISOString());
  assert.equal(saved.stop_loss_price, 7600);
  assert.deepEqual(saved.stop_moves, [{ price: 7600, time: "2026-11-20T15:20:00.000Z" }]);

  const derived = deriveTrade(fromLegacy(saved));
  assert.deepEqual(derived.stop_path.map((segment) => segment.price), [7595, 7600]);
  assert.equal(derived.stop_widened, false);
});

test("without stop moves, the save keeps the plain stop as the frozen initial stop", () => {
  const fields = entryStopFields(7595, { moves: [], workingStopPrice: 7595 }, "2026-11-20T15:00:00.000Z", "2026-11-20T15:45:00.000Z");
  assert.deepEqual(fields, { stop_loss_price: 7595, initial_stop_price: 7595, initial_stop_set_at: "2026-11-20T15:45:00.000Z" });
});
