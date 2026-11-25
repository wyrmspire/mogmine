// #174: AI-operable command layer over the persistence contract (docs/26 §6).
// Typed create / read / list / update / archive / remove for every collection type, and read / write for the
// singletons. No React, no DOM, no route: a script or agent can call it directly, and so can the UI.
// Every write is validated here through the existing lib sanitizers first. An invalid record fails closed with
// `invalid` and nothing is written. Money is never rounded or coerced here (Guardrail 4).
import type {
  CollectionKey, CollectionRecordTypes, CollectionRepository, JournalRepositories, ListQuery, PersistErrorCode,
  PersistResult, RecordId, RecordTypeKey, SingletonKey, SingletonRecordTypes, SingletonRepository, Stored, UserId,
} from "../persistence/contract.ts";
import { RECORD_CONTRACTS, contractFor } from "../persistence/registry.ts";
import { DEFAULT_OWNER_USER_ID, isStopMove, normalizeTrade, toTicks, validateTradeInput } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { validateFutureTimes } from "../entry-form.ts";
import { sanitizeAccounts, sanitizeBalanceChecks } from "../accounts.ts";
import type { BalanceCheck, TradingAccount } from "../accounts.ts";
import { isValidRSizeCents, isValidStatedRiskR, resolveRSize, riskCents } from "../r-size.ts";
import { stopMoveError } from "../stop-facts.ts";
import { sanitizeMoodRecords, sanitizeRegistry } from "../mood.ts";
import { sanitizeCandidates } from "../mood-store-sanitize.ts";
import { sanitizePlaybook } from "../playbooks-sanitize.ts";
import { sanitizePlannedLevel, sanitizePlanningSession, sanitizePlanRevision } from "../plans-sanitize.ts";
import { sanitizeDrillRecord } from "../drills-sanitize.ts";
import { sanitizeCall, sanitizeDismissal } from "../calls-sanitize.ts";
import { sanitizeChallenge } from "../challenge-sanitize.ts";
import type { ChallengeDefinition } from "../challenges.ts";
import { sanitizePrefs } from "../prefs-sanitize.ts";
import { sessionDate } from "../session.ts";
import { DAILY_REVIEW_LIMITS } from "../daily-review.ts";
import type { DailyReview } from "../daily-review.ts";
import { isValidSessionDate, sanitizeDailyReview, sanitizeReviewPoint } from "../daily-review-sanitize.ts";
import { PROMPT_LIBRARY_SCHEMA } from "../discretionary-prompts.ts";
import type { PromptLibraryV1 } from "../discretionary-prompts.ts";
import { sanitizeTagRegistry } from "../tag-registry.ts";

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
type Parser<T> = (raw: unknown) => Parsed<T>;

const bad = (message: string) => ({ ok: false as const, message });
const good = <T>(value: T) => ({ ok: true as const, value });

/** One object through a sanitizer that returns null for a bad record. */
const one = <T>(sanitize: (raw: unknown) => T | null, message: string): Parser<T> => (raw) => {
  const value = sanitize(raw);
  return value ? good(value) : bad(message);
};

/** A list sanitizer, given a single record: a record it drops is invalid. */
const oneOfList = <T>(sanitize: (raw: unknown) => T[], message: string): Parser<T> => (raw) => {
  const [value] = sanitize([raw]);
  return value ? good(value) : bad(message);
};

const isObject = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw);

function derivedFieldIn(key: RecordTypeKey, raw: unknown): string | null {
  if (!isObject(raw)) return null;
  return contractFor(key).derivedNeverStored.find((field) => Object.hasOwn(raw, field)) ?? null;
}

/** Old rows may contain a now-derived field. Never carry it into a new whole-record write. */
function withoutDerived<T>(key: RecordTypeKey, record: T): T {
  if (!isObject(record)) return record;
  const clean = { ...record };
  for (const field of contractFor(key).derivedNeverStored) delete clean[field];
  return clean as T;
}

