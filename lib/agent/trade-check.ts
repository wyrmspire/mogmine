// #API-3: POST /api/v1/checks/trade (docs/design-2026-11-24/07-agent-api.md §3.3). Read scope although it is a POST: it
// writes nothing to any repository. An agent calls it on a draft (or a stored trade) before saving or moving a fill (HR-2).
// It reuses matchFill (FB-1), observeTrade with the post-entry rule (SM-1), the write checks (API-2b) and the R helpers.
import { canonicalSymbol, specFor, toTicks, normalizeTrade } from "../trades.ts";
import type { Candle, TradeRecord } from "../trades.ts";
import { matchFill } from "../fill-match.ts";
import type { FillMatch } from "../fill-match.ts";
import { observeTrade } from "../trade-bar-validation.ts";
import { deriveTrade, fromLegacy } from "../trade-document.ts";
import { resolveRSize, resultR, riskCents, riskR, isValidRSizeCents } from "../r-size.ts";
import { PLAYBOOK_SEEDS, EXECUTION_TAGS, SETUP_TAGS } from "../playbooks.ts";
import { checkTradeWrite } from "./write-checks.ts";
import type { AgentWriteWarning, WriteCheckContext } from "./write-checks.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import type { TradingAccount } from "../accounts.ts";
import type { Prefs } from "../prefs-sanitize.ts";
import { createMemoryCandleStore } from "../persistence/local-adapter.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import type { SupabaseLike } from "../persistence/supabase-adapter.ts";
import { agentEnabled, authenticateAgent, defaultAgentDeps, recordAgentUse } from "./server-auth.ts";
import type { AgentServerDeps } from "./server-auth.ts";
import { agentError, agentOk, createRateLimiter, isIsoTimestamp, statusFor } from "./http.ts";
import type { AgentErrorCode, AgentResponse, RateLimiter } from "./http.ts";
import { AGENT_BODY_LIMIT_BYTES } from "./handle.ts";
import { formatCt, loadAgentCandles, defaultCandleLoader, RANGE_CAP_MS } from "./candles.ts";
import type { CandleLoader } from "./candles.ts";

const MINUTE_MS = 60_000;
/** The bars checked around the trade: ten minutes before the entry and after the exit (or the entry, when open). */
const PAD_MS = 10 * MINUTE_MS;

export type FillOut =
  | { role: "entry" | "exit"; stated: string; price: number; match: "stated" }
  | { role: "entry" | "exit"; stated: string; price: number; match: "shifted"; matched: string; offset_min: number; message: string }
  | { role: "entry" | "exit"; stated: string; price: number; match: "outside" | "no-bars"; message: string };

export interface StopMoveOut {
  time: string;
  /** Null when the sent price was not a number. */
  price: number | null;
  ok: boolean;
  message?: string;
}

export interface FindingOut {
  code: string;
  bar_ct: string;
  price: number;
}

export interface TradeCheckData {
  fills: FillOut[];
  stop_moves: StopMoveOut[];
  findings: FindingOut[];
  warnings: AgentWriteWarning[];
  /** A write that would be refused (422 on save). Null when none. Reported here, not as an HTTP error. */
  refusal: string | null;
  derived: {
    risk_cents: number | null;
    risk_r: number | null;
    result_r: number | null;
    r_size_cents: number;
    r_size_source: "trade" | "account" | "prefs";
    stated_risk_r: number | null;
  };
  window: { from: string; to: string; reason?: "closed" | "future" };
}

/** The input after the body is parsed. A draft is a trade body; `stored` names a trade the owner already has. */
export type TradeCheckInput =
  | { kind: "stored"; id: string }
  | { kind: "draft"; body: Record<string, unknown> }
  | { kind: "invalid"; message: string };

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** `{ id }` alone is a stored trade. Anything with a symbol is a draft (it may still carry an `id`). */
export function parseCheckInput(body: unknown): TradeCheckInput {
  if (!isPlainObject(body)) return { kind: "invalid", message: "Body must be a JSON object: a draft trade, or { \"id\": \"…\" }." };
  if (body.symbol === undefined && typeof body.id === "string" && body.id.length > 0) return { kind: "stored", id: body.id };
  return { kind: "draft", body };
}

