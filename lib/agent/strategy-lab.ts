// #SL-14: the read-only Strategy Lab endpoints for agents (docs/design-2026-11-24/09 §4.5, 07-agent-api §3).
// GET /api/v1/strategy-lab/skills lists the registered skills (metadata only, no bars). POST /api/v1/strategy-lab/context
// returns the Context Card for one MES mark. Both are read scope; the POST is read scope too, as /checks/trade is, because
// it writes nothing. Every number is computed here by the code: the caller is never asked to compute one. Candles come only
// through lib/agent/candles.ts (Invariant 6). Nothing is stored. R is the account's fixed R size (D-A), never a stop width.
import { canonicalSymbol } from "../trades.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import { createMemoryCandleStore } from "../persistence/local-adapter.ts";
import { equityIndexSessionBounds, previousRegularSessionDate, sessionDate } from "../session.ts";
import { sanitizePrefs } from "../prefs-sanitize.ts";
import { labRSize } from "../strategy-lab/r.ts";
import { buildContextCard, deriveCardState } from "../strategy-lab/context-card.ts";
import type { CardGroup, CardMark, CardRSize, CardSide, CardState } from "../strategy-lab/context-card.ts";
import { etParts } from "../strategy-lab/et-clock.ts";
import { buildBarSeries } from "../strategy-lab/series.ts";
import { listSkills } from "../strategy-lab/registry.ts";
import type { SourceBar } from "../strategy-lab/types.ts";
import { agentError, agentOk, createRateLimiter, isIsoTimestamp, statusFor } from "./http.ts";
import type { AgentErrorCode, AgentResponse, RateLimiter } from "./http.ts";
import { agentEnabled, authenticateAgent, defaultAgentDeps, recordAgentUse } from "./server-auth.ts";
import type { AgentAuth, AgentServerDeps } from "./server-auth.ts";
import { defaultCandleLoader, loadAgentCandles } from "./candles.ts";
import type { CandleLoader } from "./candles.ts";

const MINUTE_MS = 60_000;
/** The Strategy Lab's MVP symbol (docs/09 §5.1). */
export const CONTEXT_SYMBOL = "MES";
/** Sessions the card reads, the same count the Mark screen uses (StrategyLabMark). */
export const CONTEXT_SESSIONS = 12;
/** MES tick size: a mark's price must sit on this grid. */
const MES_TICK = 0.25;
/** Request bodies above this are refused before parsing: a mark is a few hundred bytes. */
const CONTEXT_BODY_LIMIT_CHARS = 4096;
/** Per key, per instance (best effort), as the other v1 routes. */
const generalLimiter = createRateLimiter({ limit: 120, windowMs: MINUTE_MS });

export const CONTEXT_NOTICE = "Every number in this card is computed by MogMine's code from 1m bars. Quote it as given; do not recompute or estimate it.";

export interface AgentContextInput {
  /** The mark's minute, UTC ms (seconds floored). The decision bar is the one that closed at this minute. */
  timeMs: number;
  price: number;
  side: CardSide;
  accountId: string | null;
}

export type ContextParse = { ok: true; value: AgentContextInput } | { ok: false; message: string };

/** Validates the POST body: { symbol: "MES", time, price, side, account_id? }. `time` must name its zone and not be in the future. */
export function parseContextBody(body: unknown, nowMs: number): ContextParse {
  const fail = (message: string): ContextParse => ({ ok: false, message });
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Body must be a JSON object: { symbol, time, price, side }.");
  const raw = body as Record<string, unknown>;
  if (canonicalSymbol(typeof raw.symbol === "string" ? raw.symbol : "") !== CONTEXT_SYMBOL) return fail("symbol must be MES (the Strategy Lab's MVP symbol).");
  if (typeof raw.time !== "string" || !isIsoTimestamp(raw.time)) {
    return fail("time must be an ISO-8601 time with a zone, for example 2026-11-25T13:12:00Z.");
  }
  const timeMs = Math.floor(Date.parse(raw.time) / MINUTE_MS) * MINUTE_MS;
  if (timeMs > nowMs) return fail("time must not be in the future.");
  const price = raw.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return fail("price must be a positive number.");
  if (Math.abs(price / MES_TICK - Math.round(price / MES_TICK)) > 1e-9) return fail("price must be on the MES tick grid (a multiple of 0.25).");
  const side = raw.side;
  if (side !== "long" && side !== "short") return fail('side must be "long" or "short".');
  const accountId = raw.account_id;
  if (accountId !== undefined && accountId !== null && typeof accountId !== "string") return fail("account_id must be a string or null.");
  return { ok: true, value: { timeMs, price, side, accountId: typeof accountId === "string" ? accountId : null } };
}

