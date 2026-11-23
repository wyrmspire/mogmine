// docs/20: price-first entry (draft, times, tick steppers) and R-10 stop at entry, frozen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { addCalendarDays, entryDraftAfterSave, entryTimes, freshEntryDraft, splitZonedInput, stepPriceText, upgradeDraft } from "../entry-form.ts";
import { parseBackupFile } from "../store.ts";
import { keepInitialStop, normalizeTrade, stopPatch, validateTradeInput } from "../trades.ts";

const CT = "America/Chicago";

test("freshEntryDraft: closed long 1 MES, entry 30 minutes before exit, on the entry's CT date", () => {
  const now = new Date("2026-11-20T15:10:00.000Z"); // 09:10 CST
  const draft = freshEntryDraft(now, CT);
  assert.equal(draft.status, "closed");
  assert.equal(draft.direction, "LONG");
  assert.equal(draft.symbol, "MES");
  assert.equal(draft.date, "2026-11-20");
  assert.equal(draft.entryClock, "08:40");
  assert.equal(draft.exitClock, "09:10");
  assert.deepEqual([draft.entryPrice, draft.exitPrice, draft.stopPrice, draft.targetPrice], ["", "", "", ""]);
});

test("freshEntryDraft: just after midnight the entry date is the previous day", () => {
  const draft = freshEntryDraft(new Date("2026-11-20T06:10:00.000Z"), CT); // 00:10 CST
  assert.equal(draft.date, "2026-11-19");
  assert.equal(draft.entryClock, "23:40");
  assert.equal(draft.exitClock, "00:10");
  const times = entryTimes(draft, CT);
  assert.equal(times.exitNextDay, true);
  assert.equal(times.exit?.toISOString(), "2026-11-20T06:10:00.000Z");
  assert.equal(times.entry.toISOString(), "2026-11-20T05:40:00.000Z");
});

test("entryTimes: same-day fills read in the display zone, across DST", () => {
  const summer = entryTimes({ status: "closed", date: "2026-07-01", entryClock: "08:30", exitClock: "09:05" }, CT);
  assert.equal(summer.entry.toISOString(), "2026-07-01T13:30:00.000Z"); // CDT
  assert.equal(summer.exit?.toISOString(), "2026-07-01T14:05:00.000Z");
  assert.equal(summer.exitNextDay, false);
  const winter = entryTimes({ status: "closed", date: "2026-12-01", entryClock: "08:30", exitClock: "09:05" }, CT);
  assert.equal(winter.entry.toISOString(), "2026-12-01T14:30:00.000Z"); // CST
});

test("entryTimes: equal clocks stay on the same day (the form then says exit must be after entry)", () => {
  const times = entryTimes({ status: "closed", date: "2026-11-20", entryClock: "09:00", exitClock: "09:00" }, CT);
  assert.equal(times.exitNextDay, false);
  assert.equal(times.exit?.getTime(), times.entry.getTime());
});

test("entryTimes: an open trade has no exit; a missing date or time is an invalid Date", () => {
  const open = entryTimes({ status: "open", date: "2026-11-20", entryClock: "09:00", exitClock: "08:00" }, CT);
  assert.equal(open.exit, null);
  assert.equal(open.exitNextDay, false);
  assert.ok(Number.isNaN(entryTimes({ status: "closed", date: "", entryClock: "09:00", exitClock: "09:05" }, CT).entry.getTime()));
  assert.ok(Number.isNaN(entryTimes({ status: "closed", date: "2026-11-20", entryClock: "09:00", exitClock: "" }, CT).exit!.getTime()));
});

test("addCalendarDays and splitZonedInput", () => {
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCalendarDays("nope", 1), "");
  assert.deepEqual(splitZonedInput("2026-11-20T09:42"), { date: "2026-11-20", clock: "09:42" });
  assert.deepEqual(splitZonedInput(""), { date: "", clock: "" });
});

test("upgradeDraft: an older datetime-local draft keeps what was typed", () => {
  const now = new Date("2026-11-20T15:10:00.000Z");
  const draft = upgradeDraft({ status: "closed", symbol: "MNQ", direction: "SHORT", quantity: "2", entryTime: "2026-11-19T10:15", exitTime: "2026-11-19T10:40", entryPrice: "21000.25", exitPrice: "20990" }, now, CT);
  assert.equal(draft.symbol, "MNQ");
  assert.equal(draft.direction, "SHORT");
  assert.equal(draft.quantity, "2");
  assert.equal(draft.date, "2026-11-19");
  assert.equal(draft.entryClock, "10:15");
  assert.equal(draft.exitClock, "10:40");
  assert.equal(draft.entryPrice, "21000.25");
  assert.equal(draft.stopPrice, "");
  assert.deepEqual(upgradeDraft(undefined, now, CT), freshEntryDraft(now, CT));
  const current = freshEntryDraft(now, CT);
  assert.deepEqual(upgradeDraft({ ...current, stopPrice: "6840" }, now, CT), { ...current, entryEdited: false, exitEdited: false, dateEdited: false, stopPrice: "6840" });
  assert.equal(upgradeDraft({ ...current, pendingTradeId: "session-trade" }, now, CT).pendingTradeId, "session-trade");
});