/** A draft as a trade record, normalized the way the command layer stores one. Structural problems are refused (422). */
export function draftRecord(body: Record<string, unknown>): { ok: true; record: TradeRecord } | Fail {
  const symbol = canonicalSymbol(typeof body.symbol === "string" ? body.symbol : "");
  if (!symbol) return fail("symbol must be a supported contract, for example MES or MNQ.");
  if (body.direction !== "LONG" && body.direction !== "SHORT") return fail('direction must be "LONG" or "SHORT".');
  if (typeof body.entry_time !== "string" || !isIsoTimestamp(body.entry_time)) return fail("entry_time must be an ISO-8601 time with a zone.");
  if (!isFiniteNumber(body.entry_price)) return fail("entry_price must be a number.");
  const hasExit = body.exit_time != null || body.exit_price != null;
  if (hasExit && (typeof body.exit_time !== "string" || !isIsoTimestamp(body.exit_time) || !isFiniteNumber(body.exit_price))) {
    return fail("exit_time and exit_price must be given together.");
  }
  if (hasExit && Date.parse(body.exit_time as string) <= Date.parse(body.entry_time)) return fail("exit_time must be after entry_time.");
  try {
    const record = normalizeTrade({
      ...body,
      id: typeof body.id === "string" && body.id.length > 0 ? body.id : "draft",
      symbol,
      direction: body.direction,
      entry_time: body.entry_time,
      entry_price: body.entry_price,
      exit_time: hasExit ? (body.exit_time as string) : null,
      exit_price: hasExit ? (body.exit_price as number) : null,
      status: hasExit ? "closed" : "open",
    } as Parameters<typeof normalizeTrade>[0]);
    return { ok: true, record };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The draft trade is not valid.");
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function fillOut(role: "entry" | "exit", stated: string, price: number, match: FillMatch): FillOut {
  if (match.kind === "stated") return { role, stated, price, match: "stated" };
  if (match.kind === "shifted") {
    return {
      role, stated, price, match: "shifted",
      matched: iso(match.barTime),
      offset_min: match.offsetMin,
      message: `${price.toFixed(2)} did not trade in the ${formatCt(match.statedBarTime)} CT bar. It traded at ${formatCt(match.barTime)} CT. Ask the trader.`,
    };
  }
  if (match.kind === "outside") {
    return { role, stated, price, match: "outside", message: `${price.toFixed(2)} did not trade in the ${formatCt(match.barTime)} CT bar or within 5 minutes of it. Ask the trader.` };
  }
  return { role, stated, price, match: "no-bars", message: "No candles for this time, so the fill cannot be checked." };
}

/** Each fill against the bars: the entry first, then the exit, searched from the matched entry bar onward. */
export function checkFills(record: TradeRecord, bars: readonly Candle[]): FillOut[] {
  const entryStated = iso(Date.parse(record.entry_time));
  const entryMatch = matchFill(bars, record.entry_time, record.entry_price, record.symbol, { role: "entry" });
  const fills: FillOut[] = [fillOut("entry", entryStated, record.entry_price, entryMatch)];
  if (record.exit_time != null && record.exit_price != null) {
    const notBefore = entryMatch.kind === "stated" || entryMatch.kind === "shifted" ? entryMatch.barTime : undefined;
    const exitMatch = matchFill(bars, record.exit_time, record.exit_price, record.symbol, { role: "exit", notBefore });
    fills.push(fillOut("exit", iso(Date.parse(record.exit_time)), record.exit_price, exitMatch));
  }
  return fills;
}

/**
 * Each stop move, in the order sent: its time within the hold, its price on the tick grid, and the last move equal to the
 * working stop. `rawMoves` is what the caller sent, so a malformed move is reported rather than dropped.
 */
export function checkStopMoves(record: TradeRecord, rawMoves: unknown): StopMoveOut[] {
  if (!Array.isArray(rawMoves)) return [];
  const entry = Date.parse(record.entry_time);
  const exit = record.exit_time != null ? Date.parse(record.exit_time) : null;
  return rawMoves.map((raw, index): StopMoveOut => {
    const move = isPlainObject(raw) ? raw : {};
    if (!isFiniteNumber(move.price) || typeof move.time !== "string" || !isIsoTimestamp(move.time)) {
      return { time: typeof move.time === "string" ? move.time : "", price: isFiniteNumber(move.price) ? move.price : null, ok: false, message: "Each stop move needs a numeric price and an ISO-8601 time with a zone." };
    }
    const at = Date.parse(move.time);
    const price = move.price;
    if (at < entry || (exit != null && at > exit)) {
      const bound = exit != null
        ? `between entry (${formatCt(entry)} CT) and exit (${formatCt(exit)} CT)`
        : `at or after entry (${formatCt(entry)} CT)`;
      return { time: iso(at), price, ok: false, message: `A stop move must fall ${bound}.` };
    }
    if (toTicks(price, record.symbol) == null) {
      const tick = specFor(record.symbol)?.tickSize;
      return { time: iso(at), price, ok: false, message: `${price} is off the ${tick ?? "tick"} grid for ${record.symbol}.` };
    }
    const last = index === rawMoves.length - 1;
    if (last && record.stop_loss_price != null && Math.abs(record.stop_loss_price - price) > 1e-9) {
      return { time: iso(at), price, ok: false, message: `The working stop must equal the last stop move (${price.toFixed(2)}).` };
    }
    return { time: iso(at), price, ok: true };
  });
}

/** Post-entry findings from observeTrade (the entry bar is never inside the hold, R-POST-1). Times are shown in CT. */
export function checkFindings(record: TradeRecord, bars: readonly Candle[]): FindingOut[] {
  const observed = observeTrade(deriveTrade(fromLegacy(record)), [...bars], 1);
  return observed.findings.map((finding) => ({ code: finding.code, bar_ct: formatCt(finding.barTime), price: finding.price }));
}

/** What the checks read from the owner's journal: accounts and prefs for R, and the vocabulary for the write checks. */
interface CheckVocabulary {
  accounts: TradingAccount[];
  prefs: Prefs | null;
  writeCtx: Omit<WriteCheckContext, "isCreate" | "writtenFields" | "nowMs">;
}

/** Read calls only. Playbooks fall back to the seeds, as the command layer's write checks do (lib/commands). */
async function checkVocabulary(commands: JournalCommands): Promise<{ ok: true; value: CheckVocabulary } | { ok: false }> {
  const playbooks = await commands.list("playbooks", { includeArchived: true, includeSamples: false });
  if (!playbooks.ok) return { ok: false };
  const accounts = await commands.list("accounts", { includeArchived: true, includeSamples: false });
  if (!accounts.ok) return { ok: false };
  const stored = await commands.readSingleton("prefs");
  if (!stored.ok) return { ok: false };
  const prefs = stored.value?.record ?? null;
  const seeds = playbooks.value.length > 0 ? playbooks.value : PLAYBOOK_SEEDS;
  return {
    ok: true,
    value: {
      accounts: accounts.value,
      prefs,
      writeCtx: {
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
        dayPriceRange: null,
      },
    },
  };
}

export interface TradeCheckRun {
  commands: JournalCommands;
  loader: CandleLoader;
  /** The limit key for upstream candle calls (the token id). */
  limitKey: string;
  now?: number;
}

/** Runs one check. Reads only: the commands here are read calls, and nothing is saved. */
export async function runTradeCheck(input: TradeCheckInput, run: TradeCheckRun): Promise<{ ok: true; data: TradeCheckData } | { ok: false; status: number; code: AgentErrorCode; message: string; retryAfterSec?: number }> {
  const nowMs = run.now ?? Date.now();
  if (input.kind === "invalid") return { ok: false, status: 422, code: "invalid", message: input.message };

  let record: TradeRecord;
  let rawMoves: unknown;
  let rawInput: Record<string, unknown> = {};
  if (input.kind === "stored") {
    const stored = await run.commands.read("trades", input.id);
    if (!stored.ok) return { ok: false, status: statusFor(stored.error.code), code: stored.error.code, message: stored.error.message };
    record = stored.value.record;
    rawMoves = record.stop_moves;
  } else {
    const built = draftRecord(input.body);
    if (!built.ok) return { ok: false, status: 422, code: "invalid", message: built.message };
    record = built.record;
    rawMoves = input.body.stop_moves;
    rawInput = input.body;
  }

  const entry = Date.parse(record.entry_time);
  const to = (record.exit_time != null ? Date.parse(record.exit_time) : entry) + PAD_MS;
  const from = entry - PAD_MS;
  if (to - from > RANGE_CAP_MS["1m"]) return { ok: false, status: 422, code: "invalid", message: "The trade window is longer than 26 hours. Check it in pieces." };

  const loaded = await loadAgentCandles(run.loader, { symbol: record.symbol, timeframe: "1m", from, to }, run.limitKey);
  if (!loaded.ok) return { ok: false, status: statusFor(loaded.code), code: loaded.code, message: loaded.message, retryAfterSec: loaded.retryAfterSec };
  const bars = loaded.value.bars;

  const vocabulary = await checkVocabulary(run.commands);
  if (!vocabulary.ok) return { ok: false, status: statusFor("unavailable"), code: "unavailable", message: "Could not read the vocabulary. Try again." };
  const resolved = resolveRSize(record, vocabulary.value.accounts, vocabulary.value.prefs);
  const checked = checkTradeWrite(record, rawInput, {
    ...vocabulary.value.writeCtx,
    isCreate: input.kind === "draft",
    writtenFields: new Set(Object.keys(rawInput)),
    nowMs,
  });

  return {
    ok: true,
    data: {
      fills: checkFills(record, bars),
      stop_moves: checkStopMoves(record, rawMoves),
      findings: checkFindings(record, bars),
      warnings: checked.ok ? checked.warnings : [],
      refusal: checked.ok ? null : checked.message,
      derived: {
        risk_cents: riskCents(record),
        risk_r: riskR(record, resolved),
        result_r: resultR(record, resolved),
        r_size_cents: resolved.cents,
        r_size_source: resolved.source,
        stated_risk_r: record.stated_risk_r ?? null,
      },
      window: { from: iso(from), to: iso(to), ...(loaded.value.reason ? { reason: loaded.value.reason } : {}) },
    },
  };
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------------

export interface TradeCheckRequestOptions {
  deps?: AgentServerDeps | null;
  limiter?: RateLimiter;
  loader?: CandleLoader;
  /** The commands for the owner. Omitted: the journal command layer over the owner's Supabase client (read calls only). */
  commandsFor?: (ctx: { userId: string; db: SupabaseLike }) => JournalCommands;
  now?: number;
}

const generalLimiter = createRateLimiter({ limit: 120, windowMs: MINUTE_MS });

function respond(response: AgentResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store" },
  });
}

/** A JSON object body, at most the agent body limit. Malformed or oversized bodies are 422 (the check's own contract). */
async function readCheckBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > AGENT_BODY_LIMIT_BYTES) return { ok: false, message: "The request body is larger than 256 KB." };
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > AGENT_BODY_LIMIT_BYTES) return { ok: false, message: "The request body is larger than 256 KB." };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Body must be a JSON object: a draft trade, or { \"id\": \"…\" }." };
  }
}

