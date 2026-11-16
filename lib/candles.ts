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

function adopt(trade: TradeRecord, stored: StoredCandles) {
  const live = getTrade(trade.id) ?? trade;
  const patch: Partial<TradeRecord> = { candle_source: stored.source };
  patch.sparkline = buildSparkline({ ...live, ...patch }, stored.candles);
  updateTrade(trade.id, patch);
  put(trade.id, { status: "ready", candles: stored.candles, source: stored.source, baseTimeframe: stored.baseTimeframe, fetching: false, signature: stored.signature });
}

async function loadSampleCandles(trade: TradeRecord, signature: string) {
  put(trade.id, { status: "loading", candles: [], source: null, baseTimeframe: "1m", fetching: false, signature });
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
    });
  }
}

/** True only after the hindsight window has closed and the cached bars do not reach that close. */
export function cachedCandlesNeedRefetch(trade: Pick<TradeRecord, "exit_time">, stored: StoredCandles, now: number) {
  const windowClose = sessionCloseUtc(trade.exit_time);
  if (now <= windowClose) return false;
  const lastBar = stored.candles.reduce((latest, bar) => Math.max(latest, bar.time), 0);
  const barMs = TIMEFRAME_MINUTES[stored.baseTimeframe] * 60_000;
  return lastBar + barMs < windowClose;
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
  const exitMs = Date.parse(trade.exit_time);
  const covers = (candles: Candle[], timeframe: Timeframe | undefined): timeframe is Timeframe =>
    Boolean(timeframe && TIMEFRAMES.includes(timeframe) && coversTradeWindow(candles, entryMs, exitMs, timeframe, trade.symbol));
  // A payload anchors the trade when the entry and exit bars are present (AC-07): gaps inside
  // the hold are drawn and counted on screen, never a reason to drop the whole chart (#90 follow-up).
  const anchored = (candles: Candle[], timeframe: Timeframe | undefined): timeframe is Timeframe =>
    Boolean(timeframe && TIMEFRAMES.includes(timeframe) && anchorsTradeWindow(candles, entryMs, exitMs, timeframe, trade.symbol));
  // Keep a signature-matching cache as a fallback, adopt it straight away when it fully covers
  // the trade window (#90), and only skip the network when it also needs no post-exit refetch (#86).
  const matching = cached?.signature === signature ? cached : undefined;
  const usableCache = matching && anchored(matching.candles, matching.baseTimeframe) ? matching : undefined;
  if (usableCache && covers(usableCache.candles, usableCache.baseTimeframe) && !cachedCandlesNeedRefetch(trade, usableCache, dependencies.now())) return usableCache;
  if (matching) dependencies.onCoverageRefetch?.();

  try {
    const body = await dependencies.request(trade);
    const baseTimeframe = body.baseTimeframe;
    if (!Array.isArray(body.candles) || !anchored(body.candles, baseTimeframe)) throw new Error("incomplete");
    if (dependencies.isCurrent?.() === false) return null;
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

async function load(trade: TradeRecord, signature: string) {
  if (trade.is_sample) return; // Safeguard: samples never fetch from the network (issue #89)
  try {
    const stored = await loadCachedCandles(trade, signature, {
      read: (key) => idbGet<StoredCandles>(key),
      write: (key, value) => idbSet(key, value),
      request: async (requestedTrade) => {
        const params = new URLSearchParams({ symbol: requestedTrade.symbol, entry: requestedTrade.entry_time, exit: requestedTrade.exit_time });
        const response = await fetch(`/api/market-data?${params}`);
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<CandleResponse>;
      },
      now: Date.now,
      isCurrent: () => entries.get(trade.id)?.signature === signature,
      onCoverageRefetch: () => coverageAttempts.set(trade.id, signature),
    });
    if (stored) adopt(trade, stored);
  } catch {
    const current = entries.get(trade.id);
    if (!current || current.signature !== signature) return;
    put(trade.id, current.status === "ready" ? { ...current, fetching: false } : { ...current, status: "none", fetching: false });
  }
}

/** Make sure candles for this trade are loaded or loading. `force` retries a failed fetch. */
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
  if (existing && existing.signature === signature && !coverageRefresh && !forcedRetry) return;
  if (coverageRefresh) coverageAttempts.set(trade.id, signature);
  put(trade.id, existing?.signature === signature && existing.status === "ready"
    ? { ...existing, fetching: true }
    : { status: "loading", candles: [], source: null, baseTimeframe: "1m", fetching: true, signature });
  void load(trade, signature);
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
