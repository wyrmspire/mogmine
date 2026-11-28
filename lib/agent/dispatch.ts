// #185a: maps one parsed agent route onto the journal command layer (#174). Pure over the command interface: no SDK,
// no Next. The command layer decides what is valid and what is forbidden; this file only shapes the HTTP answer.
// #API-2a: `?include=derived` adds a `derived` block on trades and accounts. It is computed here, on read, and never
// stored (docs/07 §3.5, guardrail 11).
import type { CollectionKey, PersistError, PersistResult, SingletonKey } from "../persistence/contract.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { agentError, agentFail, agentOk, COLLECTION_KEYS, decodeRouteParam, isCollectionKey, isSingletonKey, SINGLETON_KEYS, statusFor } from "./http.ts";
import type { AgentListQuery } from "./http.ts";
import { buildVocabulary } from "./vocabulary.ts";
import { accountSummary, pnlCents } from "../accounts.ts";
import type { BalanceCheck, TradingAccount } from "../accounts.ts";
import { resolveRSize, resultR, riskCents, riskR } from "../r-size.ts";
import { holdSeconds, isOpen, normalizeTrade } from "../trades.ts";
import type { TradeRecord } from "../trades.ts";
import { sessionDate } from "../session.ts";
import type { Prefs } from "../prefs-sanitize.ts";
import { EXECUTION_TAGS, PLAYBOOK_SEEDS, SETUP_TAGS } from "../playbooks.ts";
import { DEFAULT_TAG_REGISTRY, sanitizeTagRegistry } from "../tag-registry.ts";
import { isValidRSizeCents } from "../r-size.ts";
import { checkTradeWrite } from "./write-checks.ts";
import type { AgentWriteWarning, TradeWriteCheckResult, WriteCheckContext } from "./write-checks.ts";
import { AGENT_NOTE_FIELDS, agentWriteProvenance } from "./provenance.ts";
import { withUntrustedTextMeta } from "./untrusted-text.ts";

export type AgentRoute =
  | { kind: "me" }
  | { kind: "vocabulary" }
  | { kind: "list"; type: CollectionKey; query: AgentListQuery }
  | { kind: "create"; type: CollectionKey; body: unknown }
  | { kind: "read"; type: CollectionKey; id: string; includeDerived?: boolean }
  | { kind: "remove" | "archive"; type: CollectionKey; id: string }
  | { kind: "update"; type: CollectionKey; id: string; body: unknown }
  | { kind: "readSingleton"; key: SingletonKey }
  | { kind: "writeSingleton"; key: SingletonKey; body: unknown };

/**
 * Optional inputs to the trade write checks (#API-2b). Neither is set by the route handler today, so the defaults apply:
 * no day range (the write path never fetches bars) and the real clock.
 */
export interface AgentDispatchOptions {
  /** The cached bars' day range for a trade, when the caller has them. Null or absent: no `price_out_of_range` check. */
  dayPriceRange?: (trade: TradeRecord) => { low: number; high: number } | null;
  /** The clock for the future-time refusal. Defaults to Date.now(). */
  nowMs?: number;
  /** Version supplied by If-Match or expected_updated_at. Checked before writes when present. */
  expectedUpdatedAt?: string;
}

export interface AgentWho {
  userId: string;
  tokenId: string;
  scopes: string[];
}

/** What the route handler sends, and what the audit log records. Never contains a token or hash. */
export interface AgentDispatch {
  status: number;
  body: unknown;
  recordType?: string;
  recordId?: string;
  outcome: string;
  decisionCode?: string;
  decisionVersion?: string;
}

const DECISION_VERSION = "agent-write-safety-1";

function writeDecision(code: string): Pick<AgentDispatch, "decisionCode" | "decisionVersion"> {
  return { decisionCode: code, decisionVersion: DECISION_VERSION };
}

async function versionMatches(
  commands: JournalCommands,
  route: Extract<AgentRoute, { kind: "update" }>,
  expected: string | undefined,
): Promise<AgentDispatch | null> {
  if (!expected) return null;
  const current = await commands.read(route.type, route.id);
  if (!current.ok) return failure(current.error, route.type, route.id);
  if (current.value.meta.updated_at !== expected) {
    const result = agentError("conflict", "The record changed since it was read. Re-read it and retry with its current version.");
    return { status: result.status, body: result.body, recordType: route.type, recordId: route.id, outcome: "conflict", ...writeDecision("optimistic_concurrency") };
  }
  return null;
}