function parseTrade(raw: unknown, nowMs = Date.now()): Parsed<TradeRecord> {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id.trim()) return bad("A trade needs an id.");
  if (raw.direction !== "LONG" && raw.direction !== "SHORT") return bad("A trade direction is LONG or SHORT.");
  // The sanitizer drops a bad stop move silently. Here a bad one rejects the whole trade, so nothing is lost unnoticed.
  if (raw.stop_moves !== undefined && (!Array.isArray(raw.stop_moves) || !raw.stop_moves.every(isStopMove))) {
    return bad("Every stop move needs a numeric price and a valid time.");
  }
  if (raw.r_size_cents != null && !isValidRSizeCents(raw.r_size_cents)) return bad("Trade R size must be whole cents between $1 and $100,000.");
  if (raw.stated_risk_r != null && !isValidStatedRiskR(raw.stated_risk_r)) return bad("Stated risk R must be between 0.01 and 10 (up to 2 decimal places).");
  let trade: TradeRecord;
  try {
    trade = normalizeTrade(raw as Parameters<typeof normalizeTrade>[0]);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "This trade is not valid.");
  }
  const entryAt = Date.parse(trade.entry_time);
  const exitAt = Date.parse(trade.exit_time ?? "");
  if (!Number.isFinite(entryAt)) return bad("Entry time must be a valid date and time.");
  if (trade.status === "closed" && !Number.isFinite(exitAt)) return bad("Exit time must be a valid date and time.");
  if (trade.status === "closed" && exitAt <= entryAt) return bad("Exit time must be after entry time.");
  const future = validateFutureTimes(entryAt, trade.status === "open" ? null : exitAt, nowMs); // UX-09: a typo'd future date
  const futureError = future.entry ?? future.exit;
  if (futureError) return bad(futureError);
  if (trade.initial_stop_price != null && trade.initial_stop_set_at == null) trade.initial_stop_set_at = trade.entry_time; // UX-19
  const hasInitialStop = trade.initial_stop_price != null;
  const hasInitialStopTime = trade.initial_stop_set_at != null;
  if (hasInitialStop !== hasInitialStopTime) return bad("Initial stop price and set time go together.");
  if (hasInitialStopTime && !Number.isFinite(Date.parse(trade.initial_stop_set_at ?? ""))) {
    return bad("Initial stop set time must be a valid date and time.");
  }
  // Price, tick, quantity and entry-stop-side rules are the same ones the entry form enforces. A working stop with
  // movement history may legitimately lock profit on the other side of entry, so it gets only the tick check below.
  const stopAtEntry = trade.initial_stop_price ?? (trade.stop_moves?.length ? null : trade.stop_loss_price);
  const errors = validateTradeInput({
    symbol: trade.symbol, direction: trade.direction, quantity: trade.quantity,
    entry_price: trade.entry_price, exit_price: trade.status === "open" ? null : trade.exit_price,
    stop_loss_price: stopAtEntry, planned_target_price: trade.planned_target_price, key_level_price: trade.key_level_price,
  });
  const firstError = Object.values(errors)[0];
  if (firstError) return bad(firstError);
  if (trade.stop_loss_price != null && toTicks(trade.stop_loss_price, trade.symbol) == null) {
    return bad("The working stop must be a finite price on the contract's tick grid.");
  }
  if (trade.stop_moves?.some((move) => toTicks(move.price, trade.symbol) == null)) {
    return bad("Every stop move price must sit on the contract's tick grid.");
  }
  const moveError = stopMoveError(trade, entryAt, exitAt); if (moveError) return bad(moveError); // 05 §3.1
  // risk_cents is computed, never accepted as given. A client value must match the computed one (null matches null).
  if (raw.risk_cents !== undefined && raw.risk_cents !== riskCents(trade)) {
    return bad("risk_cents is computed from entry, initial stop and quantity and did not match.");
  }
  return good(trade);
}

