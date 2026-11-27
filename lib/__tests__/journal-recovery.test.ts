import assert from "node:assert/strict";
import { test } from "node:test";
import { demoTrades } from "../fixtures.ts";
import { getJournalState, getQuarantinedRecords, hydrateJournal, resetJournalForTests } from "../store.ts";

const STORAGE_KEY = "mogmine-trades-v3";
const QUARANTINE_KEY = "mogmine-trades-quarantine-v1";
const RAW_RECOVERY_KEY = "mogmine-trades-raw-recovery-v1";

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

/** A valid stored real trade: a fixture's shape under a fresh id, so fixture refresh never touches it. */
function storedTrade(id: string) {
  const fixture = demoTrades[0];
  assert.ok(fixture);
  return { ...fixture, id, is_sample: false };
}

// D-02: a closed record whose exit is missing. Recoverable by hand, so it must never be silently dropped.
const missingExit = {
  id: "broken-missing-exit",
  symbol: "MES",
  direction: "LONG",
  entry_time: "2026-11-18T14:30:00.000Z",
  entry_price: 6900,
  status: "closed",
  note: "keep me verbatim",
};

// D-02: status says open but the exit fields are set, so normalizeTrade throws on it.
const statusDisagrees = {
  id: "broken-status-disagrees",
  symbol: "MES",
  direction: "SHORT",
  entry_time: "2026-11-18T15:00:00.000Z",
  entry_price: 6905,
  exit_time: "2026-11-18T15:30:00.000Z",
  exit_price: 6910,
  status: "open",
};

test("hydrateJournal quarantines malformed records instead of dropping them (D-02)", () => {
  const storage = installMemoryStorage();
  resetJournalForTests();

  const goodA = storedTrade("real-good-a");
  const goodB = storedTrade("real-good-b");
  const raw = JSON.stringify([goodA, missingExit, goodB, statusDisagrees]);
  storage.setItem(STORAGE_KEY, raw);

  hydrateJournal();

  const after = getJournalState();
  assert.equal(after.hydrated, true);
  // The good records load; the malformed ones are not in the working list.
  assert.ok(after.trades.some((trade) => trade.id === "real-good-a"));
  assert.ok(after.trades.some((trade) => trade.id === "real-good-b"));
  assert.equal(after.trades.some((trade) => trade.id === missingExit.id), false);
  assert.equal(after.trades.some((trade) => trade.id === statusDisagrees.id), false);
  // The malformed records are reported, verbatim, as the recovery notice.
  assert.deepEqual(after.quarantined, [missingExit, statusDisagrees]);
  assert.deepEqual(getQuarantinedRecords(), [missingExit, statusDisagrees]);
  // No write-back deleted them: the stored key still holds the original bytes,
  // and both the quarantine list and the byte-for-byte recovery copy preserve them.
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.deepEqual(JSON.parse(storage.getItem(QUARANTINE_KEY)!), [missingExit, statusDisagrees]);
  assert.equal(storage.getItem(RAW_RECOVERY_KEY), raw);

  // A reload reports the same records exactly once and loses nothing.
  resetJournalForTests();
  hydrateJournal();
  const reloaded = getJournalState();
  assert.ok(reloaded.trades.some((trade) => trade.id === "real-good-a"));
  assert.ok(reloaded.trades.some((trade) => trade.id === "real-good-b"));
  assert.deepEqual(reloaded.quarantined, [missingExit, statusDisagrees]);
  assert.deepEqual(JSON.parse(storage.getItem(QUARANTINE_KEY)!), [missingExit, statusDisagrees]);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(storage.getItem(RAW_RECOVERY_KEY), raw);

  resetJournalForTests();
});

test("hydrateJournal leaves a clean journal and its write-back unchanged (D-02)", () => {
  const storage = installMemoryStorage();
  resetJournalForTests();

  const good = storedTrade("real-good-only");
  storage.setItem(STORAGE_KEY, JSON.stringify([good]));

  hydrateJournal();

  const after = getJournalState();
  assert.equal(after.hydrated, true);
  assert.deepEqual(after.quarantined, []);
  assert.ok(after.trades.some((trade) => trade.id === "real-good-only"));
  // Nothing was quarantined, so nothing is preserved and the usual write-back still happens.
  assert.equal(storage.getItem(QUARANTINE_KEY), null);
  assert.equal(storage.getItem(RAW_RECOVERY_KEY), null);
  const written = JSON.parse(storage.getItem(STORAGE_KEY)!) as { id: string }[];
  assert.ok(written.some((trade) => trade.id === "real-good-only"));

  resetJournalForTests();
});

test("hydrateJournal quarantines an unreadable payload instead of overwriting it (D-02)", () => {
  const storage = installMemoryStorage();
  resetJournalForTests();

  storage.setItem(STORAGE_KEY, "{not json");

  hydrateJournal();

  const after = getJournalState();
  assert.equal(after.hydrated, true);
  assert.deepEqual(after.quarantined, ["{not json"]);
  assert.equal(storage.getItem(STORAGE_KEY), "{not json");
  assert.equal(storage.getItem(RAW_RECOVERY_KEY), "{not json");
  assert.deepEqual(JSON.parse(storage.getItem(QUARANTINE_KEY)!), ["{not json"]);

  resetJournalForTests();
});
