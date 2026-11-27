// #API-3: GET /api/v1/candles (docs/design-2026-11-24/07-agent-api.md §3.2, §5). Read scope. Cleaned 1m/5m/15m bars with
// Central Time labels, fetched only through MarketDataProvider (Invariant 6). Nothing is written to any store: the cache is
// an in-memory LRU per instance, and the response is the cleaned window plus its coverage.
import { canonicalSymbol, expectedInsideBarTimes, TIMEFRAME_MINUTES } from "../trades.ts";
import type { Candle } from "../trades.ts";
import type { MarketDataProvider } from "../market-data/types.ts";
import { YahooFinanceProvider } from "../market-data/yahoo.ts";
import { mergeArchiveAndYahoo, readArchiveCandles } from "../market-data/archive.ts";
import type { ArchiveQuery, ArchiveResult } from "../market-data/archive.ts";
import { windowInFuture } from "../market-data/outcome.ts";
import { agentError, agentOk, createRateLimiter, isIsoTimestamp, statusFor } from "./http.ts";
import type { AgentResponse, RateLimiter } from "./http.ts";
import { agentEnabled, authenticateAgent, defaultAgentDeps, recordAgentUse } from "./server-auth.ts";
import type { AgentServerDeps } from "./server-auth.ts";

export const CANDLE_TIMEFRAMES = ["1m", "5m", "15m"] as const;
export type CandleTimeframe = (typeof CANDLE_TIMEFRAMES)[number];

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Longest window per timeframe (§3.2): 26 hours of 1m, 7 days of 5m and 15m. */
export const RANGE_CAP_MS: Record<CandleTimeframe, number> = { "1m": 26 * HOUR_MS, "5m": 7 * DAY_MS, "15m": 7 * DAY_MS };
/** A window that ends after `now` is still forming: its bars are cached for one minute only. */
export const RECENT_TTL_MS = MINUTE_MS;
/** A window that ended by `now` is closed: its bars are cached for ten minutes. */
export const CLOSED_TTL_MS = 10 * MINUTE_MS;
/** Upstream Yahoo calls per token per minute. Cache hits do not count. */
export const UPSTREAM_LIMIT = { limit: 15, windowMs: MINUTE_MS } as const;
export const CACHE_MAX_ENTRIES = 64;

export interface CandleQuery {
  /** Canonical symbol, e.g. `MES`. The provider maps it to its own ticker (`MES=F`). */
  symbol: string;
  timeframe: CandleTimeframe;
  /** UTC ms, inclusive. */
  from: number;
  /** UTC ms, exclusive. */
  to: number;
}

export interface CandleGap {
  /** ISO time of the first missing expected bar. */
  from: string;
  /** ISO time of the last missing expected bar in the run. */
  to: string;
  bars: number;
}

export interface AgentCandleSet {
  symbol: string;
  ticker: string;
  timeframe: CandleTimeframe;
  provider: string;
  from: number;
  to: number;
  /** `closed`: no regular trading time in the window (a weekend). `future`: the window has not started. */
  reason?: "closed" | "future";
  bars: Candle[];
  coverage: { expected: number; present: number; gaps: CandleGap[] };
}

export type CandleLoad =
  | { ok: true; value: AgentCandleSet }
  | { ok: false; code: "rate_limited" | "unavailable"; message: string; retryAfterSec?: number };

export type CandleQueryParse = { ok: true; query: CandleQuery } | { ok: false; message: string };

// ---- query --------------------------------------------------------------------------------------------------------------

function isCandleTimeframe(value: string): value is CandleTimeframe {
  return (CANDLE_TIMEFRAMES as readonly string[]).includes(value);
}