/** Money is integer cents. The sanitizer rounds a fractional amount silently, so the command layer refuses it first. */
const accountParser = (raw: unknown): Parsed<TradingAccount> => {
  const rules = isObject(raw) && isObject(raw.rules) ? raw.rules : {};
  const wholeOrAbsent = (value: unknown) => value === undefined || value === null || Number.isInteger(value);
  if (!isObject(raw) || !Number.isInteger(raw.starting_balance_cents)) return bad("An account needs a whole-cent starting balance.");
  if (raw.r_size_cents != null && !isValidRSizeCents(raw.r_size_cents)) return bad("Account R size must be whole cents between $1 and $100,000.");
  if (!["max_loss_cents", "daily_loss_cents", "profit_target_cents"].every((field) => wholeOrAbsent(rules[field]))) {
    return bad("Account limits are whole cents only.");
  }
  return oneOfList(sanitizeAccounts, "An account needs a name and a whole-cent starting balance.")(raw);
};

const balanceCheckParser = (raw: unknown): Parsed<BalanceCheck> => {
  if (!isObject(raw) || !Number.isInteger(raw.balance_cents)) return bad("A balance check needs a whole-cent balance.");
  return oneOfList(sanitizeBalanceChecks, "A balance check needs an account, a time and a balance.")(raw);
};

const planParser: Parser<CollectionRecordTypes["plans"]> = (raw) => {
  if (isObject(raw) && raw.levels !== undefined
    && (!Array.isArray(raw.levels) || raw.levels.some((level) => !sanitizePlannedLevel(level)))) {
    return bad("Every planned level needs a finite price and an integer tick price.");
  }
  if (isObject(raw) && raw.revisions !== undefined) {
    if (!Array.isArray(raw.revisions)) return bad("Plan revisions must be a list.");
    for (const revision of raw.revisions) {
      if (!sanitizePlanRevision(revision)) return bad("Every plan revision needs an id and a valid saved time.");
      if (isObject(revision) && revision.levels !== undefined
        && (!Array.isArray(revision.levels) || revision.levels.some((level) => !sanitizePlannedLevel(level)))) {
        return bad("Every revised level needs a finite price and an integer tick price.");
      }
    }
  }
  return one(sanitizePlanningSession, "A plan needs an id, a session date and a name.")(raw);
};

const callParser: Parser<CollectionRecordTypes["calls"]> = (raw) => {
  if (isObject(raw)) {
    const hasPrice = raw.price != null;
    const hasPriceTicks = raw.price_ticks != null;
    if (hasPrice !== hasPriceTicks) return bad("A call's price and price in ticks go together.");
    if (hasPrice && (typeof raw.price !== "number" || !Number.isFinite(raw.price))) return bad("A call price must be finite.");
    if (hasPriceTicks && !Number.isSafeInteger(raw.price_ticks)) return bad("A call's price in ticks must be a whole number.");
  }
  return one(sanitizeCall, "This call does not match its kind (for example, a flip needs a signal direction).")(raw);
};

/** docs/06 §2: a review needs an id, a trading day, a scope and a time. Over-long text is refused here (the sanitizer cuts it). */
const dailyReviewParser: Parser<DailyReview> = (raw) => {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id.trim()) return bad("A daily review needs an id.");
  if (!isValidSessionDate(raw.session_date)) return bad("A daily review needs a session date (YYYY-MM-DD).");
  if (raw.account_id != null && (typeof raw.account_id !== "string" || !raw.account_id.trim())) return bad("A daily review's account must be an id or null (whole day).");
  if (typeof raw.recorded_at !== "string" || !Number.isFinite(Date.parse(raw.recorded_at))) return bad("A daily review needs a valid recorded time.");
  if (raw.lesson !== undefined && (typeof raw.lesson !== "string" || raw.lesson.length > DAILY_REVIEW_LIMITS.lesson)) {
    return bad(`The lesson is at most ${DAILY_REVIEW_LIMITS.lesson} characters.`);
  }
  if (raw.points !== undefined && (!Array.isArray(raw.points) || raw.points.some((point) => !sanitizeReviewPoint(point) || (point as { text: string }).text.length > DAILY_REVIEW_LIMITS.pointText))) {
    return bad(`Every point needs a kind and text of at most ${DAILY_REVIEW_LIMITS.pointText} characters.`);
  }
  return one(sanitizeDailyReview, "This daily review is not valid.")(raw);
};

