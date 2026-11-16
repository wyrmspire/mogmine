// Candles per trade, on the device. Completed candle sets never change, so they are cached in
// IndexedDB and old trades open instantly and offline (docs/08 §2). Lists never touch this module (B-42).
//
// Samples and real trades follow the same rule: only market candles can produce a chart. A missing
// Yahoo response leaves the trade details usable but renders no chart (docs/08 §4, issue #28).
import { useSyncExternalStore } from "react";
import { idbGet, idbSet } from "./idb.ts";
import { sessionCloseUtc } from "./session.ts";
import { candleCacheKey, candleSignature, getTrade, updateTrade } from "./store.ts";
import { buildSparkline } from "./trades.ts";
import { TIMEFRAME_MINUTES } from "./trades.ts";
import type { Candle, CandleSource, Timeframe, TradeRecord } from "./trades.ts";

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
  const usableCache = cached?.signature === signature && cached.candles.length >= 4 ? cached : undefined;
  if (usableCache && !cachedCandlesNeedRefetch(trade, usableCache, dependencies.now())) return usableCache;
  if (usableCache) dependencies.onCoverageRefetch?.();

  try {
    const body = await dependencies.request(trade);
    if (!Array.isArray(body.candles) || body.candles.length < 4) throw new Error("incomplete");
    if (dependencies.isCurrent?.() === false) return null;
    const stored: StoredCandles = {
      signature,
      candles: body.candles,
      source: "Yahoo Finance",
      baseTimeframe: body.baseTimeframe ?? "1m",
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
  if (typeof window === "undefined") return;
  const signature = candleSignature(trade);
  const existing = entries.get(trade.id);
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