/** Validates `symbol`, `timeframe`, `from` and `to` (UTC ISO, from < to, within the range cap). Every failure is a 422. */
export function parseCandleQuery(params: URLSearchParams): CandleQueryParse {
  const symbol = canonicalSymbol(params.get("symbol") ?? "");
  if (!symbol) return { ok: false, message: "symbol must be a supported contract, for example MES or MNQ." };
  const timeframe = params.get("timeframe") ?? "1m";
  if (!isCandleTimeframe(timeframe)) return { ok: false, message: 'timeframe must be "1m", "5m" or "15m".' };
  const fromText = params.get("from") ?? "";
  const toText = params.get("to") ?? "";
  if (!isIsoTimestamp(fromText) || !isIsoTimestamp(toText)) {
    return { ok: false, message: "from and to must be ISO-8601 times with a zone, for example 2026-11-23T14:00:00Z." };
  }
  const from = Date.parse(fromText);
  const to = Date.parse(toText);
  if (from >= to) return { ok: false, message: "from must be before to." };
  if (to - from > RANGE_CAP_MS[timeframe]) {
    return {
      ok: false,
      message: timeframe === "1m"
        ? "A 1m window is at most 26 hours. Use 5m or 15m for longer ranges."
        : "A 5m or 15m window is at most 7 days.",
    };
  }
  return { ok: true, query: { symbol, timeframe, from, to } };
}

// ---- bars ---------------------------------------------------------------------------------------------------------------

const CT_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });

/** Central Time wall clock for a UTC instant, `HH:MM` (e.g. `14:13`). Agents speak to the trader in CT. */
export function formatCt(ms: number): string {
  return CT_FORMAT.format(ms);
}

/**
 * Cleaned bars inside `[from, to)`, sorted by time, one per open time. Drops null or non-finite OHLC, bars whose range
 * does not hold their open and close (`low > min(open, close)` or `high < max(open, close)`), and bars outside the window.
 * A non-finite volume becomes 0.
 */