test("JR-1: add-trade draft clears only after a durable save and otherwise keeps its retry id", () => {
  const draft = freshEntryDraft(new Date("2026-11-20T15:10:00.000Z"), CT);
  assert.equal(entryDraftAfterSave(draft, "saved-id", true), null);
  assert.deepEqual(entryDraftAfterSave(draft, "session-id", false), { ...draft, pendingTradeId: "session-id" });
});

test("stepPriceText: one MES tick is 0.25; empty fields start from the seed", () => {
  assert.equal(stepPriceText("6844.25", 1, "MES"), "6844.50");
  assert.equal(stepPriceText("6844.25", -1, "MES"), "6844.00");
  assert.equal(stepPriceText("", -1, "MES", "6844.25"), "6844.00");
  assert.equal(stepPriceText("", 1, "MES", ""), "");
  assert.equal(stepPriceText("", 1, "MES"), "");
  // Off-tick text is snapped onto the grid, then stepped: an explicit move onto the grid.
  assert.equal(stepPriceText("6844.3", 1, "MES"), "6844.50");
  // Never to 0 or below.
  assert.equal(stepPriceText("0.25", -1, "MES"), "0.25");
  // Other contracts use their own tick.
  assert.equal(stepPriceText("40000", 1, "MYM"), "40001");
  assert.equal(stepPriceText("2300.1", -1, "M2K"), "2300.0");
  // Unknown symbol or garbage: unchanged.
  assert.equal(stepPriceText("6844.25", 1, "XYZ"), "6844.25");
  assert.equal(stepPriceText("abc", 1, "MES", "6844"), "abc");
});

test("the form's stop still uses the validateTradeInput stop-side rule", () => {
  const base = { symbol: "MES", direction: "LONG" as const, quantity: 1, entry_price: 6844, exit_price: 6850, planned_target_price: null, key_level_price: null };
  assert.equal(validateTradeInput({ ...base, stop_loss_price: 6845 }).stop_loss_price, "A long's stop sits below the entry");
  assert.equal(validateTradeInput({ ...base, stop_loss_price: 6840 }).stop_loss_price, undefined);
  assert.equal(validateTradeInput({ ...base, direction: "SHORT", stop_loss_price: 6840 }).stop_loss_price, "A short's stop sits above the entry");
});

// R-10 capture, freeze and initialRMultiple are covered by initial-stop.test.ts (PR #118).
// This file adds only the backup-restore guard that #118 does not have.
const at = "2026-11-20T15:42:00.000Z";
const baseTrade = {
  id: "r10", symbol: "MES", direction: "LONG" as const, entry_time: "2026-11-20T15:30:00.000Z", exit_time: "2026-11-20T15:50:00.000Z",
  entry_price: 6844, exit_price: 6852, quantity: 1,
};

test("R-10: a backup round-trips the initial stop, and a restore never overwrites one the device holds", () => {
  const device = normalizeTrade({ ...baseTrade, ...stopPatch({ initial_stop_price: null }, 6840, at) });
  const parsed = parseBackupFile(JSON.stringify({ app: "mogmine", trades: [{ ...device, initial_stop_price: 6830, initial_stop_set_at: "2026-11-20T17:00:00.000Z" }] }));
  assert.ok(parsed.ok);
  const incoming = parsed.trades[0];
  assert.equal(incoming.initial_stop_price, 6830);
  const kept = keepInitialStop(incoming, device);
  assert.equal(kept.initial_stop_price, 6840);
  assert.equal(kept.initial_stop_set_at, at);
  // Nothing on the device: the backup's value is used.
  assert.equal(keepInitialStop(incoming, undefined).initial_stop_price, 6830);
  assert.equal(keepInitialStop(incoming, { ...device, initial_stop_price: null, initial_stop_set_at: null }).initial_stop_price, 6830);
});

test("R-10: a backup with a half-written initial stop restores as unknown", () => {
  const parsed = parseBackupFile(JSON.stringify({ app: "mogmine", trades: [{ ...normalizeTrade({ ...baseTrade }), initial_stop_price: 6840, initial_stop_set_at: "not a time" }] }));
  assert.ok(parsed.ok);
  assert.equal(parsed.trades[0].initial_stop_price, null);
  assert.equal(parsed.trades[0].initial_stop_set_at, null);
});

test("entryMoodSpoke in freshEntryDraft and upgradeDraft (UI-3, docs/19 §4)", () => {
  const fresh = freshEntryDraft(new Date("2026-11-20T15:00:00.000Z"), CT);
  assert.equal(fresh.entryMoodSpoke, null);
  const upgraded = upgradeDraft({ entryMoodSpoke: "calm" }, new Date("2026-11-20T15:00:00.000Z"), CT);
  assert.equal(upgraded.entryMoodSpoke, "calm");
  const nullUpgraded = upgradeDraft({ entryMoodSpoke: null }, new Date("2026-11-20T15:00:00.000Z"), CT);
  assert.equal(nullUpgraded.entryMoodSpoke, null);
});
