// #API-4: GET /api/v1/levels (docs/design-2026-11-24/07-agent-api.md §3.4, B-14). Read scope. Point-in-time session levels
// (LV-1, with withheld reasons), the owner's planned levels as they stood at `as_of`, and Session VWAP (RTH strict, Globex
// `globex-tolerant`, D-F). Everything is computed on read from 1m bars (Invariant 6: through lib/agent/candles.ts only).
// Nothing is stored: no levels_at_entry snapshot on trades (Q-8). A bar counts only once it has closed by `as_of`.
import { canonicalSymbol, specFor } from "../trades.ts";
import type { Candle } from "../trades.ts";
import { computeLevelsFromInputs, extractSessionInputsFromCandles, levelLabel } from "../levels.ts";
import type { ComputedLevelType } from "../levels.ts";
import { missingCandleLevels } from "../chart-levels.ts";
import { withheldReasons } from "../level-withheld.ts";
import type { LevelCoverage, WithheldLevel } from "../level-withheld.ts";
import { computeSessionIndicators } from "../session-indicators.ts";
import { EMA_CALC_VERSION, computeEma200 } from "../ema.ts";
import type { GapPolicy } from "../session-indicators.ts";
import { planStateAsOf } from "../plans.ts";
import type { PlanningSession } from "../plans.ts";
import { equityIndexSessionBounds, previousRegularSessionDate } from "../session.ts";
import type { JournalCommands } from "../commands/journal-commands.ts";
import type { PersistResult } from "../persistence/contract.ts";
import { createSupabaseAdapter } from "../persistence/supabase-adapter.ts";
import { createMemoryCandleStore } from "../persistence/local-adapter.ts";
import { createJournalCommands } from "../commands/journal-commands.ts";
import { agentError, agentOk, createRateLimiter, isIsoTimestamp, isSessionDate, statusFor } from "./http.ts";
import type { AgentResponse, RateLimiter } from "./http.ts";
import { agentEnabled, authenticateAgent, defaultAgentDeps, recordAgentUse } from "./server-auth.ts";
import type { AgentServerDeps } from "./server-auth.ts";
import { defaultCandleLoader, loadAgentCandles } from "./candles.ts";
import type { CandleLoad, CandleLoader } from "./candles.ts";

const MINUTE_MS = 60_000;
/** LV-1 levels calculation version (docs/12 §3A), reported in provenance. */
export const LEVELS_CALC_VERSION = "lv-1";
/** Session VWAP calculation version (session-indicators.ts), reported in provenance. */
export const INDICATORS_CALC_VERSION = "session-indicators-v1";
/** The instruments LV-1 computes levels for (Invariant 3: MES reads MES=F through the provider). */
export const LEVEL_SYMBOLS = ["MES", "MNQ"] as const;
export type LevelSymbol = (typeof LEVEL_SYMBOLS)[number];

export interface AgentLevelsQuery {
  symbol: string; // MES or MNQ
  sessionDate: string; // YYYY-MM-DD
  asOfIso?: string; // defaults to the clock
}

/** The injected candle source. Returns cleaned 1m bars for [fromMs, toMs) and the provider name. */
export type LevelsCandleSource = (symbol: string, fromMs: number, toMs: number, tf: "1m") => Promise<{ bars: Candle[]; provider: string }>;

export interface ComputedLevelOut {
  key: ComputedLevelType;
  label: string;
  value: number;
  formed_at: string | null;
  coverage: WindowCoverageOut;
}

export interface WindowCoverageOut {
  window: "prior session" | "prior RTH" | "overnight" | "week";
  expected_bars: number;
  present_bars: number;
  complete: boolean;
}

export interface WithheldLevelOut {
  key: ComputedLevelType;
  label: string;
  reason: WithheldLevel["reason"];
  window: WithheldLevel["window"];
  missing_bars: number;
}

export interface PlannedLevelOut {
  plan_id: string;
  plan_name: string;
  /** The revision whose snapshot holds these levels at `as_of`. Null when the plan's current levels were already in force. */
  revision_id: string | null;
  label: string;
  price: number;
  /** `level`, or one edge of a zone (`zone_low` / `zone_high`). Each edge is its own entry. */
  role: "level" | "zone_low" | "zone_high";
}

export interface VwapOut {
  value: number | null;
  approximate: boolean;
  unavailable_reason: "not-yet" | "gaps" | null;
  coverage: { expected_bars: number; present_bars: number; missing_bars: number; longest_gap_min: number; complete: boolean } | null;
}

