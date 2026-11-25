import test from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_TABLE_PREFIX, MOGMINE_TABLE_PREFIX, RECORD_CONTRACTS, SUPABASE_PROJECT_REF, contractFor, isMogmineTable,
} from "../persistence/registry.ts";
import type { CollectionRepository, PersistResult, RecordTypeKey, Stored, UserId } from "../persistence/contract.ts";
import type { Playbook } from "../playbooks.ts";
import { CALLS_STORAGE_KEY } from "../calls-store.ts";
import { CHALLENGES_STORAGE_KEY } from "../challenge-store.ts";
import { DRILLS_STORAGE_KEY } from "../drills-store.ts";
import { PLANS_STORAGE_KEY } from "../plans-store.ts";
import { PLAYBOOKS_STORAGE_KEY } from "../playbooks-store.ts";
import { PREFS_KEY } from "../prefs.ts";

// Compile-time exhaustiveness: adding a RecordTypeKey without listing it here fails typecheck.
const EVERY_KEY: Record<RecordTypeKey, true> = {
  trades: true, mood_records: true, mood_candidates: true, mood_registry: true, tag_registry: true, prefs: true, accounts: true,
  balance_checks: true, challenges: true, playbooks: true, plans: true, drills: true, calls: true,
  prompt_dismissals: true, prompt_library: true, candles: true, daily_reviews: true,
};

test("registry covers every record type exactly once", () => {
  const keys = RECORD_CONTRACTS.map((entry) => entry.key);
  assert.deepEqual([...keys].sort(), Object.keys(EVERY_KEY).sort());
  assert.equal(new Set(keys).size, keys.length);
  for (const key of keys) assert.equal(contractFor(key).key, key);
});

test("D-012: every table is mogmine_-prefixed, unique, and never showmob_", () => {
  assert.equal(SUPABASE_PROJECT_REF, "vsasmtsifuylhfrrsrso");
  const tables = RECORD_CONTRACTS.map((entry) => entry.table);
  assert.equal(new Set(tables).size, tables.length);
  for (const table of tables) {
    assert.ok(table.startsWith(MOGMINE_TABLE_PREFIX), table);
    assert.ok(!table.includes(FORBIDDEN_TABLE_PREFIX), table);
    assert.ok(isMogmineTable(table), table);
  }
  assert.equal(isMogmineTable("showmob_events"), false);
  assert.equal(isMogmineTable("trades"), false);
  assert.equal(isMogmineTable("mogmine_Trades"), false);
});

test("owned rows use the own-row RLS rule; only shared market data is shared_read", () => {
  for (const entry of RECORD_CONTRACTS) {
    assert.equal(entry.rls, entry.ownership === "shared" ? "shared_read" : "own", entry.key);
  }
});

test("device keys match the stores that own them", () => {
  const expected: Partial<Record<RecordTypeKey, string>> = {
    calls: CALLS_STORAGE_KEY, challenges: CHALLENGES_STORAGE_KEY, drills: DRILLS_STORAGE_KEY,
    plans: PLANS_STORAGE_KEY, playbooks: PLAYBOOKS_STORAGE_KEY, prefs: PREFS_KEY,
  };
  for (const [key, storageKey] of Object.entries(expected)) {
    const deviceKey = contractFor(key as RecordTypeKey).deviceKey ?? "";
    assert.equal(deviceKey.split("#")[0], storageKey, key);
  }
});

test("v1 types are in backups; deferred types say why; parents exist", () => {
  for (const entry of RECORD_CONTRACTS) {
    if (entry.readiness === "v1") assert.ok(entry.inBackup, entry.key);
    if (entry.readiness !== "v1") assert.ok(entry.notes.length > 20, entry.key);
    if (entry.deletePolicy === "cascade_parent") assert.ok(entry.parent && contractFor(entry.parent), entry.key);
  }
  assert.ok(contractFor("calls").derivedNeverStored.includes("grade"));
  assert.ok(contractFor("calls").derivedNeverStored.includes("after_the_fact"));
  assert.ok(contractFor("mood_records").derivedNeverStored.includes("suggestions"));
});

// The contract must be implementable by a plain in-memory adapter (#175's shape), with no storage specifics.
function memoryCollection<T extends { id: string }>(): CollectionRepository<T> {
  const rows = new Map<string, Stored<T>>();
  const k = (owner: UserId, id: string) => `${owner}\u0000${id}`;
  const notFound = (id: string): PersistResult<never> => ({ ok: false, error: { code: "not_found", message: "Not found.", id } });
  return {
    async list(owner) { return { ok: true, value: [...rows.values()].filter((row) => row.meta.user_id === owner).map((row) => row.record) }; },
    async get(owner, id) { const row = rows.get(k(owner, id)); return row ? { ok: true, value: row } : notFound(id); },
    async put(owner, record, options) {
      const prior = rows.get(k(owner, record.id));
      if (options?.expectedUpdatedAt && prior?.meta.updated_at !== options.expectedUpdatedAt) {
        return { ok: false, error: { code: "conflict", message: "Changed elsewhere.", id: record.id } };
      }
      const now = new Date().toISOString();
      const stored = { record, meta: { user_id: owner, created_at: prior?.meta.created_at ?? now, updated_at: now } };
      rows.set(k(owner, record.id), stored);
      return { ok: true, value: stored };
    },
    async remove(owner, id) { return rows.delete(k(owner, id)) ? { ok: true, value: undefined } : notFound(id); },
    async replaceAll(owner, records) {
      for (const key of [...rows.keys()]) if (key.startsWith(`${owner}\u0000`)) rows.delete(key);
      for (const record of records) await this.put(owner, record);
      return { ok: true, value: undefined };
    },
  };
}

test("a memory collection satisfies the contract: owner isolation, upsert, conflict", async () => {
  const repo = memoryCollection<Playbook>();
  const book: Playbook = { id: "pb-1", user_id: "demo-owner", name: "ONL sweep", default_style: "scalp", checklist_rules: [], archived: false };
  const first = await repo.put("demo-owner", book);
  assert.ok(first.ok);
  const other = await repo.get("someone-else", "pb-1");
  assert.equal(other.ok ? "found" : other.error.code, "not_found");
  const stale = await repo.put("demo-owner", { ...book, name: "x" }, { expectedUpdatedAt: "1999-01-01T00:00:00.000Z" });
  assert.equal(stale.ok ? "saved" : stale.error.code, "conflict");
  const listed = await repo.list("demo-owner");
  assert.deepEqual(listed.ok ? listed.value.map((p) => p.name) : [], ["ONL sweep"]);
});
