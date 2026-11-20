// Candles per trade, on the device. Completed candle sets never change, so they are cached in
// IndexedDB and old trades open instantly and offline (docs/08 §2). Lists never touch this module (B-42).
//
// Samples render from offline fixture bars (fixtures/sample-bars.json, issue #89). Real trades fetch
// Yahoo market candles and cache in IndexedDB. A missing fixture set or missing Yahoo response leaves
// the trade details usable but renders no chart (docs/08 §4, issues #28, #89).
import { useSyncExternalStore } from "react";
import { idbGet, idbSet } from "./idb.ts";
import { sessionCloseUtc } from "./session.ts";
import { candleCacheKey, candleSignature, getTrade, updateTrade } from "./store.ts";
import { TIMEFRAMES, TIMEFRAME_MINUTES, buildSparkline } from "./trades.ts";
import type { Candle, CandleSource, Timeframe, TradeRecord } from "./trades.ts";
import { anchorsTradeWindow, coversTradeWindow } from "./market-data/coverage.ts";

export interface CandleEntry {
  status: "loading" | "ready" | "none";
  candles: Candle[];
  source: CandleSource | null;
  /** Finest timeframe these candles support. Coarser than 1m when Yahoo no longer serves 1m (B-11). */
  baseTimeframe: Timeframe;
  /** A request for real candles is in flight. */
  fetching: boolean;
  signature: string;
  /** When the last load for this signature started (ms). Drives `nextCandleRetryAt` (R-02). */
  lastAttemptAt: number;
}

export interface StoredCandles {
  signature: string;
  candles: Candle[];
  source: CandleSource;
  baseTimeframe: Timeframe;
  fetchedAt: number;
}

interface CandleResponse {
  candles?: Candle[];
  baseTimeframe?: Timeframe;
  /** True when the payload anchors the trade but skips bars inside the hold (AC-07). */
  partial?: boolean;
}

export interface CandleLoadDependencies {
  read(key: string): Promise<StoredCandles | undefined>;
  write(key: string, value: StoredCandles): Promise<unknown>;
  request(trade: TradeRecord): Promise<CandleResponse>;
  now(): number;
  /** Prevent an older in-flight request from replacing candles after the trade signature changes. */
  isCurrent?(): boolean;
  /** Records that this runtime already attempted the coverage refresh, avoiding retry loops on partial responses. */
  onCoverageRefetch?(): void;
  /** Ask the network even when the matching cache looks final for now: a due R-02 retry or refresh. */
  refresh?: boolean;
}

type RawBar = [number, number, number, number, number];

export interface SampleBarsPayload {
  source?: string;
  fields?: string[];
  /** Shared Globex-week 1m series per canonical symbol, used by every sample of that contract. */
  shared?: Record<string, RawBar[]>;
  tradeSymbols?: Record<string, string>;
  /** Legacy per-trade bars; used only when a trade has no shared series. */
  bars?: Record<string, RawBar[]>;
}

// The fixture is ~640 KB of shared Globex-week bars. It loads on demand as its own chunk instead
// of weighing down the trade-detail bundle, and only for sample trades (issue #89, review fix).
let sampleBarsPromise: Promise<SampleBarsPayload> | null = null;

export function loadSampleBarsPayload(): Promise<SampleBarsPayload> {
  sampleBarsPromise ??= import("../fixtures/sample-bars.json", { with: { type: "json" } }).then(
    (module) => module.default as unknown as SampleBarsPayload,
  );
  return sampleBarsPromise;
}

function asCandles(rawBars: RawBar[] | undefined): Candle[] | null {
  if (!Array.isArray(rawBars) || rawBars.length === 0) return null;
  return rawBars.map(([time, open, high, low, close]) => ({
    time,
    open,
    high,
    low,
    close,
    volume: 1,
  }));
}

export function getSampleCandles(tradeId: string, payload: SampleBarsPayload): Candle[] | null {
  const symbol = payload.tradeSymbols?.[tradeId];
  return asCandles(symbol ? payload.shared?.[symbol] : undefined)
    ?? asCandles(payload.bars?.[tradeId]);
}

const entries = new Map<string, CandleEntry>();
const coverageAttempts = new Map<string, string>();
const listeners = new Set<() => void>();

function put(id: string, entry: CandleEntry) {
  entries.set(id, entry);
  listeners.forEach((listener) => listener());
}