export interface AgentLevelsPayload {
  symbol: LevelSymbol;
  session_date: string;
  as_of: string;
  computed: ComputedLevelOut[];
  withheld: WithheldLevelOut[];
  /** Today's RTH extremes up to `as_of`. Not an LV-1 level (LV-1 reads the prior RTH); it shows the cutoff at work. */
  session_so_far: { rth_high: { price: number; formed_at: string } | null; rth_low: { price: number; formed_at: string } | null };
  planned: PlannedLevelOut[];
  vwap: { rth: VwapOut; globex: VwapOut };
  /** IN-3: the 200 EMA on 1m closes at `as_of` (the last bar that had closed by then). Null value when warm-up is short. */
  ema200: Ema200Out;
  provenance: {
    provider: string;
    timeframe: "1m";
    levels_calc_version: typeof LEVELS_CALC_VERSION;
    indicators_calc_version: typeof INDICATORS_CALC_VERSION;
    as_of: string;
    session_date: string;
  };
}

export interface Ema200Out {
  value: number | null;
  approximate: boolean;
  timeframe: "1m";
  calc_version: typeof EMA_CALC_VERSION;
  unavailable_reason: string | null;
}

export function isLevelSymbol(value: string | null): value is LevelSymbol {
  return value !== null && (LEVEL_SYMBOLS as readonly string[]).includes(value);
}

/** The window each computed level reads, and which coverage record says so. Week levels sum the week's days. */
function windowCoverage(key: ComputedLevelType, coverage: LevelCoverage): WindowCoverageOut {
  const single = (window: WindowCoverageOut["window"], cov: { expectedBars: number; presentBars: number; complete: boolean }) => ({
    window, expected_bars: cov.expectedBars, present_bars: cov.presentBars, complete: cov.complete,
  });
  if (key === "pdh" || key === "pdl" || key === "pdc") return single("prior session", coverage.previous);
  if (key.startsWith("rth_")) return single("prior RTH", coverage.rth);
  if (key === "globex_open" || key === "onh" || key === "onl") return single("overnight", coverage.overnight);
  const days = coverage.week;
  return {
    window: "week",
    expected_bars: days.reduce((sum, day) => sum + day.expectedBars, 0),
    present_bars: days.reduce((sum, day) => sum + day.presentBars, 0),
    complete: days.every((day) => day.complete),
  };
}

/** The first revision saved after `asOf`: the one whose snapshot holds the levels in force at `asOf` (see planStateAsOf). */
function revisionHolding(plan: PlanningSession, asOf: number) {
  return [...plan.revisions]
    .filter((revision) => Date.parse(revision.saved_at) > asOf)
    .sort((a, b) => Date.parse(a.saved_at) - Date.parse(b.saved_at))[0] ?? null;
}

function plannedAsOf(plans: readonly PlanningSession[], symbol: LevelSymbol, sessionDate: string, asOf: number): PlannedLevelOut[] {
  return plans
    .filter((plan) => !plan.archived && plan.symbol === symbol && plan.session_date === sessionDate)
    .flatMap((plan) => {
      const state = planStateAsOf(plan, asOf);
      if (!state) return [];
      const revision = revisionHolding(plan, asOf);
      return state.levels.map((level) => ({
        plan_id: plan.id,
        plan_name: plan.name,
        revision_id: revision?.id ?? null,
        label: level.label,
        price: level.price,
        role: level.kind,
      }));
    });
}

/** Extremes of the bars in a window, first occurrence on a tie. Null for no bars. */
function extremeOf(bars: readonly Candle[]) {
  const first = bars[0];
  if (!first) return { high: null, low: null };
  const high = bars.reduce((best, bar) => (bar.high > best.high ? bar : best), first);
  const low = bars.reduce((best, bar) => (bar.low < best.low ? bar : best), first);
  const at = (bar: Candle) => new Date(bar.time).toISOString();
  return { high: { price: high.high, formed_at: at(high) }, low: { price: low.low, formed_at: at(low) } };
}

/**
 * Levels, planned levels and Session VWAP for one MES or MNQ session as of one instant. Pure over the injected candle source
 * and command layer. A failure of `loadCandles` is thrown, not returned, so the HTTP layer can map it (see handleLevelsRequest).
 */
