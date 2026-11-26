// #176: Supabase persistence adapter over the `mogmine_` tables on `showmob-dev` (D-012, docs/26 §7).
// One row per record: `(user_id, id)` primary key, the sanitized domain record in `record jsonb` (unknown fields
// ride along as the catch-all), and server-owned `created_at` / `updated_at`. Query columns (`trade_id`,
// `is_sample`, `archived`, ...) are generated from `record` in Postgres, so they never drift from it.
// Rules this file enforces before RLS ever sees a request:
// - The owner is the signed-in user. `demo-owner` (device records) is rewritten to `auth.uid()`; any other owner
//   reads nothing and writes `forbidden`. A record claiming another `user_id` is `forbidden`.
// - The device sanitizers validate every write and every read (same rules as the local adapter).
// - Derived fields (`derivedNeverStored`) are stripped before a write and recomputed on read.
// - `expectedUpdatedAt` is a guarded UPDATE (`updated_at = expected`); zero rows back is `conflict`.
// - `prompt_library` is memory-only and `candles` stay in the device cache (docs/26 §4, #70 owner-gated).
// It talks to a narrow `SupabaseLike` surface so tests can run the shared contract suite on a fake client.
import { DEFAULT_OWNER_USER_ID } from "../trades.ts";
import type { PromptLibraryV1 } from "../discretionary-prompts.ts";
import { contractFor } from "./registry.ts";
import { createCandleRepository, sanitizeCollectionRecord, sanitizeSingletonRecord } from "./local-adapter.ts";
import type { CandleStore } from "./local-adapter.ts";
import type {
  CollectionKey, CollectionRepository, JournalRepositories, ListQuery, PersistError, PersistErrorCode, PersistResult,
  PersistenceAdapter, RecordTypeKey, RowMeta, SingletonRepository, Stored, UserId, WriteOptions,
} from "./contract.ts";

/** One `mogmine_` row as PostgREST returns it. Singletons have no `id`. */
export interface DbRow {
  user_id: string;
  id?: string;
  record: unknown;
  created_at: string;
  updated_at: string;
}
export interface DbError { message: string; code?: string }
export interface DbResult<T> { data: T | null; error: DbError | null }

/** The slice of a PostgREST builder this adapter uses. `@supabase/supabase-js` satisfies it structurally. */
export interface QueryLike extends PromiseLike<DbResult<DbRow[]>> {
  select(columns?: string): QueryLike;
  eq(column: string, value: string | boolean): QueryLike;
  order(column: string, options?: { ascending?: boolean }): QueryLike;
  limit(count: number): QueryLike;
  /** Inclusive row range (PostgREST `.range(from, to)`). Optional: a double without it falls back to `limit`. */
  range?(from: number, to: number): QueryLike;
  maybeSingle(): PromiseLike<DbResult<DbRow>>;
}
export interface SupabaseLike {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } }> };
  from(table: string): {
    select(columns?: string): QueryLike;
    upsert(row: Record<string, unknown>, options: { onConflict: string }): QueryLike;
    update(patch: Record<string, unknown>): QueryLike;
    delete(): QueryLike;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<DbResult<unknown>>;
}

/** Where each collection's list filters live. Column names match the generated columns in the migration. */
const COLLECTION_COLUMNS: Record<CollectionKey, { parent?: string; sample?: boolean; archived?: boolean }> = {
  trades: { sample: true },
  mood_records: { parent: "trade_id" },
  mood_candidates: {},
  accounts: { archived: true },
  balance_checks: { parent: "account_id" },
  challenges: {},
  playbooks: { archived: true },
  plans: {},
  daily_reviews: {},
  drills: { parent: "trade_id" },
  calls: {},
  prompt_dismissals: { parent: "trade_id" },
};

export const REPLACE_ROWS_RPC = "mogmine_replace_rows";
/** Rows per request when a paged list gives an `offset` but no `limit`. Matches PostgREST's default `max-rows`. */
const DEFAULT_PAGE_ROWS = 1000;

export interface SupabaseAdapterOptions {
  /** The browser client (anon key + signed-in session). A thunk so the SDK loads only when this adapter is used. */
  client: SupabaseLike | (() => Promise<SupabaseLike>);
  /** Device candle cache; candles are not stored server-side in v1. */
  candles: CandleStore;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const iso = (value: string) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
};