function adopt(trade: TradeRecord, stored: StoredCandles, servedFromCache = false) {
  const live = getTrade(trade.id) ?? trade;
  const patch: Partial<TradeRecord> = { candle_source: stored.source };
  patch.sparkline = buildSparkline({ ...live, ...patch }, stored.candles);
  updateTrade(trade.id, patch);
  // A set served from the device cache dates from when it was fetched, so a same-day trade opened
  // cold refreshes on the next check instead of showing old bars for another 5 minutes (R-02).
  const lastAttemptAt = servedFromCache ? stored.fetchedAt : entries.get(trade.id)?.lastAttemptAt ?? Date.now();
  put(trade.id, { status: "ready", candles: stored.candles, source: stored.source, baseTimeframe: stored.baseTimeframe, fetching: false, signature: stored.signature, lastAttemptAt });
}

async function loadSampleCandles(trade: TradeRecord, signature: string) {
  put(trade.id, { status: "loading", candles: [], source: null, baseTimeframe: "1m", fetching: false, signature, lastAttemptAt: Date.now() });
  const payload = await loadSampleBarsPayload();
  // A newer signature (edited trade, re-entry) wins over this in-flight load.
  if (entries.get(trade.id)?.signature !== signature) return;
  const candles = getSampleCandles(trade.id, payload);
  if (candles) {
    adopt(trade, {
      signature,
      candles,
      source: "Demo fixture",
      baseTimeframe: "1m",
      fetchedAt: Date.now(),
    });
  } else {
    put(trade.id, {
      status: "none",
      candles: [],
      source: null,
      baseTimeframe: "1m",
      fetching: false,
      signature,
      lastAttemptAt: entries.get(trade.id)?.lastAttemptAt ?? Date.now(),
    });
  }
}

/** True only after the hindsight window has closed and the cached bars do not reach that close. */
export function cachedCandlesNeedRefetch(trade: Pick<TradeRecord, "exit_time">, stored: StoredCandles, now: number) {
  // An open trade has no hindsight window: it refreshes on the R-02 five-minute rule instead (R-03c).
  if (trade.exit_time == null) return false;
  const windowClose = sessionCloseUtc(trade.exit_time);
  if (now <= windowClose) return false;
  const lastBar = stored.candles.reduce((latest, bar) => Math.max(latest, bar.time), 0);
  const barMs = TIMEFRAME_MINUTES[stored.baseTimeframe] * 60_000;
  return lastBar + barMs < windowClose;
}

const MINUTE_MS = 60_000;
/** An exit this recent may simply not be published by Yahoo yet (R-02). */
export const FRESH_EXIT_MS = 60 * MINUTE_MS;

/** True while Yahoo may still be catching up to this exit: under 60 minutes ago. */
export function exitIsFresh(trade: Pick<TradeRecord, "exit_time">, now: number) {
  // An open trade has no exit yet (R-03a); its live candles arrive with R-03c.
  if (trade.exit_time == null) return false;
  return now - Date.parse(trade.exit_time) < FRESH_EXIT_MS;
}

/** When a trade's candles should be requested again, or null for never. Pure, for tests. (R-02, docs/16) */
export function nextCandleRetryAt(
  trade: Pick<TradeRecord, "exit_time"> & Partial<Pick<TradeRecord, "entry_time">>,
  entry: Pick<CandleEntry, "status" | "candles" | "baseTimeframe">,
  lastAttemptAt: number,
  now: number,
): number | null {
  // An open trade is never final (R-03c): refresh every five minutes once loaded, and retry a
  // missing set each minute for the first hour after entry (Yahoo publishes late), then every 15.
  if (trade.exit_time == null) {
    if (entry.status === "ready") return lastAttemptAt + 5 * MINUTE_MS;
    if (entry.status !== "none") return null;
    const entryFresh = trade.entry_time != null && now - Date.parse(trade.entry_time) < FRESH_EXIT_MS;
    return lastAttemptAt + (entryFresh ? MINUTE_MS : 15 * MINUTE_MS);
  }
  const sessionClosed = now > sessionCloseUtc(trade.exit_time);
  const reachesClose = !cachedCandlesNeedRefetch(trade, {
    signature: "",
    candles: entry.candles,
    source: "Yahoo Finance",
    baseTimeframe: entry.baseTimeframe,
    fetchedAt: 0,
  }, now);
  // Finished candle sets never change.
  if (entry.status === "ready" && sessionClosed && reachesClose) return null;
  // Yahoo publishes the newest bars late: retry each minute while it catches up, then back off.
  if (entry.status === "none") return lastAttemptAt + (exitIsFresh(trade, now) ? MINUTE_MS : 15 * MINUTE_MS);
  // Pull in the after-exit bars while the session is still running.
  if (entry.status === "ready" && !sessionClosed) return lastAttemptAt + 5 * MINUTE_MS;
  // Otherwise the existing once-per-load after-close refetch in `ensureCandles` applies (#86).
  return null;
}