export async function buildAgentLevels(
  query: AgentLevelsQuery,
  commands: JournalCommands,
  loadCandles: LevelsCandleSource,
  nowMs?: number,
): Promise<PersistResult<AgentLevelsPayload>> {
  const invalid = (message: string): PersistResult<never> => ({ ok: false, error: { code: "invalid", message } });
  const symbol = canonicalSymbol(query.symbol);
  if (!isLevelSymbol(symbol)) return invalid("symbol must be MES or MNQ.");
  if (!isSessionDate(query.sessionDate)) return invalid("session_date must be a real date, YYYY-MM-DD.");
  if (query.asOfIso !== undefined && !isIsoTimestamp(query.asOfIso)) {
    return invalid("as_of must be an ISO-8601 time with a zone, for example 2026-11-25T15:30:00Z.");
  }
  // B-14: the cutoff. Only a bar whose one-minute span has ended by this instant is known.
  const asOfMs = query.asOfIso !== undefined ? Date.parse(query.asOfIso) : (nowMs ?? Date.now());
  if (!Number.isFinite(asOfMs)) return invalid("as_of must be an ISO-8601 time with a zone, for example 2026-11-25T15:30:00Z.");

  const spec = specFor(symbol);
  const { sessionDate } = query;
  const today = equityIndexSessionBounds(sessionDate);
  const prior = equityIndexSessionBounds(previousRegularSessionDate(sessionDate));
  // The session cannot be read past its own close, so the window ends at the earlier of the two.
  const cutoff = Math.min(asOfMs, today.close);

  // Two windows, each under the 26-hour cap: the prior session, and today from its open to the cutoff.
  const priorLoad = await loadCandles(symbol, prior.open, prior.close, "1m");
  const todayLoad = asOfMs > today.open ? await loadCandles(symbol, today.open, cutoff, "1m") : null;
  const provider = priorLoad.provider;
  const bars = [...priorLoad.bars, ...(todayLoad?.bars ?? [])].filter((bar) => bar.time + MINUTE_MS <= asOfMs);

  const extracted = extractSessionInputsFromCandles({
    symbol, provider, providerSymbol: spec?.yahooTicker ?? "", sessionDate, candles: bars, timeframe: "1m", asOf: asOfMs,
  });
  const levels = computeLevelsFromInputs({ symbol, sessionDate, inputs: extracted.inputs });
  const withheld = withheldReasons(missingCandleLevels(levels), extracted.coverage, "1m");

  const rthBars = bars.filter((bar) => bar.time >= today.rthOpen && bar.time < today.rthClose);
  const rthExtremes = extremeOf(rthBars);

  // Session VWAP. Before today's open there is no session to read, and the indicators would name the wrong session.
  const vwap = (anchor: "rth" | "globex", gapPolicy: GapPolicy): VwapOut => {
    if (asOfMs < today.open) return { value: null, approximate: false, unavailable_reason: "not-yet", coverage: null };
    const result = computeSessionIndicators(bars, { symbol, timeframe: "1m", asOf: cutoff, anchor, gapPolicy });
    if (!result) return { value: null, approximate: false, unavailable_reason: "gaps", coverage: null };
    const cov = result.coverage.anchored;
    const value = result.vwap.at(-1)?.value ?? null;
    return {
      value,
      approximate: value !== null && cov.approximate,
      unavailable_reason: value !== null ? null : cov.expectedBars === 0 ? "not-yet" : "gaps",
      coverage: {
        expected_bars: cov.expectedBars,
        present_bars: cov.presentBars,
        missing_bars: cov.missingBars,
        longest_gap_min: cov.longestGapMin,
        complete: cov.complete,
      },
    };
  };

  // IN-3: the EMA reads the same bars as above, so it is cut at `as_of` as well.
  const ema = computeEma200(bars, "1m");
  const ema200: Ema200Out = {
    value: ema.points.at(-1)?.value ?? null,
    approximate: ema.approximate,
    timeframe: "1m",
    calc_version: EMA_CALC_VERSION,
    unavailable_reason: ema.unavailableReason,
  };

  const plans = await commands.listFiltered("plans", undefined, { session_date: sessionDate });
  if (!plans.ok) return plans;

  return {
    ok: true,
    value: {
      symbol,
      session_date: sessionDate,
      as_of: new Date(asOfMs).toISOString(),
      computed: levels.map((level) => ({
        key: level.key,
        label: levelLabel(level.key),
        value: level.price,
        formed_at: level.formed_at ?? null,
        coverage: windowCoverage(level.key, extracted.coverage),
      })),
      withheld: withheld.map((item) => ({
        key: item.key,
        label: levelLabel(item.key),
        reason: item.reason,
        window: item.window,
        missing_bars: item.missingBars,
      })),
      session_so_far: {
        rth_high: rthExtremes.high,
        rth_low: rthExtremes.low,
      },
      planned: plannedAsOf(plans.value, symbol, sessionDate, asOfMs),
      vwap: {
        rth: vwap("rth", "complete"),
        globex: vwap("globex", "globex-tolerant"),
      },
      ema200,
      provenance: {
        provider,
        timeframe: "1m",
        levels_calc_version: LEVELS_CALC_VERSION,
        indicators_calc_version: INDICATORS_CALC_VERSION,
        as_of: new Date(asOfMs).toISOString(),
        session_date: sessionDate,
      },
    },
  };
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------------

export interface LevelsQueryParse {
  ok: boolean;
  message?: string;
  query?: AgentLevelsQuery & { symbol: LevelSymbol };
}

/** Validates `symbol` (MES or MNQ), `session_date` (a real date) and an optional `as_of` (ISO with a zone, not in the future). */
export function parseLevelsQuery(params: URLSearchParams, nowMs: number = Date.now()): LevelsQueryParse {
  const symbol = canonicalSymbol(params.get("symbol") ?? "");
  if (!isLevelSymbol(symbol)) return { ok: false, message: "symbol must be MES or MNQ." };
  const sessionDateText = params.get("session_date") ?? "";
  if (!isSessionDate(sessionDateText)) return { ok: false, message: "session_date must be a real date, YYYY-MM-DD." };
  const asOf = params.get("as_of");
  if (asOf !== null) {
    if (!isIsoTimestamp(asOf)) return { ok: false, message: "as_of must be an ISO-8601 time with a zone, for example 2026-11-25T15:30:00Z." };
    if (Date.parse(asOf) > nowMs) return { ok: false, message: "as_of must not be in the future." };
  }
  return { ok: true, query: { symbol, sessionDate: sessionDateText, ...(asOf !== null ? { asOfIso: asOf } : {}) } };
}

export interface LevelsRequestOptions {
  /** Tests inject fakes. `null` means the API is off. Omitted: the real clients from the environment. */
  deps?: AgentServerDeps | null;
  limiter?: RateLimiter;
  /** The shared candle loader (API-3's LRU and upstream limit). Omitted: the server's loader. */
  loader?: CandleLoader;
  /** Tests inject a command layer. Omitted: the owner's real journal, read through the Supabase adapter. */
  commands?: JournalCommands;
  now?: () => number;
}

/** Per key, per instance (best effort). Separate from the candles limiter, as in lib/agent/candles.ts. */
const generalLimiter = createRateLimiter({ limit: 120, windowMs: MINUTE_MS });

/** A candle window the loader could not serve. The HTTP layer maps `code` to a status (429 or 503). */
class LevelsLoadFailure extends Error {
  readonly failure: Extract<CandleLoad, { ok: false }>;
  constructor(failure: Extract<CandleLoad, { ok: false }>) {
    super(failure.message);
    this.failure = failure;
  }
}

function respond(response: AgentResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store" },
  });
}