/** A challenge: `account_id` is optional (undefined or null = all accounts), and when given it must be a non-empty string (UX-08). */
export const parseChallengeRecord: Parser<ChallengeDefinition> = (raw) => {
  if (isObject(raw) && raw.account_id !== undefined && raw.account_id !== null
    && (typeof raw.account_id !== "string" || raw.account_id.trim() === "")) {
    return bad("A challenge's account must be a trading account id, or left out for all accounts.");
  }
  return one(sanitizeChallenge, "This challenge definition is not valid.")(raw);
};

/** Validation for every collection type. Each entry is the existing sanitizer for that record. */
const COLLECTION_PARSERS: { [K in CollectionKey]: Parser<CollectionRecordTypes[K]> } = {
  trades: parseTrade,
  mood_records: oneOfList(sanitizeMoodRecords, "This mood record is missing its trade, source or scores."),
  mood_candidates: oneOfList(sanitizeCandidates, "This spoke candidate needs a label and trade ids."),
  accounts: accountParser,
  balance_checks: balanceCheckParser,
  challenges: parseChallengeRecord,
  playbooks: one(sanitizePlaybook, "A playbook needs an id, a name and a list of rules."),
  plans: planParser,
  drills: one(sanitizeDrillRecord, "A drill record needs a trade, a kind, an answer and a time."),
  calls: callParser,
  prompt_dismissals: one(sanitizeDismissal, "A dismissal needs a trade, a prompt, a reason and a time."),
  daily_reviews: dailyReviewParser,
};

/** Singletons: one document per owner. Prompt library has no sanitizer yet, so only its shape is checked. */
const SINGLETON_PARSERS: { [K in SingletonKey]: Parser<SingletonRecordTypes[K]> } = {
  prefs: (raw) => {
    if (!isObject(raw)) return bad("Preferences must be an object.");
    if (raw.riskBudgetUsd !== undefined
      && (typeof raw.riskBudgetUsd !== "number" || !Number.isFinite(raw.riskBudgetUsd)
        || raw.riskBudgetUsd < 10 || raw.riskBudgetUsd > 100_000)) {
      return bad("Risk budget must be between $10 and $100,000.");
    }
    return good(sanitizePrefs(raw));
  },
  mood_registry: (raw) => (isObject(raw) ? good(sanitizeRegistry(raw)) : bad("The mood spoke registry must be an object.")),
  tag_registry: (raw) => (isObject(raw) ? good(sanitizeTagRegistry(raw)) : bad("The tag registry must be an object.")),
  prompt_library: (raw) => isObject(raw) && raw.schema === PROMPT_LIBRARY_SCHEMA && Array.isArray(raw.prompts) && typeof raw.seeds_version === "number"
    ? good(raw as unknown as PromptLibraryV1) : bad("The prompt library has an unknown schema."),
};

/**
 * Freeze a trade's R size (04 §3.3, D-B) from its account, else the default, when it has none yet or when `force`
 * is set (its account changed). Trades that already carry a size keep it.
 */
function withFrozenRSize(
  trade: TradeRecord,
  inputs: { accounts: TradingAccount[]; prefs: Parameters<typeof resolveRSize>[2] },
  force = false,
): TradeRecord {
  if (!force && trade.r_size_cents != null) return trade;
  return { ...trade, r_size_cents: resolveRSize({ ...trade, r_size_cents: null }, inputs.accounts, inputs.prefs).cents };
}

/**
 * Narrowing for agent list reads (docs/07 §3.5). `from` and `to` bound the entry time, both inclusive. `session_date`
 * is the trading day of the entry (`sessionDate`, 18:00 ET rollover), so an evening trade sits on the next day.
 */
export interface AgentListFilters {
  session_date?: string;
  from?: string;
  to?: string;
  account_id?: string;
  playbook_id?: string;
}

/** The filters each collection supports. Any other filter on a collection is refused, never silently ignored. */
const FILTERS_BY_COLLECTION: Partial<Record<CollectionKey, ReadonlyArray<keyof AgentListFilters>>> = {
  trades: ["session_date", "from", "to", "account_id", "playbook_id"],
  plans: ["session_date"],
  daily_reviews: ["session_date"],
};