function fail(code: PersistErrorCode, message: string, recordType?: RecordTypeKey, id?: string, cause?: string): { ok: false; error: PersistError } {
  return { ok: false, error: { code, message, recordType, id, cause } };
}

/** Postgres / PostgREST error to a contract code. The trader sees `message`; `cause` keeps the code for logs. */
export function mapDbError(error: DbError, recordType?: RecordTypeKey, id?: string): { ok: false; error: PersistError } {
  const code = error.code ?? "";
  const cause = `${code} ${error.message}`.trim();
  if (code === "42501") return fail("forbidden", "You do not have access to this record.", recordType, id, cause);
  if (code === "PGRST301" || code === "PGRST302" || /jwt/i.test(error.message)) return fail("unauthenticated", "Sign in to sync your journal.", recordType, id, cause);
  if (code === "23505") return fail("conflict", "This record already exists.", recordType, id, cause);
  // Migration not applied yet (42P01 / PGRST205): the device keeps working, the server is simply unavailable.
  if (code === "42P01" || code === "PGRST205") return fail("unavailable", "Could not reach the journal server. Try again.", recordType, id, cause);
  if (["23502", "23514", "22023", "22P02"].includes(code)) return fail("invalid", "This record did not pass validation.", recordType, id, cause);
  if (!code || /fetch|network|timeout/i.test(error.message)) return fail("unavailable", "Could not reach the journal server. Try again.", recordType, id, cause);
  return fail("unknown", "Something went wrong saving to the journal server.", recordType, id, cause);
}

function stripDerived(key: RecordTypeKey, record: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...record };
  for (const field of contractFor(key).derivedNeverStored) delete clean[field];
  delete clean.candles; // never stored on a row (docs/26 §5)
  return clean;
}