export function cleanBars(bars: readonly Candle[], from: number, to: number): Candle[] {
  const seen = new Map<number, Candle>();
  for (const bar of bars) {
    const { time, open, high, low, close } = bar;
    const volume = bar.volume;
    if (![time, open, high, low, close].every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    if (time < from || time >= to) continue;
    if (low > Math.min(open, close) || high < Math.max(open, close)) continue;
    if (!seen.has(time)) seen.set(time, { time, open, high, low, close, volume: typeof volume === "number" && Number.isFinite(volume) ? volume : 0 });
  }
  return [...seen.values()].sort((a, b) => a.time - b.time);
}

/** The response form of one bar. `time` is UTC ms; `ct` is the Central Time label. */
export function formatBar(bar: Candle) {
  return {
    time: bar.time,
    iso: new Date(bar.time).toISOString(),
    ct: formatCt(bar.time),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

/** Runs of consecutive missing expected bars, as gaps. Consecutive means one bar length apart in expected order. */
function gapRuns(missing: readonly number[], barMs: number): CandleGap[] {
  const gaps: Array<{ first: number; last: number; bars: number }> = [];
  for (const time of missing) {
    const run = gaps[gaps.length - 1];
    if (run && time - run.last === barMs) {
      run.last = time;
      run.bars += 1;
    } else {
      gaps.push({ first: time, last: time, bars: 1 });
    }
  }
  return gaps.map((gap) => ({ from: new Date(gap.first).toISOString(), to: new Date(gap.last).toISOString(), bars: gap.bars }));
}

// ---- cache --------------------------------------------------------------------------------------------------------------

export interface CandleCache {
  get(key: string): Candle[] | undefined;
  set(key: string, bars: Candle[], ttlMs: number): void;
  size(): number;
}

/** A bounded LRU with a TTL per entry. Oldest use is evicted first. Per instance and in memory only. */
export function createCandleCache(options: { maxEntries?: number; now?: () => number } = {}): CandleCache {
  const maxEntries = options.maxEntries ?? CACHE_MAX_ENTRIES;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, { bars: Candle[]; expiresAt: number }>();
  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      entries.delete(key);
      if (hit.expiresAt <= now()) return undefined;
      entries.set(key, hit);
      return hit.bars;
    },
    set(key, bars, ttlMs) {
      entries.delete(key);
      entries.set(key, { bars, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size() {
      return entries.size;
    },
  };
}

// ---- loading ------------------------------------------------------------------------------------------------------------

export type ArchiveCandleReader = (query: ArchiveQuery) => Promise<ArchiveResult | null>;

export interface CandleLoader {
  provider: MarketDataProvider;
  cache: CandleCache;
  /** Cache misses per limit key (the token id). */
  upstream: RateLimiter;
  now: () => number;
  /** Authoritative archive checked before hitting upstream Yahoo. Archive hits never consume upstream quota. */
  archive?: ArchiveCandleReader;
}

export function createCandleLoader(options: {
  provider: MarketDataProvider;
  cache?: CandleCache;
  upstream?: RateLimiter;
  now?: () => number;
  archive?: ArchiveCandleReader;
}): CandleLoader {
  const now = options.now ?? (() => Date.now());
  return {
    provider: options.provider,
    cache: options.cache ?? createCandleCache({ now }),
    upstream: options.upstream ?? createRateLimiter({ ...UPSTREAM_LIMIT, now }),
    now,
    archive: options.archive,
  };
}

let defaultLoader: CandleLoader | undefined;

/** The shared loader for the server: Supabase archive first, then Yahoo through the provider adapter. */
export function defaultCandleLoader(): CandleLoader {
  if (!defaultLoader) defaultLoader = createCandleLoader({ provider: new YahooFinanceProvider(), archive: readArchiveCandles });
  return defaultLoader;
}

const cachedProviders = new WeakMap<CandleLoader, Map<string, string>>();

function rememberProvider(loader: CandleLoader, key: string, providerName: string): void {
  let map = cachedProviders.get(loader);
  if (!map) {
    map = new Map();
    cachedProviders.set(loader, map);
  } else if (map.size >= CACHE_MAX_ENTRIES * 2) {
    map.clear();
  }
  map.set(key, providerName);
}

/**
 * Cleaned bars and coverage for one window. A future window is answered without asking the provider. Archive hits and
 * cache hits never take an upstream slot for `limitKey`; an upstream miss over the limit is `rate_limited`. A provider
 * failure is `unavailable`.
 */
export async function loadAgentCandles(loader: CandleLoader, query: CandleQuery, limitKey: string): Promise<CandleLoad> {
  const now = loader.now();
  const { symbol, timeframe, from, to } = query;
  const base = {
    symbol,
    ticker: loader.provider.resolveProviderSymbol(symbol),
    timeframe,
    from,
    to,
  };
  if (windowInFuture(from, now)) {
    return { ok: true, value: { ...base, provider: loader.provider.name, reason: "future", bars: [], coverage: { expected: 0, present: 0, gaps: [] } } };
  }

  // Coverage counts only bars that have closed by now, and only regular trading time (the same rule as the trade coverage).
  const barMs = TIMEFRAME_MINUTES[timeframe] * MINUTE_MS;
  const expected = expectedInsideBarTimes(from, Math.min(to, now), barMs, symbol);
  const key = `${symbol}|${timeframe}|${from}|${to}`;
  let bars = loader.cache.get(key);
  let providerName = cachedProviders.get(loader)?.get(key) ?? loader.provider.name;
  if (!bars) {
    let archiveBars: Candle[] = [];
    let archiveProvider: string | null = null;
    if (loader.archive) {
      const archive = await loader.archive({ symbol, timeframe, from: new Date(from), to: new Date(to), inclusiveTo: false });
      if (archive && archive.candles.length > 0) {
        archiveBars = cleanBars(archive.candles, from, to);
        if (archiveBars.length > 0) archiveProvider = archive.providerName;
      }
    }

    const retentionMs = timeframe === "1m" ? 30 * DAY_MS : 60 * DAY_MS;
    const firstBar = archiveBars[0]?.time ?? Infinity;
    const lastBar = archiveBars[archiveBars.length - 1]?.time ?? -Infinity;
    const needsHead = archiveBars.length === 0 || expected.some((t) => t < firstBar && now - t <= retentionMs);
    const needsTail = archiveBars.length === 0 || expected.some((t) => t > lastBar && now - t <= retentionMs);

    if (archiveBars.length > 0 && !needsHead && !needsTail) {
      bars = archiveBars;
      providerName = archiveProvider!;
    } else {
      const admitted = loader.upstream.take(limitKey);
      if (!admitted.ok) {
        return { ok: false, code: "rate_limited", message: "Too many upstream candle requests from this key. Wait and try again.", retryAfterSec: admitted.retryAfterSec };
      }
      const fetchFrom = archiveBars.length > 0 && !needsHead ? lastBar + barMs : from;
      const fetchTo = archiveBars.length > 0 && !needsTail ? firstBar : to;
      try {
        const yahooBars = cleanBars(
          await loader.provider.getCandles({ symbol, timeframe, from: new Date(fetchFrom), to: new Date(fetchTo) }),
          from,
          to,
        );
        bars = archiveBars.length > 0 ? cleanBars(mergeArchiveAndYahoo(archiveBars, yahooBars), from, to) : yahooBars;
        providerName = archiveBars.length > 0
          ? (yahooBars.length > 0 ? `${archiveProvider}+${loader.provider.name}` : archiveProvider!)
          : loader.provider.name;
      } catch {
        return { ok: false, code: "unavailable", message: "Market data is unavailable. Try again." };
      }
    }
    loader.cache.set(key, bars, to <= now ? CLOSED_TTL_MS : RECENT_TTL_MS);
    rememberProvider(loader, key, providerName);
  }

  const present = new Set(bars.map((bar) => bar.time));
  const missing = expected.filter((time) => !present.has(time));
  const reason = bars.length === 0 && expected.length === 0 ? "closed" as const : undefined;
  return {
    ok: true,
    value: {
      ...base,
      provider: providerName,
      ...(reason ? { reason } : {}),
      bars,
      coverage: { expected: expected.length, present: expected.length - missing.length, gaps: gapRuns(missing, barMs) },
    },
  };
}

/** The response body for a loaded window: bars with `ct` labels, `reason` when set, and the coverage. */
export function formatCandleSet(set: AgentCandleSet) {
  return {
    symbol: set.symbol,
    ticker: set.ticker,
    timeframe: set.timeframe,
    provider: set.provider,
    from: new Date(set.from).toISOString(),
    to: new Date(set.to).toISOString(),
    ...(set.reason ? { reason: set.reason } : {}),
    bars: set.bars.map(formatBar),
    coverage: set.coverage,
  };
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------------

export interface CandleRequestOptions {
  /** Tests inject fakes. `null` means the API is off. Omitted: the real clients from the environment. */
  deps?: AgentServerDeps | null;
  limiter?: RateLimiter;
  loader?: CandleLoader;
}

/** Per key, per instance (best effort). Separate from the guide's counter, as in lib/agent/handle.ts. */
const generalLimiter = createRateLimiter({ limit: 120, windowMs: MINUTE_MS });

function respond(response: AgentResponse): Response {
  return Response.json(response.body, {
    status: response.status,
    headers: { ...response.headers, "Cache-Control": "no-store" },
  });
}

/** Runs one GET /api/v1/candles request: off switch, auth (read scope), query, load, audit. */
export async function handleCandlesRequest(req: Request, options: CandleRequestOptions = {}): Promise<Response> {
  const deps = options.deps === undefined ? defaultAgentDeps() : options.deps;
  if (!deps || !agentEnabled(deps.env)) {
    return respond(agentError("unavailable", "The agent API is off on this deployment."));
  }
  const url = new URL(req.url);
  const path = url.pathname.slice(0, 300);
  try {
    const auth = await authenticateAgent(req, deps, options.limiter ?? generalLimiter);
    if (!auth.ok) {
      if (auth.identity) await recordAgentUse(deps, auth.identity, { method: "GET", path, status: auth.status, outcome: auth.code });
      return respond(auth);
    }
    const ctx = auth.ctx;
    const audit = (status: number, outcome: string) => recordAgentUse(deps, ctx, { method: "GET", path, status, outcome });

    const parsed = parseCandleQuery(url.searchParams);
    if (!parsed.ok) {
      await audit(422, "invalid");
      return respond(agentError("invalid", parsed.message));
    }
    const loaded = await loadAgentCandles(options.loader ?? defaultCandleLoader(), parsed.query, ctx.tokenId);
    if (!loaded.ok) {
      await audit(statusFor(loaded.code), loaded.code);
      return respond(agentError(loaded.code, loaded.message, loaded.retryAfterSec ? { "Retry-After": String(loaded.retryAfterSec) } : {}));
    }
    await audit(200, "ok");
    return respond(agentOk(formatCandleSet(loaded.value)));
  } catch {
    // Nothing about the failure leaves the server: no message, stack or cause.
    return respond(agentError("unknown", "Something went wrong. Try again."));
  }
}