export interface JournalCommands {
  create<K extends CollectionKey>(key: K, raw: unknown): Promise<PersistResult<Stored<CollectionRecordTypes[K]>>>;
  read<K extends CollectionKey>(key: K, id: RecordId): Promise<PersistResult<Stored<CollectionRecordTypes[K]>>>;
  list<K extends CollectionKey>(key: K, query?: ListQuery): Promise<PersistResult<CollectionRecordTypes[K][]>>;
  /**
   * Read-only: `list` narrowed by the agent filters. Filters apply after the repository read, so `limit` applies to the
   * filtered rows. With no filter set this is `list`.
   */
  listFiltered<K extends CollectionKey>(key: K, query?: ListQuery, filters?: AgentListFilters): Promise<PersistResult<CollectionRecordTypes[K][]>>;
  /** Shallow patch over the stored record, re-validated as a whole. Fails with `conflict` if the row changed since it was read. */
  update<K extends CollectionKey>(key: K, id: RecordId, patch: Record<string, unknown>): Promise<PersistResult<Stored<CollectionRecordTypes[K]>>>;
  /** Sets `archived` on types whose delete policy is `archive` (accounts, playbooks). */
  archive<K extends CollectionKey>(key: K, id: RecordId): Promise<PersistResult<Stored<CollectionRecordTypes[K]>>>;
  /** Hard delete. Archive-policy types return `forbidden`. Children with `cascade_parent` (e.g. a trade's drills) go first. */
  remove<K extends CollectionKey>(key: K, id: RecordId): Promise<PersistResult<void>>;
  readSingleton<K extends SingletonKey>(key: K): Promise<PersistResult<Stored<SingletonRecordTypes[K]> | null>>;
  writeSingleton<K extends SingletonKey>(key: K, raw: unknown): Promise<PersistResult<Stored<SingletonRecordTypes[K]>>>;
}

/**
 * Build the command set over one owner's repositories. `owner` is `DEFAULT_OWNER_USER_ID` on this device and the
 * signed-in `auth.uid()` on Supabase. Records may carry that same owner or the device default, never a foreign one.
 */
