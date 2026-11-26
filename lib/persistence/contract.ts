// #173: storage-portable persistence contract (docs/26). Types only: no adapter, no I/O, no behaviour change.
// A local/mock adapter (#175) and a Supabase adapter (#176, `mogmine_` tables on `showmob-dev`, D-012)
// both implement `JournalRepositories`. The command layer (#174) talks to this contract, never to a store.
// Domain shapes stay in their own modules; this file only says how they are identified, owned and stored.
import type { Candle, TradeRecord } from "../trades.ts";
import type { Prefs } from "../prefs.ts";
import type { MoodRecord, MoodSpokeCandidate, MoodSpokeRegistry } from "../mood.ts";
import type { BalanceCheck, TradingAccount } from "../accounts.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import type { Playbook } from "../playbooks.ts";
import type { PlanningSession } from "../plans.ts";
import type { DrillRecord } from "../drills.ts";
import type { DiscretionCall, PromptDismissal } from "../calls.ts";
import type { PromptLibraryV1 } from "../discretionary-prompts.ts";
import type { DailyReview } from "../daily-review.ts";
import type { TagRegistry } from "../tag-registry.ts";

/** Opaque owner id. Device: `DEFAULT_OWNER_USER_ID` ("demo-owner"). Supabase: `auth.users.id` (shared with Showmob). */
export type UserId = string;
/** Record ids are client-generated strings (UUIDs or seed/sample ids such as "seed:cut"); never assume uuid format. */
export type RecordId = string;
/** ISO-8601 UTC timestamp string. */
export type IsoTime = string;

// ---------------------------------------------------------------------------------------------------------------
// Results and errors. Adapters never throw for expected failures; they return a `PersistResult`.
// ---------------------------------------------------------------------------------------------------------------

export type PersistErrorCode =
  | "not_found" // the id does not exist for this owner (RLS hides other owners' rows: same code)
  | "conflict" // expected `updated_at` did not match (optimistic concurrency), or a unique key clashed
  | "invalid" // the record failed the domain sanitizer / validator before any write
  | "unauthenticated" // no signed-in user where the adapter needs one (Supabase only)
  | "forbidden" // the write targets another owner, a derived field, or a non-`mogmine_` table
  | "unavailable" // storage is blocked, offline or quota-full; the session keeps working in memory
  | "unknown";

export interface PersistError {
  code: PersistErrorCode;
  /** Plain-language, safe to show the trader. */
  message: string;
  recordType?: RecordTypeKey;
  id?: RecordId;
  /** Adapter detail for logs (Postgres code, DOMException name). Never shown in UI. */
  cause?: string;
}

export type PersistResult<T> = { ok: true; value: T } | { ok: false; error: PersistError };

/** Row metadata every adapter can report. Device adapters may synthesize it; Postgres owns it server-side. */
export interface RowMeta {
  user_id: UserId;
  created_at: IsoTime;
  updated_at: IsoTime;
}

export interface Stored<T> {
  record: T;
  meta: RowMeta;
}

export interface WriteOptions {
  /** Optimistic concurrency: fail with `conflict` unless the stored row still has this `updated_at`. Omit for last-write-wins. */
  expectedUpdatedAt?: IsoTime;
}

// ---------------------------------------------------------------------------------------------------------------
// Repository shapes. Three kinds cover every stored record type in docs/26.
// ---------------------------------------------------------------------------------------------------------------

export interface ListQuery {
  /** Include fixture / sample records (`is_sample`). Default true; statistics callers pass false. */
  includeSamples?: boolean;
  /** Include archived rows where the type has `archived`. Default true (backups need them). */
  includeArchived?: boolean;
  /** Children of one parent (e.g. a trade's mood records, an account's balance checks). */
  parentId?: RecordId;
  limit?: number;
  /** 0-based row offset, applied before `limit`. Pages through a collection in `created_at, id` order. */
  offset?: number;
}

/** Many rows per owner, keyed by `id`. `put` is an upsert of the whole record (no partial patches at this layer). */
export interface CollectionRepository<T extends { id: RecordId }> {
  list(owner: UserId, query?: ListQuery): Promise<PersistResult<T[]>>;
  get(owner: UserId, id: RecordId): Promise<PersistResult<Stored<T>>>;
  put(owner: UserId, record: T, options?: WriteOptions): Promise<PersistResult<Stored<T>>>;
  /** Hard delete. Types marked `deletePolicy: "archive"` in the registry must archive instead and return `forbidden`. */
  remove(owner: UserId, id: RecordId): Promise<PersistResult<void>>;
  /** Replace every row of this type for the owner (backup restore). Atomic where the adapter can be. */
  replaceAll(owner: UserId, records: T[]): Promise<PersistResult<void>>;
}

/** Exactly one document per owner (prefs, mood spoke registry, prompt library). `get` returns null before the first write. */
export interface SingletonRepository<T> {
  get(owner: UserId): Promise<PersistResult<Stored<T> | null>>;
  put(owner: UserId, value: T, options?: WriteOptions): Promise<PersistResult<Stored<T>>>;
}

/** Shared market data, not owned by a user. Device: IndexedDB `mogmine/candles`. Server: `mogmine_market_candles` (#70, deferred). */
export interface CandleCacheRepository {
  get(key: string): Promise<PersistResult<Candle[] | null>>;
  put(key: string, candles: Candle[]): Promise<PersistResult<void>>;
}

// ---------------------------------------------------------------------------------------------------------------
// Record types. Keys are stable identifiers shared by the registry, the command layer and both adapters.
// ---------------------------------------------------------------------------------------------------------------

/** Rows stored many-per-owner. `user_id` is stamped by the adapter for types whose domain shape lacks it. */
export interface CollectionRecordTypes {
  trades: TradeRecord;
  mood_records: MoodRecord;
  mood_candidates: MoodSpokeCandidate;
  accounts: TradingAccount;
  balance_checks: BalanceCheck;
  challenges: ChallengeDefinition;
  playbooks: Playbook;
  plans: PlanningSession;
  drills: DrillRecord;
  calls: DiscretionCall;
  prompt_dismissals: PromptDismissal;
  daily_reviews: DailyReview;
}

export interface SingletonRecordTypes {
  prefs: Prefs;
  mood_registry: MoodSpokeRegistry;
  /** PL-3: setup and execution tag definitions, one document per owner. */
  tag_registry: TagRegistry;
  prompt_library: PromptLibraryV1;
}

export type CollectionKey = keyof CollectionRecordTypes;
export type SingletonKey = keyof SingletonRecordTypes;
export type RecordTypeKey = CollectionKey | SingletonKey | "candles";

/** What a storage adapter must provide. #175 and #176 implement this exact interface. */
export type JournalRepositories = {
  [K in CollectionKey]: CollectionRepository<CollectionRecordTypes[K]>;
} & {
  [K in SingletonKey]: SingletonRepository<SingletonRecordTypes[K]>;
} & {
  candles: CandleCacheRepository;
};

export type AdapterKind = "local" | "mock" | "supabase";

export interface PersistenceAdapter {
  kind: AdapterKind;
  repositories: JournalRepositories;
  /** Owner the adapter writes as right now. Local/mock: "demo-owner". Supabase: the session's `auth.uid()` or null. */
  currentOwner(): Promise<UserId | null>;
}
