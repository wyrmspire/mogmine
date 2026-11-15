// Issue #62: sample fixture versions and user-modified annotations. A refresh replaces stale default
// annotations and keeps the trader's own edits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoTrades, DEMO_FIXTURE_VERSION } from "../fixtures.ts";
import { applyFixtureRefresh, getTrade, updateTrade } from "../store.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const base = demoTrades.find((trade) => trade.id === "mes-failed-reclaim")!;
// The older fixture said the stop was hit. The new fixture walks the same trade to a scratch exit.
const OLD_NOTE = "Stopped out at the level for a full loss.";
const NEW_NOTE = "Flattened at entry. The stop was never touched.";
const previous = normalizeTrade({ ...base, note: OLD_NOTE, exit_price: base.stop_loss_price! });
const fixture = normalizeTrade({ ...base, note: NEW_NOTE, exit_price: base.entry_price, fixture_version: DEMO_FIXTURE_VERSION + 1, annotations_modified: false });

/** A record as an older build stored it: no fixture_version and no annotations_modified flag. */
function legacy(trade: TradeRecord, overrides: Partial<TradeRecord> = {}) {
  return normalizeTrade({ ...trade, ...overrides, fixture_version: undefined, annotations_modified: undefined });
}

test("every sample carries the fixture version and starts unmodified", () => {
  for (const trade of demoTrades) {
    assert.equal(trade.fixture_version, DEMO_FIXTURE_VERSION, trade.id);
    assert.equal(trade.annotations_modified, false, trade.id);
  }
});

test("a legacy default that contradicts the new outcome is refreshed when the trader never edited it", () => {
  const refreshed = applyFixtureRefresh(legacy(previous), fixture, previous);
  assert.equal(refreshed.note, NEW_NOTE);
  assert.equal(refreshed.exit_price, fixture.exit_price);
  assert.equal(refreshed.fixture_version, fixture.fixture_version);
  assert.equal(refreshed.annotations_modified, false);
});

test("a legacy custom note is kept while the market facts still update", () => {
  const edited = legacy(previous, { note: "I hesitated and got stopped." });
  const refreshed = applyFixtureRefresh(edited, fixture, previous);
  assert.equal(refreshed.note, "I hesitated and got stopped.");
  assert.equal(refreshed.exit_price, fixture.exit_price);
  assert.equal(refreshed.annotations_modified, true);
});

test("a legacy record with a ticked checklist is kept, since its checklist no longer matches any default", () => {
  const ticked = legacy(previous, { checklist_state: previous.checklist_state.map((item, index) => ({ ...item, checked: index === 0 ? !item.checked : item.checked })) });
  const refreshed = applyFixtureRefresh(ticked, fixture, previous);
  assert.deepEqual(refreshed.checklist_state, ticked.checklist_state);
  assert.equal(refreshed.note, OLD_NOTE);
});

test("an unrecognised legacy annotation is kept when no previous fixture is supplied", () => {
  const refreshed = applyFixtureRefresh(legacy(previous), fixture);
  assert.equal(refreshed.note, OLD_NOTE);
  assert.equal(refreshed.annotations_modified, true);
});

test("a stored record stamped unmodified refreshes from the new fixture without a previous snapshot", () => {
  const stamped = normalizeTrade({ ...previous, fixture_version: DEMO_FIXTURE_VERSION, annotations_modified: false });
  const refreshed = applyFixtureRefresh(stamped, fixture);
  assert.equal(refreshed.note, NEW_NOTE);
  assert.equal(refreshed.fixture_version, fixture.fixture_version);
});

test("a record flagged as modified keeps its annotations even when they match an old default", () => {
  const flagged = normalizeTrade({ ...previous, fixture_version: DEMO_FIXTURE_VERSION, annotations_modified: true });
  assert.equal(applyFixtureRefresh(flagged, fixture, previous).note, OLD_NOTE);
});

test("a real trade is never changed by a fixture refresh", () => {
  const real = normalizeTrade({ ...base, id: "real-trade-1", is_sample: false, note: "Mine", entry_price: base.entry_price + 0.25 });
  assert.equal(applyFixtureRefresh(real, fixture, previous), real);
});

test("updateTrade marks annotations modified only when an annotation value changes", () => {
  const id = "mes-orb-fakeout";
  assert.equal(getTrade(id)?.annotations_modified, false);

  // A review field the fixture does not define is not an annotation change.
  updateTrade(id, { flagged: true });
  assert.equal(getTrade(id)?.annotations_modified, false);

  // Writing the same note back is not a change.
  updateTrade(id, { note: getTrade(id)!.note });
  assert.equal(getTrade(id)?.annotations_modified, false);

  updateTrade(id, { note: "Typed by me" });
  assert.equal(getTrade(id)?.annotations_modified, true);
});