/** The computed block on a trade (`?include=derived`). Money is integer cents; R values are null when not computable. */
export interface TradeDerived {
  pnl_cents: number | null;
  result_r: number | null;
  risk_cents: number | null;
  risk_r: number | null;
  r_size_cents: number;
  r_size_source: "trade" | "account" | "prefs";
  stated_risk_r: number | null;
  hold_seconds: number | null;
  session_date: string;
}

/** The computed block on an account (`?include=derived`), from the journal: balance = start + closed P&L + adjustments. */
export interface AccountDerived {
  balance_cents: number;
  realized_cents: number;
  adjustments_cents: number;
  drawdown_cents: number;
  closed_trades: number;
  open_trades: number;
  from_journal_gross: true;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Actionable 404 message when an agent requests an unknown collection, singleton, or route under /api/v1. */
export function notFoundHint(pathname: string): string {
  const rec = /^\/api\/v1\/records\/([^/]+)(?:\/|$)/.exec(pathname);
  if (rec) {
    const raw = decodeRouteParam(rec[1]) ?? rec[1];
    const key = raw.toLowerCase();
    if (key === "candles") return 'No collection "candles" under /records. Use GET /api/v1/candles (symbol, from, to, timeframe), and see GET /api/v1/guide.';
    if (key === "levels") return 'No collection "levels" under /records. Use GET /api/v1/levels (symbol, session_date, as_of?), and see GET /api/v1/guide.';
    if (key === "settings" || key === "preferences" || key === "prefs" || key === "user_prefs" || key === "user_preferences") {
      return "Settings and preferences are not under /records. Use GET/PUT /api/v1/singletons/prefs, and see GET /api/v1/guide.";
    }
    if (key === "mood_registry" || key === "tag_registry") {
      return `Use GET/PUT /api/v1/singletons/${key} instead of /records/${key}. See GET /api/v1/guide.`;
    }
    if (key === "vocabulary" || key === "tags" || key === "setup_tags" || key === "execution_tags") {
      return `Use GET /api/v1/vocabulary instead of /records/${key}. See GET /api/v1/guide.`;
    }
    if (key === "guide" || key === "house_rules") return `Use GET /api/v1/guide instead of /records/${key}.`;
    if (key === "prompt_library") {
      return `prompt_library is not exposed in the v1 agent API. Valid collections: ${COLLECTION_KEYS.join(", ")}. See GET /api/v1/guide.`;
    }
    if (isCollectionKey(raw)) return `Route not found for collection "${raw}". Check method and path in GET /api/v1/guide or GET /api/v1/openapi.json.`;
    return `Unknown collection. Valid collections: ${COLLECTION_KEYS.join(", ")}. For candles or levels use /api/v1/candles or /api/v1/levels; see GET /api/v1/guide.`;
  }
  const sing = /^\/api\/v1\/singletons\/([^/]+)(?:\/|$)/.exec(pathname);
  if (sing) {
    const raw = decodeRouteParam(sing[1]) ?? sing[1];
    const key = raw.toLowerCase();
    if (key === "settings" || key === "preferences" || key === "user_prefs" || key === "user_preferences") {
      return `Unknown singleton "${key}". Use /api/v1/singletons/prefs instead (valid singletons: ${SINGLETON_KEYS.join(", ")}). See GET /api/v1/guide.`;
    }
    if (key === "prompt_library") {
      return `Singleton "prompt_library" is not exposed in the v1 agent API. Valid singletons: ${SINGLETON_KEYS.join(", ")}. See GET /api/v1/guide.`;
    }
    if (key === "vocabulary") return "Use GET /api/v1/vocabulary instead of /api/v1/singletons/vocabulary. See GET /api/v1/guide.";
    if (key === "tags" || key === "tag_defs") return "Use /api/v1/singletons/tag_registry (or GET /api/v1/vocabulary for active tags). See GET /api/v1/guide.";
    if (key === "moods") return "Use /api/v1/singletons/mood_registry instead of /api/v1/singletons/moods. See GET /api/v1/guide.";
    if (isSingletonKey(raw)) return `Method or sub-path not supported for singleton "${raw}" (use GET or PUT). See GET /api/v1/guide.`;
    return `Unknown singleton. Valid singletons: ${SINGLETON_KEYS.join(", ")}. See GET /api/v1/guide.`;
  }
  return "Not found. See GET /api/v1/guide or GET /api/v1/openapi.json.";
}

/** Only trades and accounts have a derived block. Other collections ignore `include=derived`. */
const isDerivable = (type: CollectionKey): type is "trades" | "accounts" => type === "trades" || type === "accounts";

function failure(error: PersistError, recordType: string, recordId: string | undefined): AgentDispatch {
  const { status, body } = agentError(error.code, error.message);
  return { status, body, recordType, recordId, outcome: error.code };
}

function settle<T>(
  result: PersistResult<T>,
  recordType: string,
  recordId: string | undefined,
  shape: (value: T) => unknown,
  status = 200,
): AgentDispatch {
  if (!result.ok) return failure(result.error, recordType, recordId);
  const { body } = agentOk(shape(result.value), status);
  return { status, body, recordType, recordId, outcome: "ok" };
}

/** The owner's playbooks, accounts and prefs, in the shape the write checks read. Playbooks fall back to the seeds, as the vocabulary does. */
async function writeVocabulary(commands: JournalCommands): Promise<PersistResult<Omit<WriteCheckContext, "isCreate" | "writtenFields" | "dayPriceRange" | "nowMs">>> {
  const playbooks = await commands.list("playbooks", { includeArchived: true, includeSamples: false });
  if (!playbooks.ok) return playbooks;
  const accounts = await commands.list("accounts", { includeArchived: true, includeSamples: false });
  if (!accounts.ok) return accounts;
  const stored = await commands.readSingleton("prefs");
  if (!stored.ok) return stored;
  const prefs = stored.value?.record ?? null;
  const tags = await commands.readSingleton("tag_registry");
  const tagRegistry = tags.ok && tags.value ? sanitizeTagRegistry(tags.value.record) : DEFAULT_TAG_REGISTRY;
  const seeds = playbooks.value.length > 0 ? playbooks.value : PLAYBOOK_SEEDS;
  return {
    ok: true,
    value: {
      playbooks: seeds.map((playbook) => ({ id: playbook.id, name: playbook.name, archived: playbook.archived === true })),
      accounts: accounts.value.map((account) => ({
        id: account.id,
        name: account.name,
        r_size_cents: isValidRSizeCents(account.r_size_cents) ? account.r_size_cents as number : null,
        archived: account.archived === true,
      })),
      setupTags: [...SETUP_TAGS],
      executionTags: [...EXECUTION_TAGS],
      tagRegistry,
      defaultRSizeCents: resolveRSize({ account_id: null }, [], prefs).cents,
    },
  };
}

/**
 * The write checks for one trade body (#API-2b). `current` is the stored trade on an update, null on a create. The
 * candidate is the record as it would be stored. When it cannot be built, the checks are skipped and the command layer
 * refuses the write on its own rules.
 */
async function checkTradeBody(
  body: Record<string, unknown>,
  current: TradeRecord | null,
  commands: JournalCommands,
  options: AgentDispatchOptions,
): Promise<PersistResult<TradeWriteCheckResult | null>> {
  let candidate: TradeRecord;
  try {
    candidate = normalizeTrade({ ...(current ?? {}), ...body } as Parameters<typeof normalizeTrade>[0]);
  } catch {
    return { ok: true, value: null };
  }
  const vocabulary = await writeVocabulary(commands);
  if (!vocabulary.ok) return vocabulary;
  const result = checkTradeWrite(candidate, body, {
    ...vocabulary.value,
    dayPriceRange: options.dayPriceRange?.(candidate) ?? null,
    nowMs: options.nowMs,
    isCreate: current === null,
    writtenFields: new Set(Object.keys(body)),
  });
  return { ok: true, value: result };
}

/** A saved trade, with the write-time warnings beside it. Warnings are always present, possibly empty. */
function settleTrade<T>(result: PersistResult<T>, recordId: string | undefined, warnings: AgentWriteWarning[], status: number): AgentDispatch {
  if (!result.ok) return failure(result.error, "trades", recordId);
  return { status, body: { ok: true, data: withUntrustedTextMeta("trades", result.value), warnings }, recordType: "trades", recordId, outcome: "ok" };
}

function invalidBody(recordType: string, recordId: string | undefined, message: string): AgentDispatch {
  const { status, body } = agentFail(statusFor("invalid"), "invalid", message);
  return { status, body, recordType, recordId, outcome: "invalid" };
}

function stampAgentWrite(body: Record<string, unknown>, who: AgentWho): Record<string, unknown>;
function stampAgentWrite(body: unknown, who: AgentWho): unknown;
function stampAgentWrite(body: unknown, who: AgentWho): unknown {
  if (!isPlainObject(body)) return body;
  const noteFields = AGENT_NOTE_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (noteFields.length === 0) return body;
  return { ...body, agent_provenance: agentWriteProvenance(who.tokenId), agent_provenance_fields: noteFields };
}

/** What a derived block is computed from: the owner's accounts and prefs, plus trades and checks for accounts. */
interface DeriveContext {
  accounts: TradingAccount[];
  prefs: Prefs | null;
  trades: TradeRecord[];
  checks: BalanceCheck[];
}

async function deriveContext(type: "trades" | "accounts", commands: JournalCommands): Promise<PersistResult<DeriveContext>> {
  const accounts = await commands.list("accounts", { includeArchived: true, includeSamples: true });
  if (!accounts.ok) return accounts;
  const stored = await commands.readSingleton("prefs");
  if (!stored.ok) return stored;
  const context: DeriveContext = { accounts: accounts.value, prefs: stored.value?.record ?? null, trades: [], checks: [] };
  if (type === "accounts") {
    const trades = await commands.list("trades", { includeArchived: false, includeSamples: false });
    if (!trades.ok) return trades;
    const checks = await commands.list("balance_checks", { includeArchived: false, includeSamples: false });
    if (!checks.ok) return checks;
    context.trades = trades.value;
    context.checks = checks.value;
  }
  return { ok: true, value: context };
}

function tradeDerived(trade: TradeRecord, context: DeriveContext): TradeDerived {
  const resolved = resolveRSize(trade, context.accounts, context.prefs);
  return {
    pnl_cents: pnlCents(trade),
    result_r: resultR(trade, resolved),
    risk_cents: riskCents(trade),
    risk_r: riskR(trade, resolved),
    r_size_cents: resolved.cents,
    r_size_source: resolved.source,
    stated_risk_r: trade.stated_risk_r ?? null,
    hold_seconds: isOpen(trade) ? null : holdSeconds(trade),
    session_date: sessionDate(trade.entry_time),
  };
}

function accountDerived(account: TradingAccount, context: DeriveContext): AccountDerived {
  const summary = accountSummary(account, context.trades, context.checks, new Date().toISOString());
  return {
    balance_cents: summary.balance_cents,
    realized_cents: summary.realized_cents,
    adjustments_cents: summary.adjustments_cents,
    drawdown_cents: summary.drawdown_cents,
    closed_trades: summary.closedTrades,
    open_trades: summary.openTrades,
    from_journal_gross: true,
  };
}

function deriveOne(type: "trades" | "accounts", record: unknown, context: DeriveContext): TradeDerived | AccountDerived {
  return type === "trades" ? tradeDerived(record as TradeRecord, context) : accountDerived(record as TradingAccount, context);
}

export async function dispatchAgentRoute(
  route: AgentRoute,
  commands: JournalCommands,
  who: AgentWho,
  options: AgentDispatchOptions = {},
): Promise<AgentDispatch> {
  switch (route.kind) {
    case "me": {
      const { body } = agentOk({ user_id: who.userId, token: { id: who.tokenId, scopes: who.scopes } });
      return { status: 200, body, outcome: "ok" };
    }

    case "vocabulary":
      return settle(await buildVocabulary(commands), "vocabulary", undefined, (vocabulary) => vocabulary);

    case "list": {
      const { filters, includeDerived, filterError, ...query } = route.query;
      if (filterError) return invalidBody(route.type, undefined, filterError);
      const listed = filters
        ? await commands.listFiltered(route.type, query, filters)
        : await commands.list(route.type, query);
      if (!listed.ok || !includeDerived || !isDerivable(route.type)) {
        return settle(listed, route.type, undefined, (records) => withUntrustedTextMeta(route.type, records));
      }
      const context = await deriveContext(route.type, commands);
      if (!context.ok) return failure(context.error, route.type, undefined);
      const rows = (listed.value as unknown[]).map((row) => ({ ...(row as object), derived: deriveOne(route.type as "trades" | "accounts", row, context.value) }));
      return settle({ ok: true, value: rows }, route.type, undefined, (records) => withUntrustedTextMeta(route.type, records));
    }

    case "create": {
      const id = isPlainObject(route.body) && typeof route.body.id === "string" ? route.body.id : undefined;
      const writeBody = stampAgentWrite(route.body, who);
      if (route.type !== "trades" || !isPlainObject(writeBody)) {
        const result = settle(await commands.create(route.type, writeBody), route.type, id, (stored) => withUntrustedTextMeta(route.type, stored), 201);
        return result.status >= 200 && result.status < 300 ? { ...result, ...writeDecision("create") } : result;
      }
      const checked = await checkTradeBody(writeBody, null, commands, options);
      if (!checked.ok) return failure(checked.error, "trades", id);
      if (checked.value && !checked.value.ok) return invalidBody("trades", id, checked.value.message);
      return { ...settleTrade(await commands.create("trades", writeBody), id, checked.value?.warnings ?? [], 201), ...writeDecision("create") };
    }

    case "read": {
      const stored = await commands.read(route.type, route.id);
      if (!stored.ok || !route.includeDerived || !isDerivable(route.type)) {
        return settle(stored, route.type, route.id, (value) => withUntrustedTextMeta(route.type, value));
      }
      const context = await deriveContext(route.type, commands);
      if (!context.ok) return failure(context.error, route.type, route.id);
      const derived = deriveOne(route.type, stored.value.record, context.value);
      return settle({ ok: true, value: { ...stored.value, derived } }, route.type, route.id, (value) => withUntrustedTextMeta(route.type, value));
    }

    case "update": {
      if (!isPlainObject(route.body)) return invalidBody(route.type, route.id, "Body must be a JSON object of fields to change.");
      const versionFailure = await versionMatches(commands, route, options.expectedUpdatedAt);
      if (versionFailure) return versionFailure;
      const writeBody = stampAgentWrite(route.body, who);
      if (route.type !== "trades") return { ...settle(await commands.update(route.type, route.id, writeBody, { expectedUpdatedAt: options.expectedUpdatedAt }), route.type, route.id, (stored) => withUntrustedTextMeta(route.type, stored)), ...writeDecision("update") };
      const current = await commands.read("trades", route.id);
      if (!current.ok) return failure(current.error, "trades", route.id);
      const checked = await checkTradeBody(writeBody, current.value.record, commands, options);
      if (!checked.ok) return failure(checked.error, "trades", route.id);
      if (checked.value && !checked.value.ok) return invalidBody("trades", route.id, checked.value.message);
      return { ...settleTrade(await commands.update("trades", route.id, writeBody, { expectedUpdatedAt: options.expectedUpdatedAt }), route.id, checked.value?.warnings ?? [], 200), ...writeDecision("update") };
    }

    case "remove": {
      const result = await commands.remove(route.type, route.id);
      return settle(result, route.type, route.id, () => null);
    }

    case "archive":
      return settle(await commands.archive(route.type, route.id), route.type, route.id, (stored) => stored);

    case "readSingleton":
      return settle(await commands.readSingleton(route.key), route.key, undefined, (stored) => withUntrustedTextMeta(route.key, stored));

    case "writeSingleton":
      if (options.expectedUpdatedAt) {
        const current = await commands.readSingleton(route.key);
        if (!current.ok) return failure(current.error, route.key, undefined);
        if (!current.value || current.value.meta.updated_at !== options.expectedUpdatedAt) {
          const result = agentError("conflict", "The singleton changed since it was read. Re-read it and retry with its current version.");
          return { status: result.status, body: result.body, recordType: route.key, outcome: "conflict", ...writeDecision("optimistic_concurrency") };
        }
      }
      return { ...settle(await commands.writeSingleton(route.key, route.body, { expectedUpdatedAt: options.expectedUpdatedAt }), route.key, undefined, (stored) => withUntrustedTextMeta(route.key, stored)), ...writeDecision("update") };
  }
}
