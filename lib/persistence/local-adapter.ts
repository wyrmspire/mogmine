// #175: local/mock persistence adapter (docs/26 §6). Implements `JournalRepositories` over the same device keys
// the UI stores already use, so no data moves: `localStorage` for journal records, IndexedDB (injected) for candles.
// Rows are sanitized by the existing module sanitizers on every read and write (docs/26 §6).
// Device adapters synthesize `RowMeta`: `updated_at` is the last write made through this adapter instance, and
// rows the UI wrote directly fall back to EPOCH. Optimistic concurrency therefore only protects writes made
// through the adapter. Cascades are not performed here: `cascade_parent` is a database rule (#176).
import { DEFAULT_OWNER_USER_ID, normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { sanitizeAccounts, sanitizeBalanceChecks } from "../accounts.ts";
import { sanitizeMoodRecords, sanitizeRegistry } from "../mood.ts";
import type { MoodSpokeRegistry } from "../mood.ts";
import { sanitizeCandidates } from "../mood-store-sanitize.ts";
import { sanitizeChallenges } from "../challenge-sanitize.ts";
import { sanitizePlaybooks } from "../playbooks-sanitize.ts";
import { sanitizePlans } from "../plans-sanitize.ts";
import { sanitizeDailyReviews } from "../daily-review-sanitize.ts";
import { sanitizeDrills } from "../drills-sanitize.ts";
import { sanitizeCalls } from "../calls-sanitize.ts";
import { sanitizePrefs } from "../prefs-sanitize.ts";
import type { Prefs } from "../prefs-sanitize.ts";
import type { PromptLibraryV1 } from "../discretionary-prompts.ts";
import type { Candle } from "../trades.ts";
import { contractFor } from "./registry.ts";
import type {
  CandleCacheRepository, CollectionKey, CollectionRecordTypes, CollectionRepository, JournalRepositories, ListQuery, PersistError,
  PersistResult, PersistenceAdapter, RecordTypeKey, RowMeta, SingletonRepository, UserId, WriteOptions,
} from "./contract.ts";

/** The subset of `localStorage` the adapter needs. Browser `localStorage` satisfies it; blocked storage throws. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The subset of `lib/idb.ts` the candle cache needs. Resolves `undefined` / `false` when IndexedDB is unavailable. */
export interface CandleStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<boolean>;
}