/** Resolve the one candle cache. Dependencies are injectable so coverage/refetch behavior is deterministic in tests. */
export async function loadCachedCandles(
  trade: TradeRecord,
  signature: string,
  dependencies: CandleLoadDependencies,
): Promise<StoredCandles | null> {
  const key = candleCacheKey(trade);
  const cached = await dependencies.read(key);
  if (dependencies.isCurrent?.() === false) return null;
  const entryMs = Date.parse(trade.entry_time);
  // An open trade (R-03c) is anchored by its entry bar alone, and its cache is never final.
  const exitMs = trade.exit_time == null ? null : Date.parse(trade.exit_time);
  const covers = (candles: Candle[], timeframe: Timeframe | undefined): timeframe is Timeframe =>
    Boolean(exitMs != null && timeframe && TIMEFRAMES.includes(timeframe) && coversTradeWindow(candles, entryMs, exitMs, timeframe, trade.symbol));
  // A payload anchors the trade when the entry and exit bars are present (AC-07): gaps inside
  // the hold are drawn and counted on screen, never a reason to drop the whole chart (#90 follow-up).
  const anchored = (candles: Candle[], timeframe: Timeframe | undefined): timeframe is Timeframe =>
    Boolean(timeframe && TIMEFRAMES.includes(timeframe) && anchorsTradeWindow(candles, entryMs, exitMs, timeframe, trade.symbol));
  // Keep a signature-matching cache as a fallback, adopt it straight away when it fully covers
  // the trade window (#90), and only skip the network when it also needs no post-exit refetch (#86).
  const matching = cached?.signature === signature ? cached : undefined;
  const usableCache = matching && anchored(matching.candles, matching.baseTimeframe) ? matching : undefined;
  if (!dependencies.refresh && usableCache && covers(usableCache.candles, usableCache.baseTimeframe) && !cachedCandlesNeedRefetch(trade, usableCache, dependencies.now())) return usableCache;
  if (matching) dependencies.onCoverageRefetch?.();

  try {
    const body = await dependencies.request(trade);
    const baseTimeframe = body.baseTimeframe;
    if (!Array.isArray(body.candles) || !anchored(body.candles, baseTimeframe)) throw new Error("incomplete");
    if (dependencies.isCurrent?.() === false) return null;
    // Never replace more data with less (R-02): a shorter answer keeps the cache.
    if (usableCache && body.candles.length < usableCache.candles.length) return usableCache;
    const stored: StoredCandles = {
      signature,
      candles: body.candles,
      source: "Yahoo Finance",
      baseTimeframe,
      fetchedAt: dependencies.now(),
    };
    await dependencies.write(key, stored);
    return stored;
  } catch {
    if (usableCache) return usableCache;
    throw new Error("unavailable");
  }
}

async function load(trade: TradeRecord, signature: string, refresh: boolean) {
  if (trade.is_sample) return; // Safeguard: samples never fetch from the network (issue #89)
  let askedNetwork = false;
  try {
    const stored = await loadCachedCandles(trade, signature, {
      read: (key) => idbGet<StoredCandles>(key),
      write: (key, value) => idbSet(key, value),
      request: async (requestedTrade) => {
        askedNetwork = true;
        // No exit for an open trade: the route fetches from before the entry to now (R-03c).
        const params = new URLSearchParams({ symbol: requestedTrade.symbol, entry: requestedTrade.entry_time });
        if (requestedTrade.exit_time != null) params.set("exit", requestedTrade.exit_time);
        const response = await fetch(`/api/market-data?${params}`);
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<CandleResponse>;
      },
      now: Date.now,
      isCurrent: () => entries.get(trade.id)?.signature === signature,
      onCoverageRefetch: () => coverageAttempts.set(trade.id, signature),
      refresh,
    });
    if (stored) adopt(trade, stored, !askedNetwork);
  } catch {
    const current = entries.get(trade.id);
    if (!current || current.signature !== signature) return;
    put(trade.id, current.status === "ready" ? { ...current, fetching: false } : { ...current, status: "none", fetching: false });
  }
}

/**
 * Make sure candles for this trade are loaded or loading. `force` retries a failed fetch. Calling it
 * again is cheap: it starts a new request only when none is in flight and one is due (R-02).
 */
