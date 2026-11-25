// #185a: maps one parsed agent route onto the journal command layer (#174). Pure over the command interface: no SDK,
// no Next. The command layer decides what is valid and what is forbidden; this file only shapes the HTTP answer.
// #API-2a: `?include=derived` adds a `derived` block on trades and accounts. It is computed here, on read, and never
// stored (docs/07 §3.5, guardrail 11).
import type { CollectionKey, PersistError, PersistResult, SingletonKey } from "../persistence/contract.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { agentError, agentFail, agentOk, statusFor } from "./http.ts";
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
import { isValidRSizeCents } from "../r-size.ts";
import { checkTradeWrite } from "./write-checks.ts";
import type { AgentWriteWarning, TradeWriteCheckResult, WriteCheckContext } from "./write-checks.ts";

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
  return { status, body: { ok: true, data: result.value, warnings }, recordType: "trades", recordId, outcome: "ok" };
}

function invalidBody(recordType: string, recordId: string | undefined, message: string): AgentDispatch {
  const { status, body } = agentFail(statusFor("invalid"), "invalid", message);
  return { status, body, recordType, recordId, outcome: "invalid" };
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
        return settle(listed, route.type, undefined, (records) => records);
      }
      const context = await deriveContext(route.type, commands);
      if (!context.ok) return failure(context.error, route.type, undefined);
      const rows = (listed.value as unknown[]).map((row) => ({ ...(row as object), derived: deriveOne(route.type as "trades" | "accounts", row, context.value) }));
      return settle({ ok: true, value: rows }, route.type, undefined, (records) => records);
    }

    case "create": {
      const id = isPlainObject(route.body) && typeof route.body.id === "string" ? route.body.id : undefined;
      if (route.type !== "trades" || !isPlainObject(route.body)) {
        return settle(await commands.create(route.type, route.body), route.type, id, (stored) => stored, 201);
      }
      const checked = await checkTradeBody(route.body, null, commands, options);
      if (!checked.ok) return failure(checked.error, "trades", id);
      if (checked.value && !checked.value.ok) return invalidBody("trades", id, checked.value.message);
      return settleTrade(await commands.create("trades", route.body), id, checked.value?.warnings ?? [], 201);
    }

    case "read": {
      const stored = await commands.read(route.type, route.id);
      if (!stored.ok || !route.includeDerived || !isDerivable(route.type)) {
        return settle(stored, route.type, route.id, (value) => value);
      }
      const context = await deriveContext(route.type, commands);
      if (!context.ok) return failure(context.error, route.type, route.id);
      const derived = deriveOne(route.type, stored.value.record, context.value);
      return settle({ ok: true, value: { ...stored.value, derived } }, route.type, route.id, (value) => value);
    }

    case "update": {
      if (!isPlainObject(route.body)) return invalidBody(route.type, route.id, "Body must be a JSON object of fields to change.");
      if (route.type !== "trades") return settle(await commands.update(route.type, route.id, route.body), route.type, route.id, (stored) => stored);
      const current = await commands.read("trades", route.id);
      if (!current.ok) return failure(current.error, "trades", route.id);
      const checked = await checkTradeBody(route.body, current.value.record, commands, options);
      if (!checked.ok) return failure(checked.error, "trades", route.id);
      if (checked.value && !checked.value.ok) return invalidBody("trades", route.id, checked.value.message);
      return settleTrade(await commands.update("trades", route.id, route.body), route.id, checked.value?.warnings ?? [], 200);
    }

    case "remove": {
      const result = await commands.remove(route.type, route.id);
      return settle(result, route.type, route.id, () => null);
    }

    case "archive":
      return settle(await commands.archive(route.type, route.id), route.type, route.id, (stored) => stored);

    case "readSingleton":
      return settle(await commands.readSingleton(route.key), route.key, undefined, (stored) => stored);

    case "writeSingleton":
      return settle(await commands.writeSingleton(route.key, route.body), route.key, undefined, (stored) => stored);
  }
}