export function createSupabaseAdapter(options: SupabaseAdapterOptions): PersistenceAdapter {
  let clientPromise: Promise<SupabaseLike> | null = null;
  const client = (): Promise<SupabaseLike> => {
    if (!clientPromise) {
      clientPromise = typeof options.client === "function" ? options.client() : Promise.resolve(options.client);
      clientPromise.catch(() => { clientPromise = null; });
    }
    return clientPromise;
  };
  let promptLibrary: { record: PromptLibraryV1; meta: RowMeta } | null = null;

  /** The signed-in user's id, or an error result. Never throws. */
  async function session(key: RecordTypeKey): Promise<PersistResult<{ db: SupabaseLike; uid: string }>> {
    try {
      const db = await client();
      const { data } = await db.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return fail("unauthenticated", "Sign in to sync your journal.", key);
      return { ok: true, value: { db, uid } };
    } catch (error) {
      return fail("unavailable", "Could not reach the journal server. Try again.", key, undefined, String(error));
    }
  }

  /** `who` as the database owner: the signed-in id or `demo-owner` map to `auth.uid()`; anyone else is foreign. */
  const ownerFor = (who: UserId, uid: string): string | null => (who === uid || who === DEFAULT_OWNER_USER_ID ? uid : null);

  const meta = (row: DbRow): RowMeta => ({ user_id: row.user_id, created_at: iso(row.created_at), updated_at: iso(row.updated_at) });

  /** Owner-stamp, sanitize and strip one incoming record. */
  function prepare(key: CollectionKey, raw: unknown, uid: string): PersistResult<{ id: string; record: Record<string, unknown> }> {
    if (!isObject(raw)) return fail("invalid", "This record did not pass validation.", key);
    const id = typeof raw.id === "string" ? raw.id : undefined;
    const claimed = raw.user_id;
    if (claimed !== undefined && claimed !== uid && claimed !== DEFAULT_OWNER_USER_ID) {
      return fail("forbidden", "This record belongs to another owner.", key, id);
    }
    const owned = contractFor(key).ownership === "user_id" ? { ...raw, user_id: uid } : raw;
    const clean = sanitizeCollectionRecord(key, owned);
    if (!clean || !clean.id) return fail("invalid", "This record did not pass validation.", key, id);
    return { ok: true, value: { id: clean.id, record: stripDerived(key, clean as unknown as Record<string, unknown>) } };
  }

  /** A stored row back to the domain shape. Rows that no longer sanitize are skipped (same as the device read). */
  const restore = <T>(key: CollectionKey, row: DbRow): T | null => sanitizeCollectionRecord(key, row.record) as T | null;

  type Row = { id: string };
  function collection(key: CollectionKey): CollectionRepository<Row> {
    const table = contractFor(key).table;
    const columns = COLLECTION_COLUMNS[key];
    const policy = contractFor(key).deletePolicy;

    /** The rows one `list` / `listStored` call asks for: filters, order and paging, shared by both. */
    const fetchRows = async (who: UserId, query: ListQuery): Promise<PersistResult<DbRow[]>> => {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return { ok: true, value: [] };
        if (query.parentId !== undefined && !columns.parent) return { ok: true, value: [] };
        let request = s.value.db.from(table).select("*").eq("user_id", owner);
        if (query.includeSamples === false && columns.sample) request = request.eq("is_sample", false);
        if (query.includeArchived === false && columns.archived) request = request.eq("archived", false);
        if (query.parentId !== undefined && columns.parent) request = request.eq(columns.parent, query.parentId);
        request = request.order("created_at", { ascending: true }).order("id", { ascending: true });
        const offset = Math.max(0, Math.floor(query.offset ?? 0));
        let skip = 0;
        if (offset > 0 && request.range) {
          // `range` is inclusive: a page of `pageLimit` rows starting at `offset` ends at `offset + pageLimit - 1`.
          const pageLimit = query.limit !== undefined ? Math.max(0, query.limit) : DEFAULT_PAGE_ROWS;
          request = request.range(offset, offset + pageLimit - 1);
        } else {
          // A double without `range`: read `offset + n` rows from the start, then drop the first `offset`.
          skip = offset;
          if (query.limit !== undefined) request = request.limit(Math.max(0, query.limit) + offset);
        }
        const { data, error } = await request;
        if (error) return mapDbError(error, key);
        return { ok: true, value: (data ?? []).slice(skip) };
    };

    return {
      async list(who, query: ListQuery = {}) {
        const rows = await fetchRows(who, query);
        if (!rows.ok) return rows;
        return { ok: true, value: rows.value.flatMap((row) => restore<Row>(key, row) ?? []) };
      },

      async listStored(who, query: ListQuery = {}) {
        const rows = await fetchRows(who, query);
        if (!rows.ok) return rows;
        return {
          ok: true,
          value: rows.value.flatMap((row) => {
            const record = restore<Row>(key, row);
            return record ? [{ record, meta: meta(row) }] : [];
          }),
        };
      },

      async get(who, id) {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return fail("not_found", "Not found.", key, id);
        const { data, error } = await s.value.db.from(table).select("*").eq("user_id", owner).eq("id", id).maybeSingle();
        if (error) return mapDbError(error, key, id);
        const record = data ? restore<Row>(key, data) : null;
        if (!data || !record) return fail("not_found", "Not found.", key, id);
        return { ok: true, value: { record, meta: meta(data) } };
      },

      async put(who, raw, writeOptions: WriteOptions = {}) {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return fail("forbidden", "This record belongs to another owner.", key);
        const prepared = prepare(key, raw, owner);
        if (!prepared.ok) return prepared;
        const { id, record } = prepared.value;
        const rows = s.value.db.from(table);
        const request = writeOptions.expectedUpdatedAt !== undefined
          ? rows.update({ record }).eq("user_id", owner).eq("id", id).eq("updated_at", writeOptions.expectedUpdatedAt)
          : rows.upsert({ user_id: owner, id, record }, { onConflict: "user_id,id" });
        const { data, error } = await request.select("*").maybeSingle();
        if (error) return mapDbError(error, key, id);
        if (!data) return fail("conflict", "This record changed somewhere else. Reload and try again.", key, id);
        const saved = restore<Row>(key, data);
        if (!saved) return fail("invalid", "This record did not pass validation.", key, id);
        return { ok: true, value: { record: saved, meta: meta(data) } };
      },

      async remove(who, id) {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return fail("forbidden", "This record belongs to another owner.", key, id);
        if (policy === "archive") return fail("forbidden", "This record is archived, not deleted.", key, id);
        const { data, error } = await s.value.db.from(table).delete().eq("user_id", owner).eq("id", id).select("id");
        if (error) return mapDbError(error, key, id);
        if (!data || data.length === 0) return fail("not_found", "Not found.", key, id);
        return { ok: true, value: undefined };
      },

      async replaceAll(who, records) {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return fail("forbidden", "This record belongs to another owner.", key);
        const rows: Record<string, unknown>[] = [];
        for (const raw of records) {
          const prepared = prepare(key, raw, owner);
          if (!prepared.ok) {
            if (prepared.error.code === "forbidden") return prepared;
            return fail("invalid", "Some records did not pass validation. Nothing was replaced.", key, prepared.error.id);
          }
          rows.push(prepared.value.record);
        }
        // One transaction server-side: delete the owner's rows of this type, insert these (RLS still applies).
        const { error } = await s.value.db.rpc(REPLACE_ROWS_RPC, { p_table: table, p_rows: rows });
        if (error) return mapDbError(error, key);
        return { ok: true, value: undefined };
      },
    };
  }

  function singleton(key: "prefs" | "mood_registry" | "tag_registry"): SingletonRepository<unknown> {
    const table = contractFor(key).table;
    return {
      async get(who) {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return { ok: true, value: null };
        const { data, error } = await s.value.db.from(table).select("*").eq("user_id", owner).maybeSingle();
        if (error) return mapDbError(error, key);
        if (!data) return { ok: true, value: null };
        const record = sanitizeSingletonRecord(key, data.record);
        return { ok: true, value: record === null ? null : { record, meta: meta(data) } };
      },
      async put(who, value, writeOptions: WriteOptions = {}) {
        const s = await session(key);
        if (!s.ok) return s;
        const owner = ownerFor(who, s.value.uid);
        if (!owner) return fail("forbidden", "This record belongs to another owner.", key);
        const clean = isObject(value) ? sanitizeSingletonRecord(key, value) : null;
        if (!isObject(clean)) return fail("invalid", "This record did not pass validation.", key);
        const rows = s.value.db.from(table);
        const request = writeOptions.expectedUpdatedAt !== undefined
          ? rows.update({ record: clean }).eq("user_id", owner).eq("updated_at", writeOptions.expectedUpdatedAt)
          : rows.upsert({ user_id: owner, record: clean }, { onConflict: "user_id" });
        const { data, error } = await request.select("*").maybeSingle();
        if (error) return mapDbError(error, key);
        if (!data) return fail("conflict", "This record changed somewhere else. Reload and try again.", key);
        return { ok: true, value: { record: sanitizeSingletonRecord(key, data.record) ?? clean, meta: meta(data) } };
      },
    };
  }

  // prompt_library: memory-only until a prompt editor ships (docs/26 §4). Never sent to the server.
  const promptRepo: SingletonRepository<PromptLibraryV1> = {
    async get(who) {
      const s = await session("prompt_library");
      if (!s.ok) return s;
      if (!ownerFor(who, s.value.uid) || !promptLibrary) return { ok: true, value: null };
      return { ok: true, value: promptLibrary };
    },
    async put(who, value) {
      const s = await session("prompt_library");
      if (!s.ok) return s;
      if (!ownerFor(who, s.value.uid)) return fail("forbidden", "This record belongs to another owner.", "prompt_library");
      if (!isObject(value)) return fail("invalid", "This record did not pass validation.", "prompt_library");
      const at = new Date().toISOString();
      promptLibrary = { record: value, meta: { user_id: s.value.uid, created_at: promptLibrary?.meta.created_at ?? at, updated_at: at } };
      return { ok: true, value: promptLibrary as Stored<PromptLibraryV1> };
    },
  };

  const repositories = {
    trades: collection("trades"),
    mood_records: collection("mood_records"),
    mood_candidates: collection("mood_candidates"),
    mood_registry: singleton("mood_registry"),
    tag_registry: singleton("tag_registry"),
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
    candles: createCandleRepository(options.candles),
  } as unknown as JournalRepositories;

  return {
    kind: "supabase",
    repositories,
    async currentOwner() {
      const s = await session("prefs");
      return s.ok ? s.value.uid : null;
    },
  };
}
