import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  addTradeAndFlush,
  flushJournal,
  getJournalState,
  hydrateJournal,
  resetJournalForTests,
  updateTrade,
} from "../store.ts";
import { normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";

const STORAGE_KEY = "mogmine-trades-v3";

function trade(id: string, note = ""): TradeRecord {
  return normalizeTrade({
    id,
    symbol: "MES",
    direction: "LONG",
    quantity: 1,
    status: "closed",
    entry_time: `2026-11-20T14:3${id === "a" ? "0" : "1"}:00.000Z`,
    exit_time: `2026-11-20T14:4${id === "a" ? "0" : "1"}:00.000Z`,
    entry_price: 6800,
    exit_price: 6801,
    note,
    is_sample: false,
  });
}

function installStorage(initial: TradeRecord[]) {
  const memory = new Map([[STORAGE_KEY, JSON.stringify(initial)]]);
  const handlers = new Map<string, (event: StorageEvent) => void>();
  let blocked = false;
  const storage = {
    getItem(key: string) { return memory.get(key) ?? null; },
    setItem(key: string, value: string) {
      if (blocked) throw new Error("blocked");
      memory.set(key, value);
    },
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
      addEventListener(type: string, handler: (event: StorageEvent) => void) { handlers.set(type, handler); },
    },
    writable: true,
  });
  return {
    block: () => { blocked = true; },
    stored: () => JSON.parse(memory.get(STORAGE_KEY) ?? "[]") as TradeRecord[],
    storageEvent: (trades: TradeRecord[]) => handlers.get("storage")?.({ key: STORAGE_KEY, newValue: JSON.stringify(trades) } as StorageEvent),
  };
}

afterEach(() => resetJournalForTests());

test("JR-1: another tab can save a different trade without dropping a pending note", () => {
  const first = trade("a");
  const second = trade("b");
  const device = installStorage([first, second]);
  hydrateJournal();

  updateTrade(first.id, { note: "Still typing here" });
  device.storageEvent([{ ...first }, { ...second, flagged: true }]);

  const merged = getJournalState().trades;
  assert.equal(merged.find((item) => item.id === first.id)?.note, "Still typing here");
  assert.equal(merged.find((item) => item.id === second.id)?.flagged, true);
  assert.equal(flushJournal(), true);
  assert.equal(device.stored().find((item) => item.id === first.id)?.note, "Still typing here");
  assert.equal(device.stored().find((item) => item.id === second.id)?.flagged, true);
});

test("JR-1 conflict rule: this tab's pending value wins when both tabs edit the same field", () => {
  const first = trade("a", "Original");
  const device = installStorage([first]);
  hydrateJournal();

  updateTrade(first.id, { note: "Local pending note" });
  device.storageEvent([{ ...first, note: "Other tab note", planned_target_price: 6810 }]);

  const merged = getJournalState().trades.find((item) => item.id === first.id);
  assert.equal(merged?.note, "Local pending note");
  assert.equal(merged?.planned_target_price, 6810, "an incoming field not edited here is accepted");
});

test("JR-1 add confirmation is durable before success is returned", () => {
  const device = installStorage([]);
  hydrateJournal();
  const added = trade("a");

  assert.equal(addTradeAndFlush(added), true);
  assert.equal(getJournalState().saveState, "saved");
  assert.equal(device.stored().some((item) => item.id === added.id), true);
});

test("JR-1 blocked storage keeps the trade for this session and reports that it is not saved", () => {
  const device = installStorage([]);
  hydrateJournal();
  device.block();
  const added = trade("a");

  assert.equal(addTradeAndFlush(added), false);
  assert.equal(getJournalState().saveState, "error");
  assert.equal(getJournalState().trades.some((item) => item.id === added.id), true);
  assert.equal(device.stored().some((item) => item.id === added.id), false);
});