export function ensureCandles(trade: TradeRecord, force = false) {
  const signature = candleSignature(trade);
  const existing = entries.get(trade.id);
  if (trade.is_sample) {
    if (existing && existing.signature === signature && !force) return;
    return loadSampleCandles(trade, signature);
  }

  if (typeof window === "undefined") return;
  const coverageRefresh = existing?.signature === signature && existing.status === "ready" && existing.source === "Yahoo Finance"
    && cachedCandlesNeedRefetch(trade, {
      signature,
      candles: existing.candles,
      source: existing.source,
      baseTimeframe: existing.baseTimeframe,
      fetchedAt: 0,
    }, Date.now())
    && coverageAttempts.get(trade.id) !== signature;
  const forcedRetry = Boolean(force && existing && !existing.fetching);
  const now = Date.now();
  const retryAt = existing?.signature === signature && !existing.fetching
    ? nextCandleRetryAt(trade, existing, existing.lastAttemptAt, now)
    : null;
  const retryDue = retryAt !== null && retryAt <= now;
  if (existing && existing.signature === signature && !coverageRefresh && !forcedRetry && !retryDue) return;
  if (coverageRefresh) coverageAttempts.set(trade.id, signature);
  // A ready chart stays on screen while it refreshes. A scheduled retry of a missing set stays "none",
  // so the screen does not flash a skeleton every minute; only the Retry button shows a fetch is on.
  const keepShowing = existing?.signature === signature
    && (existing.status === "ready" || (existing.status === "none" && !forcedRetry));
  put(trade.id, keepShowing && existing
    ? { ...existing, fetching: true, lastAttemptAt: now }
    : { status: "loading", candles: [], source: null, baseTimeframe: "1m", fetching: true, signature, lastAttemptAt: now });
  void load(trade, signature, forcedRetry || retryDue);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useCandles(tradeId: string | undefined) {
  return useSyncExternalStore(subscribe, () => (tradeId ? entries.get(tradeId) : undefined), () => undefined);
}

export function getCandleEntry(tradeId: string | undefined): CandleEntry | undefined {
  return tradeId ? entries.get(tradeId) : undefined;
}

export function resetCandlesForTest() {
  entries.clear();
}

// ── Day bars for the entry form (docs/20 §2.2) ─────────────────────────────────────────────────
// The form finds the fill from the typed prices, before any trade exists. It asks the same route for
// one window (`from`/`to`), caches the answer in IndexedDB like a trade's candles, and follows the
// R-02 rule: a window that ended over an hour ago is final; a fresher one is asked again after a minute.

export interface DayCandles {
  candles: Candle[];
  baseTimeframe: Timeframe;
  fetchedAt: number;
}

/** Cache key for one symbol and window. */
export function dayCandleKey(symbol: string, fromMs: number, toMs: number) {
  return `day:${symbol.toUpperCase()}:${fromMs}:${toMs}`;
}

/** Whether a cached day window can be used without asking the network again. Pure, for tests. */
export function dayCandlesUsable(stored: DayCandles | undefined, windowEndMs: number, now: number) {
  if (!stored || !Array.isArray(stored.candles) || !stored.candles.length) return false;
  // Final once the window ended long enough ago for Yahoo to publish every bar (R-02).
  if (stored.fetchedAt - windowEndMs >= FRESH_EXIT_MS) return true;
  return now - stored.fetchedAt < MINUTE_MS;
}

export interface DayCandleDependencies {
  read(key: string): Promise<DayCandles | undefined>;
  write(key: string, value: DayCandles): Promise<unknown>;
  request(symbol: string, fromMs: number, toMs: number): Promise<{ candles?: Candle[]; baseTimeframe?: Timeframe }>;
  now(): number;
}

/** Bars for one window: the cache when it is usable, else the network, else a stale cache, else an error. */
export async function loadDayCandles(symbol: string, fromMs: number, toMs: number, dependencies?: DayCandleDependencies): Promise<DayCandles> {
  const deps: DayCandleDependencies = dependencies ?? {
    read: (key) => idbGet<DayCandles>(key),
    write: (key, value) => idbSet(key, value),
    request: async (requestSymbol, from, to) => {
      const params = new URLSearchParams({ symbol: requestSymbol, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      const response = await fetch(`/api/market-data?${params}`);
      if (!response.ok) throw new Error(response.status === 404 ? "no-bars" : "unavailable");
      return response.json();
    },
    now: Date.now,
  };
  const key = dayCandleKey(symbol, fromMs, toMs);
  const cached = await deps.read(key).catch(() => undefined);
  if (dayCandlesUsable(cached, toMs, deps.now())) return cached!;
  try {
    const body = await deps.request(symbol, fromMs, toMs);
    if (!Array.isArray(body.candles) || !body.candles.length || !body.baseTimeframe || !TIMEFRAMES.includes(body.baseTimeframe)) throw new Error("no-bars");
    // Never replace more data with less (R-02).
    if (cached && cached.candles.length > body.candles.length) return cached;
    const stored: DayCandles = { candles: body.candles, baseTimeframe: body.baseTimeframe, fetchedAt: deps.now() };
    await deps.write(key, stored).catch(() => undefined);
    return stored;
  } catch (error) {
    if (cached?.candles?.length) return cached;
    throw error instanceof Error ? error : new Error("unavailable");
  }
}