/** The last `count` regular sessions ending at `endDate` (inclusive), oldest first. Same rule as the Mark screen. */
export function recentSessions(endDate: string, count: number): string[] {
  const dates = [endDate];
  while (dates.length < Math.max(1, Math.floor(count))) dates.unshift(previousRegularSessionDate(dates[0]));
  return dates;
}

export interface AgentContextPayload {
  symbol: typeof CONTEXT_SYMBOL;
  mark: { time: string; session_date: string; price: number; side: CardSide };
  state: CardState;
  card: {
    header: string;
    basis: string;
    data_line: string;
    /** The UTC instant the decision bar closed (the mark's minute), or null when no bar closes there. */
    decision_time: string | null;
    groups: CardGroup[];
    missing: string[];
    skipped_rows: number;
    excluded_sessions: number;
  };
  provenance: {
    provider: string;
    timeframe: "1m";
    sessions_requested: number;
    sessions_used: number;
    excluded_dates: string[];
    r_size: { usd: number; source: "account" | "default"; account: string | null };
    as_of: string;
    notice: string;
  };
}

export type ContextBuild =
  | { ok: true; value: AgentContextPayload }
  | { ok: false; code: AgentErrorCode; message: string; retryAfterSec?: number };

export interface ContextDeps {
  commands: JournalCommands;
  loader: CandleLoader;
  /** The rate-limit key for upstream candle calls (the agent key's id). */
  limitKey: string;
  nowMs: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Context Card for one mark. Loads the mark's session and the 11 before it through the shared candle loader, drops bars
 * that have not closed by `nowMs`, builds the 1m series once, and runs the card model (context-card.ts). A failed upstream
 * window is returned as an error, never as a silently partial card. A session with no bars (a holiday, a weekend) is excluded
 * and counted.
 */
export async function buildAgentContext(input: AgentContextInput, deps: ContextDeps): Promise<ContextBuild> {
  const parts = etParts(input.timeMs);
  const mark: CardMark = {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    minuteOfDay: parts.hour * 60 + parts.minute,
    price: input.price,
    side: input.side,
  };
  const bars: SourceBar[] = [];
  const excluded: string[] = [];
  const dates = recentSessions(sessionDate(input.timeMs), CONTEXT_SESSIONS);
  for (const day of dates) {
    const bounds = equityIndexSessionBounds(day);
    const load = await loadAgentCandles(deps.loader, { symbol: CONTEXT_SYMBOL, timeframe: "1m", from: bounds.open, to: bounds.close }, deps.limitKey);
    if (!load.ok) {
      return { ok: false, code: load.code, message: load.message, ...(load.retryAfterSec ? { retryAfterSec: load.retryAfterSec } : {}) };
    }
    // A bar is known only once its one-minute span has ended (the B-14 cutoff, as /api/v1/levels).
    const closed = load.value.bars.filter((bar) => bar.time + MINUTE_MS <= deps.nowMs);
    if (closed.length === 0) excluded.push(day);
    for (const bar of closed) {
      bars.push({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    }
  }

  const accounts = await deps.commands.list("accounts", { includeArchived: true, includeSamples: false });
  if (!accounts.ok) return { ok: false, code: accounts.error.code, message: accounts.error.message };
  const stored = await deps.commands.readSingleton("prefs");
  if (!stored.ok) return { ok: false, code: stored.error.code, message: stored.error.message };
  const prefs = sanitizePrefs(stored.value?.record ?? null);

  const account = input.accountId === null ? null : accounts.value.find((item) => item.id === input.accountId) ?? null;
  if (input.accountId !== null && account === null) return { ok: false, code: "invalid", message: "account_id is not one of your accounts." };
  const rSize = labRSize(account?.id ?? null, accounts.value.map((item) => ({ id: item.id, r_size_cents: item.r_size_cents })), prefs);
  const cardRSize: CardRSize = { usd: rSize.usd, source: rSize.source, accountName: account?.name ?? null };

  const series = buildBarSeries(CONTEXT_SYMBOL, bars);
  // Shield is a sharing/presentation preference. The authenticated agent API returns computed truth;
  // it must not silently remove dollar facts from the data contract.
  const card = buildContextCard(series, mark, { rSize: cardRSize, shield: false, excludedSessions: excluded.length });
  const sessionsUsed = dates.length - excluded.length;
  return {
    ok: true,
    value: {
      symbol: CONTEXT_SYMBOL,
      mark: { time: new Date(input.timeMs).toISOString(), session_date: mark.date, price: mark.price, side: mark.side },
      state: deriveCardState({ loading: false, error: null, offline: false, card }),
      card: {
        header: card.header,
        basis: card.basis,
        data_line: card.dataLine,
        decision_time: card.decisionTime === null ? null : new Date(card.decisionTime).toISOString(),
        groups: card.groups,
        missing: card.missing,
        skipped_rows: card.skippedRows,
        excluded_sessions: card.excludedSessions,
      },
      provenance: {
        provider: deps.loader.provider.name,
        timeframe: "1m",
        sessions_requested: dates.length,
        sessions_used: sessionsUsed,
        excluded_dates: excluded,
        r_size: { usd: rSize.usd, source: rSize.source, account: account?.name ?? null },
        as_of: new Date(deps.nowMs).toISOString(),
        notice: CONTEXT_NOTICE,
      },
    },
  };
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------------

export interface StrategyLabRequestOptions {
  /** Tests inject fakes. `null` means the API is off. Omitted: the real clients from the environment. */
  deps?: AgentServerDeps | null;
  limiter?: RateLimiter;
  /** The shared candle loader. Omitted: the server's loader. */
  loader?: CandleLoader;
  /** Tests inject a command layer. Omitted: the owner's journal, read through the Supabase adapter. */
  commands?: JournalCommands;
  now?: () => number;
}

function respond(response: AgentResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store" },
  });
}

type GateCtx = Extract<AgentAuth, { ok: true }>["ctx"];

interface Gate {
  deps: AgentServerDeps;
  ctx: GateCtx;
  audit: (status: number, outcome: string) => Promise<void>;
}

/**
 * Off switch, then auth with read scope. A POST is authenticated as a GET-shaped copy of the request (same URL and headers),
 * so it needs only read scope, as /checks/trade does. Failed auth is audited when the key is known, then returned.
 */
async function gate(req: Request, method: "GET" | "POST", options: StrategyLabRequestOptions): Promise<{ ok: true; gate: Gate } | { ok: false; response: Response }> {
  const deps = options.deps === undefined ? defaultAgentDeps() : options.deps;
  if (!deps || !agentEnabled(deps.env)) {
    return { ok: false, response: respond(agentError("unavailable", "The agent API is off on this deployment.")) };
  }
  const path = new URL(req.url).pathname.slice(0, 300);
  const readView = method === "GET" ? req : new Request(req.url, { method: "GET", headers: req.headers });
  const auth = await authenticateAgent(readView, deps, options.limiter ?? generalLimiter);
  if (!auth.ok) {
    if (auth.identity) await recordAgentUse(deps, auth.identity, { method, path, status: auth.status, outcome: auth.code });
    return { ok: false, response: respond(auth) };
  }
  const audit = (status: number, outcome: string) => recordAgentUse(deps, auth.ctx, { method, path, status, outcome });
  return { ok: true, gate: { deps, ctx: auth.ctx, audit } };
}

/** GET /api/v1/strategy-lab/skills (read scope): the registry's metadata. No bars are read. */
export async function handleSkillsRequest(req: Request, options: StrategyLabRequestOptions = {}): Promise<Response> {
  try {
    const opened = await gate(req, "GET", options);
    if (!opened.ok) return opened.response;
    await opened.gate.audit(200, "ok");
    return respond(agentOk({ skills: listSkills() }));
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}

/** POST /api/v1/strategy-lab/context (read scope; nothing is written). Body: { symbol, time, price, side, account_id? }. */
export async function handleContextRequest(req: Request, options: StrategyLabRequestOptions = {}): Promise<Response> {
  try {
    const opened = await gate(req, "POST", options);
    if (!opened.ok) return opened.response;
    const { ctx, audit } = opened.gate;
    const now = options.now ?? (() => Date.now());

    const text = await req.text();
    if (text.length > CONTEXT_BODY_LIMIT_CHARS) {
      await audit(422, "invalid");
      return respond(agentError("invalid", "The body is too large for a mark."));
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      await audit(422, "invalid");
      return respond(agentError("invalid", "Body must be a JSON object: { symbol, time, price, side }."));
    }
    const parsed = parseContextBody(body, now());
    if (!parsed.ok) {
      await audit(422, "invalid");
      return respond(agentError("invalid", parsed.message));
    }

    const commands = options.commands ?? createJournalCommands(
      createSupabaseAdapter({ client: ctx.db, candles: createMemoryCandleStore() }).repositories,
      ctx.userId,
    );
    const built = await buildAgentContext(parsed.value, {
      commands,
      loader: options.loader ?? defaultCandleLoader(),
      limitKey: ctx.tokenId,
      nowMs: now(),
    });
    if (!built.ok) {
      await audit(statusFor(built.code), built.code);
      return respond(agentError(built.code, built.message, built.retryAfterSec ? { "Retry-After": String(built.retryAfterSec) } : {}));
    }
    await audit(200, "ok");
    return respond(agentOk(built.value));
  } catch {
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}