export function createJournalCommands(repos: JournalRepositories, owner: UserId = DEFAULT_OWNER_USER_ID, opts: { now?: () => number } = {}): JournalCommands {
  const now = opts.now ?? Date.now;
  /** Create and update check trade times against the clock (UX-09). Archive only reads and keeps the stored times. */
  const parseAt = <K extends CollectionKey>(key: K, raw: unknown): Parsed<CollectionRecordTypes[K]> =>
    key === "trades" ? (parseTrade(raw, now()) as Parsed<CollectionRecordTypes[K]>) : COLLECTION_PARSERS[key](raw);
  const fail = <T>(code: PersistErrorCode, message: string, recordType?: RecordTypeKey, id?: RecordId): PersistResult<T> => ({ ok: false, error: { code, message, recordType, id } });
  const repoFor = <K extends CollectionKey>(key: K) => repos[key] as CollectionRepository<CollectionRecordTypes[K]>;
  const idOf = (record: unknown): RecordId => (isObject(record) && typeof record.id === "string" ? record.id : "");

  /** The accounts and default prefs an R size is resolved against. Either read failing fails the write. */
  async function rSizeInputs(): Promise<PersistResult<{ accounts: TradingAccount[]; prefs: Parameters<typeof resolveRSize>[2] }>> {
    const accounts = await repos.accounts.list(owner);
    if (!accounts.ok) return accounts;
    const prefs = await repos.prefs.get(owner);
    if (!prefs.ok) return prefs;
    return { ok: true, value: { accounts: accounts.value, prefs: prefs.value?.record ?? null } };
  }

  /** Records of owned types must carry the caller's owner (or the device default), and are stamped with it. */
  function ownedBy<T>(key: RecordTypeKey, record: T): Parsed<T> {
    if (contractFor(key).ownership !== "user_id") return good(record);
    const carried = (record as { user_id?: unknown }).user_id;
    if (carried !== undefined && carried !== owner && carried !== DEFAULT_OWNER_USER_ID) {
      return bad("This record belongs to another owner.");
    }
    return good({ ...record, user_id: owner } as T);
  }

  /** Q-3 / docs/06 rule 5: one daily review per (session_date, account_id). Another review on that scope is a conflict. */
  async function reviewScopeClash(review: DailyReview): Promise<PersistResult<never> | null> {
    const rows = await repoFor("daily_reviews").list(owner);
    if (!rows.ok) return rows;
    const scope = (row: DailyReview) => `${row.session_date}|${row.account_id ?? "*"}`;
    const clash = rows.value.find((row) => row.id !== review.id && scope(row) === scope(review));
    return clash ? fail("conflict", `A daily review for ${review.session_date} already exists (${clash.id}).`, "daily_reviews", clash.id) : null;
  }

  async function write<K extends CollectionKey>(key: K, parsed: CollectionRecordTypes[K], expectedUpdatedAt?: string) {
    const stamped = ownedBy<CollectionRecordTypes[K]>(key, parsed);
    if (!stamped.ok) return fail<Stored<CollectionRecordTypes[K]>>("forbidden", stamped.message, key, idOf(parsed));
    return repoFor(key).put(owner, stamped.value, expectedUpdatedAt ? { expectedUpdatedAt } : undefined);
  }

  const commands: JournalCommands = {
    async create(key, raw) {
      const derived = derivedFieldIn(key, raw);
      if (derived) return fail("forbidden", `${derived} is derived and cannot be stored.`, key, idOf(raw));
      const parsed = parseAt(key, raw);
      if (!parsed.ok) return fail("invalid", parsed.message, key, idOf(raw));
      const existing = await repoFor(key).get(owner, idOf(parsed.value));
      if (existing.ok) return fail("conflict", `A ${key} record with this id already exists.`, key, idOf(parsed.value));
      if (existing.error.code !== "not_found") return existing;
      if (key === "daily_reviews") {
        const clash = await reviewScopeClash(parsed.value as DailyReview);
        if (clash) return clash;
      }
      if (key !== "trades") return write(key, parsed.value);
      const inputs = await rSizeInputs();
      if (!inputs.ok) return inputs;
      const frozen = withFrozenRSize(parsed.value as TradeRecord, inputs.value);
      return write(key, frozen as CollectionRecordTypes[typeof key]);
    },

    read(key, id) {
      return repoFor(key).get(owner, id);
    },

    list(key, query) {
      return repoFor(key).list(owner, query);
    },

    async listFiltered(key, query, filters) {
      const active = (Object.keys(filters ?? {}) as Array<keyof AgentListFilters>).filter((name) => filters?.[name] !== undefined);
      if (active.length === 0) return repoFor(key).list(owner, query);
      const supported: ReadonlyArray<keyof AgentListFilters> = FILTERS_BY_COLLECTION[key] ?? [];
      const refused = active.find((name) => !supported.includes(name));
      if (refused) return fail("invalid", `${refused} is not a filter on ${key}.`, key);
      // Filter first, then limit: the limit counts rows that match.
      const rows = await repoFor(key).list(owner, { ...query, limit: undefined });
      if (!rows.ok) return rows;
      const from = filters?.from === undefined ? undefined : Date.parse(filters.from);
      const to = filters?.to === undefined ? undefined : Date.parse(filters.to);
      const matches = (row: unknown): boolean => {
        if (!isObject(row)) return false;
        if (filters?.session_date !== undefined && (key === "trades" ? sessionDate(String(row.entry_time)) : row.session_date) !== filters.session_date) return false;
        if (from !== undefined || to !== undefined) {
          const at = Date.parse(String(row.entry_time));
          if (from !== undefined && !(at >= from)) return false;
          if (to !== undefined && !(at <= to)) return false;
        }
        if (filters?.account_id !== undefined && row.account_id !== filters.account_id) return false;
        if (filters?.playbook_id !== undefined && row.playbook_id !== filters.playbook_id) return false;
        return true;
      };
      const matched = (rows.value as unknown[]).filter(matches);
      const limited = query?.limit === undefined ? matched : matched.slice(0, Math.max(0, query.limit));
      return { ok: true, value: limited as CollectionRecordTypes[typeof key][] };
    },

    async update(key, id, patch) {
      const derived = derivedFieldIn(key, patch);
      if (derived) return fail("forbidden", `${derived} is derived and cannot be stored.`, key, id);
      const current = await repoFor(key).get(owner, id);
      if (!current.ok) return current;
      // A stored risk_cents may be stale once entry, stop or quantity change. Unless the patch sets it, drop it so
      // the recomputed value is checked instead of the old one.
      const base = key === "trades" && !("risk_cents" in patch) ? { ...current.value.record, risk_cents: undefined } : current.value.record;
      const candidate = withoutDerived(key, { ...base, ...patch, id });
      const parsed = parseAt(key, candidate);
      if (!parsed.ok) return fail("invalid", parsed.message, key, id);
      if (key === "daily_reviews") {
        const before = current.value.record as DailyReview;
        const after = parsed.value as DailyReview;
        const scopeChanged = before.session_date !== after.session_date || (before.account_id ?? null) !== (after.account_id ?? null);
        const clash = scopeChanged ? await reviewScopeClash(after) : null;
        if (clash) return clash;
      }
      if (key !== "trades") return write(key, parsed.value, current.value.meta.updated_at);
      const trade = parsed.value as TradeRecord;
      const accountChanged = "account_id" in patch && patch.account_id !== (current.value.record as TradeRecord).account_id;
      if (!accountChanged && trade.r_size_cents != null) {
        return write(key, trade as CollectionRecordTypes[typeof key], current.value.meta.updated_at);
      }
      const inputs = await rSizeInputs();
      if (!inputs.ok) return inputs;
      const frozen = withFrozenRSize(trade, inputs.value, accountChanged);
      return write(key, frozen as CollectionRecordTypes[typeof key], current.value.meta.updated_at);
    },

    async archive(key, id) {
      if (contractFor(key).deletePolicy !== "archive") return fail("forbidden", `${key} records are removed, not archived.`, key, id);
      const current = await repoFor(key).get(owner, id);
      if (!current.ok) return current;
      const candidate = withoutDerived(key, { ...current.value.record, archived: true, id });
      const parsed = COLLECTION_PARSERS[key](candidate);
      if (!parsed.ok) return fail("invalid", parsed.message, key, id);
      // A record whose sanitizer refuses to archive it (the impulse playbook) must fail before any write.
      if ((parsed.value as { archived?: unknown }).archived !== true) return fail("invalid", "This record cannot be archived.", key, id);
      return write(key, parsed.value, current.value.meta.updated_at);
    },

    async remove(key, id) {
      if (contractFor(key).deletePolicy === "archive") return fail("forbidden", "This record is archived, not deleted. Archive it instead.", key, id);
      // Children go first, so a failed cascade can be retried while the parent still exists.
      for (const child of RECORD_CONTRACTS.filter((entry) => entry.parent === key && entry.deletePolicy === "cascade_parent")) {
        const childRepo = repos[child.key as CollectionKey] as unknown as CollectionRepository<{ id: RecordId }>;
        const children = await childRepo.list(owner, { parentId: id, includeSamples: true, includeArchived: true });
        if (!children.ok) return fail(children.error.code, children.error.message, child.key, id);
        for (const row of children.value) {
          const removed = await childRepo.remove(owner, row.id);
          if (!removed.ok) return removed;
        }
      }
      return repoFor(key).remove(owner, id);
    },

    readSingleton(key) {
      return repos[key].get(owner) as Promise<PersistResult<Stored<SingletonRecordTypes[typeof key]> | null>>;
    },

    async writeSingleton(key, raw) {
      const parsed = SINGLETON_PARSERS[key](raw);
      if (!parsed.ok) return fail("invalid", parsed.message, key);
      const stamped = ownedBy(key, parsed.value);
      if (!stamped.ok) return fail("forbidden", stamped.message, key);
      return (repos[key] as SingletonRepository<SingletonRecordTypes[typeof key]>).put(owner, stamped.value);
    },
  };
  return commands;
}
