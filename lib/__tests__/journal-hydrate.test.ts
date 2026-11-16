import assert from "node:assert/strict";
import { test } from "node:test";
import { demoTrades } from "../fixtures.ts";
import { getJournalState, hydrateJournal, resetJournalForTests } from "../store.ts";
import { tradePnl } from "../trades.ts";

const STORAGE_KEY = "mogmine-trades-v3";

function installMemoryStorage() {
  const memory = new Map<string, string>();
  const storage = {
    getItem(key: string) { return memory.has(key) ? memory.get(key)! : null; },
    setItem(key: string, value: string) { memory.set(key, value); },
    removeItem(key: string) { memory.delete(key); },
    clear() { memory.clear(); },
    key(index: number) { return [...memory.keys()][index] ?? null; },
    get length() { return memory.size; },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage, writable: true });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: storage,
      addEventListener() {},
    },
    writable: true,
  });
  return storage;
}

test("hydrateJournal applies fixture prices in one update so a stale MNQ sample does not keep a first-paint P&L", () => {
  const storage = installMemoryStorage();
  resetJournalForTests();

  const fixture = demoTrades.find((trade) => trade.id === "mnq-trend-hold");
  assert.ok(fixture);
  const currentPnl = tradePnl(fixture);
  assert.equal(currentPnl, 720);

  // A stale device copy of the same sample, priced like the core MNQ short golden ($140).
  const stale = {
    ...fixture,
    quantity: 1,
    entry_price: 25784,
    exit_price: 25714,
    stop_loss_price: 25854,
    planned_target_price: 25714,
  };
  assert.equal(tradePnl(stale), 140);
  storage.setItem(STORAGE_KEY, JSON.stringify([stale]));

  const before = getJournalState();
  assert.equal(before.hydrated, false);

  hydrateJournal();

  const after = getJournalState();
  assert.equal(after.hydrated, true);
  const hydrated = after.trades.find((trade) => trade.id === "mnq-trend-hold");
  assert.ok(hydrated);
  assert.equal(tradePnl(hydrated), currentPnl);
  assert.equal(hydrated.quantity, fixture.quantity);
  assert.equal(hydrated.entry_price, fixture.entry_price);
  assert.equal(hydrated.exit_price, fixture.exit_price);

  resetJournalForTests();
});