/** Runs one GET /api/v1/levels request: off switch, auth (read scope), query, compute, audit. */
export async function handleLevelsRequest(req: Request, options: LevelsRequestOptions = {}): Promise<Response> {
  const deps = options.deps === undefined ? defaultAgentDeps() : options.deps;
  if (!deps || !agentEnabled(deps.env)) {
    return respond(agentError("unavailable", "The agent API is off on this deployment."));
  }
  const url = new URL(req.url);
  const path = url.pathname.slice(0, 300);
  const now = options.now ?? (() => Date.now());
  try {
    const auth = await authenticateAgent(req, deps, options.limiter ?? generalLimiter);
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method: "GET", path, status: auth.status, outcome: auth.code });
      return respond(auth);
    }
    const ctx = auth.ctx;
    const audit = (status: number, outcome: string) => recordAgentUse(deps, ctx, { method: "GET", path, status, outcome });

    const parsed = parseLevelsQuery(url.searchParams, now());
    if (!parsed.ok || !parsed.query) {
      await audit(422, "invalid");
      return respond(agentError("invalid", parsed.message ?? "Invalid query."));
    }

    const loader = options.loader ?? defaultCandleLoader();
    const commands = options.commands ?? createJournalCommands(
      createSupabaseAdapter({ client: ctx.db, candles: createMemoryCandleStore() }).repositories,
      ctx.userId,
    );
    const candleSource: LevelsCandleSource = async (symbol, fromMs, toMs, tf) => {
      const loaded = await loadAgentCandles(loader, { symbol, timeframe: tf, from: fromMs, to: toMs }, ctx.tokenId);
      if (!loaded.ok) throw new LevelsLoadFailure(loaded);
      return { bars: loaded.value.bars, provider: loaded.value.provider };
    };

    let result: PersistResult<AgentLevelsPayload>;
    try {
      result = await buildAgentLevels(parsed.query, commands, candleSource, now());
    } catch (error) {
      if (!(error instanceof LevelsLoadFailure)) throw error;
      const { code, message, retryAfterSec } = error.failure;
      await audit(statusFor(code), code);
      return respond(agentError(code, message, retryAfterSec ? { "Retry-After": String(retryAfterSec) } : {}));
    }
    if (!result.ok) {
      await audit(statusFor(result.error.code), result.error.code);
      return respond(agentError(result.error.code, result.error.message));
    }
    await audit(200, "ok");
    return respond(agentOk(result.value));
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}

