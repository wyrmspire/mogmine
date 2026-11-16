// Candles per trade, on the device. Completed candle sets never change, so they are cached in
// IndexedDB and old trades open instantly and offline (docs/08 §2). Lists never touch this module (B-42).
//
// Samples render from offline fixture bars (fixtures/sample-bars.json, issue #89). Real trades fetch
// Yahoo market candles and cache in IndexedDB. A missing fixture set or missing Yahoo response leaves
// the trade details usable but renders no chart (docs/08 §4, issues #28, #89).
import { useSyncExternalStore } from "react";
import sampleBarsData from "../fixtures/sample-bars.json" with { type: "json" };
import { idbGet, idbSet } from "./idb.ts";
import { sessionCloseUtc } from "./session.ts";
import { candleCacheKey, candleSignature, getTrade, updateTrade } from "./store.ts";
import { TIMEFRAMES, TIMEFRAME_MINUTES, buildSparkline } from "./trades.ts";
import type { Candle, CandleSource, Timeframe, TradeRecord } from "./trades.ts";
import { coversTradeWindow } from "./market-data/coverage.ts";

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

interface SampleBarsPayload {
  source?: string;
  fields?: string[];
  bars: Record<string, number[][]>;
}

const sampleBarsFixture = sampleBarsData as unknown as SampleBarsPayload;

export function getSampleCandles(tradeId: string): Candle[] | null {
  const rawBars = sampleBarsFixture.bars?.[tradeId];
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

function loadSampleCandles(trade: TradeRecord, signature: string) {
  const candles = getSampleCandles(trade.id);
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
  // Keep a signature-matching cache as a fallback, but only adopt it as complete when it
  // covers the trade window (#90) and does not still need a post-exit refetch (#86).
  const matching = cached?.signature === signature ? cached : undefined;
  const usableCache = matching && covers(matching.candles, matching.baseTimeframe) ? matching : undefined;
  if (usableCache && !cachedCandlesNeedRefetch(trade, usableCache, dependencies.now())) return usableCache;
  if (matching) dependencies.onCoverageRefetch?.();

  try {
    const body = await dependencies.request(trade);
    const baseTimeframe = body.baseTimeframe;
    if (!Array.isArray(body.candles) || !covers(body.candles, baseTimeframe)) throw new Error("incomplete");
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
    loadSampleCandles(trade, signature);
    return;
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