/** Runs one POST /api/v1/checks/trade request. Read scope; nothing is written. */
export async function handleTradeCheckRequest(req: Request, options: TradeCheckRequestOptions = {}): Promise<Response> {
  const deps = options.deps === undefined ? defaultAgentDeps() : options.deps;
  if (!deps || !agentEnabled(deps.env)) {
    return respond(agentError("unavailable", "The agent API is off on this deployment."));
  }
  const url = new URL(req.url);
  const path = url.pathname.slice(0, 300);
  try {
    // This route is read scope although it is a POST (docs/07 §5). The shared auth maps the method to a scope, so it sees
    // a GET-shaped copy of this request: same URL and headers, nothing else changed. The body is read below, after auth.
    const readView = new Request(req.url, { method: "GET", headers: req.headers });
    const auth = await authenticateAgent(readView, deps, options.limiter ?? generalLimiter);
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method: "POST", path, status: auth.status, outcome: auth.code });
      return respond(auth);
    }
    const ctx = auth.ctx;
    const audit = (status: number, outcome: string) => recordAgentUse(deps, ctx, { method: "POST", path, status, outcome });

    const body = await readCheckBody(req);
    if (!body.ok) {
      await audit(422, "invalid");
      return respond(agentError("invalid", body.message));
    }
    const input = parseCheckInput(body.body);
    const commands = options.commandsFor
      ? options.commandsFor(ctx)
      : createJournalCommands(createSupabaseAdapter({ client: ctx.db, candles: createMemoryCandleStore() }).repositories, ctx.userId);
    const result = await runTradeCheck(input, {
      commands,
      loader: options.loader ?? defaultCandleLoader(),
      limitKey: ctx.tokenId,
      now: options.now,
    });
    if (!result.ok) {
      await audit(result.status, result.code);
      return respond(agentError(result.code, result.message, result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : {}));
    }
    await audit(200, "ok");
    return respond(agentOk(result.data));
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}