export function createMemoryKeyValueStore(seed: Record<string, string> = {}): KeyValueStore {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

export function createMemoryCandleStore(): CandleStore {
  const values = new Map<string, unknown>();
  return {
    get: async (key) => values.get(key),
    set: async (key, value) => { values.set(key, value); return true; },
  };
}

export const EPOCH = "1970-01-01T00:00:00.000Z";

export interface LocalAdapterOptions {
  kind: "local" | "mock";
  store: KeyValueStore;
  candles: CandleStore;
  /** Device owner. Defaults to `DEFAULT_OWNER_USER_ID` (Invariant 7). */
  owner?: UserId;
  now?: () => string;
}

/** A collection stored inside one device key. `read` sanitizes; `write` returns the whole key's blob with the list replaced. */
interface CollectionSlot<T> {
  storageKey: string;
  read(blob: unknown): T[];
  write(blob: unknown, items: T[]): unknown;
  isSample?(item: T): boolean;
  isArchived?(item: T): boolean;
  parentOf?(item: T): string | undefined;
}

interface SingletonSlot<T> {
  storageKey: string;
  read(blob: unknown): T | null;
  write(blob: unknown, value: T): unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Trade rows as the trade store reads them: drop unusable rows, rebuild derived fields, never keep cached candles. */
function readTrades(blob: unknown): TradeRecord[] {
  if (!Array.isArray(blob)) return [];
  return blob.flatMap((item): TradeRecord[] => {
    if (!isObject(item)) return [];
    const exitOk = item.status === "open" || (item.exit_time && item.exit_price != null);
    if (!item.id || !item.symbol || !item.entry_time || !exitOk || item.entry_price == null || !item.direction) return [];
    try {
      const rest: Record<string, unknown> = { ...item };
      delete rest.candles; // cached bars live in the candle cache, not on the trade (docs/26 §5)
      return [normalizeTrade(rest as Parameters<typeof normalizeTrade>[0])];
    } catch {
      return [];
    }
  });
}

const objectWith = (blob: unknown, patch: Record<string, unknown>) => ({ ...(isObject(blob) ? blob : {}), ...patch });

const SLOTS: { [K in CollectionKey]: CollectionSlot<CollectionRecordTypes[K]> } = {
  trades: {
    storageKey: "mogmine-trades-v3", read: readTrades, write: (_blob, items) => items,
    isSample: (trade) => trade.is_sample === true,
  },
  mood_records: {
    storageKey: "mogmine-mood-v1", read: (blob) => sanitizeMoodRecords(isObject(blob) ? blob.records : undefined),
    write: (blob, items) => objectWith(blob, { records: items }), parentOf: (record) => record.trade_id,
  },
  mood_candidates: {
    storageKey: "mogmine-mood-v1", read: (blob) => sanitizeCandidates(isObject(blob) ? blob.candidates : undefined),
    write: (blob, items) => objectWith(blob, { candidates: items }),
  },
  accounts: {
    storageKey: "mogmine-accounts-v1", read: (blob) => sanitizeAccounts(isObject(blob) ? blob.accounts : undefined),
    write: (blob, items) => objectWith(blob, { accounts: items }), isArchived: (account) => account.archived === true,
  },
  balance_checks: {
    storageKey: "mogmine-accounts-v1", read: (blob) => sanitizeBalanceChecks(isObject(blob) ? blob.checks : undefined),
    write: (blob, items) => objectWith(blob, { checks: items }), parentOf: (check) => check.account_id,
  },
  challenges: {
    storageKey: "mogmine-challenges-v1", read: sanitizeChallenges, write: (_blob, items) => items,
  },
  playbooks: {
    storageKey: "mogmine-playbooks-v1", read: sanitizePlaybooks, write: (_blob, items) => items,
    isArchived: (playbook) => playbook.archived === true,
  },
  plans: {
    storageKey: "mogmine-plans-v1", read: sanitizePlans, write: (_blob, items) => items,
  },
  daily_reviews: {
    storageKey: "mogmine-daily-reviews-v1", read: sanitizeDailyReviews, write: (_blob, items) => items,
  },
  drills: {
    storageKey: "mogmine-drills-v1", read: sanitizeDrills, write: (_blob, items) => items,
    parentOf: (drill) => drill.trade_id,
  },
  calls: {
    storageKey: "mogmine-calls-v1", read: (blob) => sanitizeCalls(blob).calls, write: (blob, items) => objectWith(blob, { calls: items }),
  },
  prompt_dismissals: {
    storageKey: "mogmine-calls-v1", read: (blob) => sanitizeCalls(blob).dismissals, write: (blob, items) => objectWith(blob, { dismissals: items }),
    parentOf: (dismissal) => dismissal.trade_id,
  },
};

const SINGLETON_SLOTS: { prefs: SingletonSlot<Prefs>; mood_registry: SingletonSlot<MoodSpokeRegistry> } = {
  prefs: {
    storageKey: "mogmine-prefs-v1",
    read: (blob) => (blob == null ? null : sanitizePrefs(blob)),
    write: (_blob, value) => value,
  },
  mood_registry: {
    storageKey: "mogmine-mood-v1",
    read: (blob) => (isObject(blob) && "registry" in blob ? sanitizeRegistry(blob.registry) : null),
    write: (blob, value) => objectWith(blob, { registry: value }),
  },
};

const ERRORS = {
  unavailable: (key: RecordTypeKey): PersistError => ({ code: "unavailable", message: "Storage is blocked or full. Changes stay in this session only.", recordType: key, cause: "storage-unavailable" }),
  invalid: (key: RecordTypeKey, message = "This record did not pass validation."): PersistError => ({ code: "invalid", message, recordType: key }),
  forbidden: (key: RecordTypeKey, message: string): PersistError => ({ code: "forbidden", message, recordType: key }),
};

/** #176: the device sanitizers for one record, so a row-per-record adapter (Supabase) validates exactly like this one. */
export function sanitizeCollectionRecord(key: CollectionKey, raw: unknown): { id: string } | null {
  const slot = SLOTS[key] as unknown as CollectionSlot<{ id: string }>;
  const [clean] = slot.read(slot.write({}, [raw as { id: string }]));
  return clean ?? null;
}

export function sanitizeSingletonRecord(key: "prefs" | "mood_registry", raw: unknown): unknown | null {
  const slot = SINGLETON_SLOTS[key] as unknown as SingletonSlot<unknown>;
  return slot.read(slot.write({}, raw));
}

/** Device candle cache (IndexedDB in the app). Shared by the local and Supabase adapters (server archive is #70). */
export function createCandleRepository(store: CandleStore): CandleCacheRepository {
  return {
    async get(key) {
      try {
        const value = await store.get(key);
        if (Array.isArray(value)) return { ok: true, value: value as Candle[] };
        if (isObject(value) && Array.isArray(value.candles)) return { ok: true, value: value.candles as Candle[] };
        return { ok: true, value: null };
      } catch (error) {
        return { ok: false, error: { ...ERRORS.unavailable("candles"), cause: String(error) } };
      }
    },
    async put(key, list) {
      if (!Array.isArray(list)) return { ok: false, error: ERRORS.invalid("candles", "Candles must be a list.") };
      // Written without `signature`, so the candle loader treats it as a miss and refetches rather than trusting it.
      const stored = await store.set(key, { candles: list, fetchedAt: Date.now() }).catch(() => false);
      return stored ? { ok: true, value: undefined } : { ok: false, error: ERRORS.unavailable("candles") };
    },
  };
}

export function createLocalAdapter(options: LocalAdapterOptions): PersistenceAdapter {
  const owner = options.owner ?? DEFAULT_OWNER_USER_ID;
  const now = options.now ?? (() => new Date().toISOString());
  const meta = new Map<string, { created_at: string; updated_at: string }>();
  let promptLibrary: PromptLibraryV1 | null = null;

  const rowMeta = (typeKey: RecordTypeKey, id: string): { created_at: string; updated_at: string } =>
    meta.get(`${typeKey}:${id}`) ?? { created_at: EPOCH, updated_at: EPOCH };
  const stamp = (typeKey: RecordTypeKey, id: string, created_at?: string): RowMeta => {
    const at = now();
    meta.set(`${typeKey}:${id}`, { created_at: created_at ?? at, updated_at: at });
    return { user_id: owner, created_at: created_at ?? at, updated_at: at };
  };

  /** Read one device key. `null` = nothing stored yet. Unreadable JSON is an error: the stored value is never overwritten. */
  function readKey(typeKey: RecordTypeKey, key: string): PersistResult<unknown> {
    let text: string | null;
    try {
      text = options.store.getItem(key);
    } catch (error) {
      return { ok: false, error: { ...ERRORS.unavailable(typeKey), cause: String(error) } };
    }
    if (text == null) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, error: { code: "invalid", message: "Saved data on this device could not be read. Nothing was changed.", recordType: typeKey, cause: "json-parse" } };
    }
  }

  function writeKey(typeKey: RecordTypeKey, key: string, value: unknown): PersistResult<void> {
    try {
      options.store.setItem(key, JSON.stringify(value));
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: { ...ERRORS.unavailable(typeKey), cause: String(error) } };
    }
  }

  /** Owner guard. Device storage holds one owner: other owners see nothing, and cannot write. */
  const foreign = (who: UserId) => who !== owner;

  // Internals work on `Row`; the public types are restored at the boundary (`repositories`).
  type Row = { id: string };
  function collection(key: CollectionKey): CollectionRepository<Row> {
    const slot = SLOTS[key] as unknown as CollectionSlot<Row>;
    const policy = contractFor(key).deletePolicy;

    const load = (): PersistResult<{ items: Row[]; blob: unknown }> => {
      const blob = readKey(key, slot.storageKey);
      if (!blob.ok) return blob;
      return { ok: true, value: { items: slot.read(blob.value), blob: blob.value } };
    };
    const save = (blob: unknown, items: Row[]): PersistResult<void> => writeKey(key, slot.storageKey, slot.write(blob, items));

    return {
      async list(who, query: ListQuery = {}) {
        if (foreign(who)) return { ok: true, value: [] };
        const loaded = load();
        if (!loaded.ok) return loaded;
        let items = loaded.value.items.filter((item) => {
          if (query.includeSamples === false && slot.isSample?.(item)) return false;
          if (query.includeArchived === false && slot.isArchived?.(item)) return false;
          if (query.parentId !== undefined && slot.parentOf?.(item) !== query.parentId) return false;
          return true;
        });
        if (query.limit !== undefined) items = items.slice(0, Math.max(0, query.limit));
        return { ok: true, value: items };
      },

      async get(who, id) {
        if (foreign(who)) return { ok: false, error: { code: "not_found", message: "Not found.", recordType: key, id } };
        const loaded = load();
        if (!loaded.ok) return loaded;
        const record = loaded.value.items.find((item) => item.id === id);
        if (!record) return { ok: false, error: { code: "not_found", message: "Not found.", recordType: key, id } };
        const row = rowMeta(key, id);
        return { ok: true, value: { record, meta: { user_id: owner, created_at: row.created_at, updated_at: row.updated_at } } };
      },

      async put(who, record, options: WriteOptions = {}) {
        if (foreign(who)) return { ok: false, error: ERRORS.forbidden(key, "This record belongs to another owner.") };
        const claimed = (record as { user_id?: unknown }).user_id;
        if (claimed !== undefined && claimed !== owner) return { ok: false, error: ERRORS.forbidden(key, "This record belongs to another owner.") };
        const [clean] = slot.read(slot.write({}, [record]));
        if (!clean) return { ok: false, error: { ...ERRORS.invalid(key), id: (record as { id?: string }).id } };
        const loaded = load();
        if (!loaded.ok) return loaded;
        const existing = loaded.value.items.find((item) => item.id === clean.id);
        if (options.expectedUpdatedAt !== undefined && (!existing || rowMeta(key, clean.id).updated_at !== options.expectedUpdatedAt)) {
          return { ok: false, error: { code: "conflict", message: "This record changed on this device. Reload and try again.", recordType: key, id: clean.id } };
        }
        const items = existing
          ? loaded.value.items.map((item) => (item.id === clean.id ? clean : item))
          : [...loaded.value.items, clean];
        const saved = save(loaded.value.blob, items);
        if (!saved.ok) return saved;
        const row = stamp(key, clean.id, existing ? rowMeta(key, clean.id).created_at : undefined);
        return { ok: true, value: { record: clean, meta: row } };
      },

      async remove(who, id) {
        if (foreign(who)) return { ok: false, error: ERRORS.forbidden(key, "This record belongs to another owner.") };
        if (policy === "archive") return { ok: false, error: ERRORS.forbidden(key, "This record is archived, not deleted.") };
        const loaded = load();
        if (!loaded.ok) return loaded;
        if (!loaded.value.items.some((item) => item.id === id)) return { ok: false, error: { code: "not_found", message: "Not found.", recordType: key, id } };
        const saved = save(loaded.value.blob, loaded.value.items.filter((item) => item.id !== id));
        if (saved.ok) meta.delete(`${key}:${id}`);
        return saved;
      },

      async replaceAll(who, records) {
        if (foreign(who)) return { ok: false, error: ERRORS.forbidden(key, "This record belongs to another owner.") };
        const blob = readKey(key, slot.storageKey);
        if (!blob.ok) return blob;
        const clean = slot.read(slot.write({}, records));
        if (clean.length !== records.length) return { ok: false, error: ERRORS.invalid(key, "Some records did not pass validation. Nothing was replaced.") };
        const saved = save(blob.value, clean);
        if (saved.ok) {
          for (const metaKey of [...meta.keys()]) if (metaKey.startsWith(key + ":")) meta.delete(metaKey);
          for (const item of clean) stamp(key, item.id);
        }
        return saved;
      },
    };
  }

  function singleton(key: keyof typeof SINGLETON_SLOTS): SingletonRepository<unknown> {
    const slot = SINGLETON_SLOTS[key] as unknown as SingletonSlot<unknown>;
    return {
      async get(who) {
        if (foreign(who)) return { ok: true, value: null };
        const blob = readKey(key, slot.storageKey);
        if (!blob.ok) return blob;
        const value = slot.read(blob.value);
        if (value === null) return { ok: true, value: null };
        const row = rowMeta(key, "singleton");
        return { ok: true, value: { record: value, meta: { user_id: owner, created_at: row.created_at, updated_at: row.updated_at } } };
      },
      async put(who, value, options: WriteOptions = {}) {
        if (foreign(who)) return { ok: false, error: ERRORS.forbidden(key, "This record belongs to another owner.") };
        const clean = slot.read(slot.write({}, value));
        if (clean === null) return { ok: false, error: ERRORS.invalid(key) };
        const blob = readKey(key, slot.storageKey);
        if (!blob.ok) return blob;
        if (options.expectedUpdatedAt !== undefined && rowMeta(key, "singleton").updated_at !== options.expectedUpdatedAt) {
          return { ok: false, error: { code: "conflict", message: "This record changed on this device. Reload and try again.", recordType: key } };
        }
        const saved = writeKey(key, slot.storageKey, slot.write(blob.value, clean));
        if (!saved.ok) return saved;
        const row = stamp(key, "singleton");
        return { ok: true, value: { record: clean, meta: row } };
      },
    };
  }

  const candles = createCandleRepository(options.candles);

  // prompt_library: no device key (docs/26 §4). Kept in memory until a prompt editor ships.
  const promptRepo: SingletonRepository<PromptLibraryV1> = {
    async get(who) {
      if (foreign(who) || !promptLibrary) return { ok: true, value: null };
      const row = rowMeta("prompt_library", "singleton");
      return { ok: true, value: { record: promptLibrary, meta: { user_id: owner, created_at: row.created_at, updated_at: row.updated_at } } };
    },
    async put(who, value) {
      if (foreign(who)) return { ok: false, error: ERRORS.forbidden("prompt_library", "This record belongs to another owner.") };
      if (!isObject(value)) return { ok: false, error: ERRORS.invalid("prompt_library") };
      promptLibrary = value;
      return { ok: true, value: { record: value, meta: stamp("prompt_library", "singleton") } };
    },
  };

  const repositories = {
    trades: collection("trades"),
    mood_records: collection("mood_records"),
    mood_candidates: collection("mood_candidates"),
    mood_registry: singleton("mood_registry"),
    prefs: singleton("prefs"),
    accounts: collection("accounts"),
    balance_checks: collection("balance_checks"),
    challenges: collection("challenges"),
    playbooks: collection("playbooks"),
    plans: collection("plans"),
    daily_reviews: collection("daily_reviews"),
    drills: collection("drills"),
    calls: collection("calls"),
    prompt_dismissals: collection("prompt_dismissals"),
    prompt_library: promptRepo,
    candles,
  } as unknown as JournalRepositories;

  return {
    kind: options.kind,
    repositories,
    async currentOwner() {
      return owner;
    },
  };
}
