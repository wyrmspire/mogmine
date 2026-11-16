// Candles per trade, on the device. Completed candle sets never change, so they are cached in
// IndexedDB and old trades open instantly and offline (docs/08 §2). Lists never touch this module (B-42).
//
// Samples render from offline fixture bars (fixtures/sample-bars.json, issue #89). Real trades fetch
// Yahoo market candles and cache in IndexedDB. A missing fixture set or missing Yahoo response leaves
// the trade details usable but renders no chart (docs/08 §4, issues #28, #89).
import { useSyncExternalStore } from "react";
import sampleBarsData from "../fixtures/sample-bars.json" with { type: "json" };
import { idbGet, idbSet } from "./idb.ts";
import { candleCacheKey, candleSignature, getTrade, updateTrade } from "./store.ts";
import { buildSparkline } from "./trades.ts";
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

interface StoredCandles {
  signature: string;
  candles: Candle[];
  source: CandleSource;
  baseTimeframe: Timeframe;
  fetchedAt: number;
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

async function load(trade: TradeRecord, signature: string) {
  if (trade.is_sample) return; // Safeguard: samples never fetch from the network (issue #89)
  const key = candleCacheKey(trade);
  const cached = await idbGet<StoredCandles>(key);
  if (entries.get(trade.id)?.signature !== signature) return; // the trade changed while we waited
  if (cached?.signature === signature && cached.candles.length >= 4) return adopt(trade, cached);

  try {
    const params = new URLSearchParams({ symbol: trade.symbol, entry: trade.entry_time, exit: trade.exit_time });
    const response = await fetch(`/api/market-data?${params}`);
    if (!response.ok) throw new Error("unavailable");
    const body = await response.json() as { candles?: Candle[]; baseTimeframe?: Timeframe };
    if (!Array.isArray(body.candles) || body.candles.length < 4) throw new Error("incomplete");
    if (entries.get(trade.id)?.signature !== signature) return;
    const stored: StoredCandles = { signature, candles: body.candles, source: "Yahoo Finance", baseTimeframe: body.baseTimeframe ?? "1m", fetchedAt: Date.now() };
    void idbSet(key, stored);
    adopt(trade, stored);
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
  if (existing && existing.signature === signature && !force) return;

  if (trade.is_sample) {
    loadSampleCandles(trade, signature);
    return;
  }

  if (typeof window === "undefined") return;
  if (existing && existing.signature === signature && !(force && !existing.fetching && existing.source !== "Yahoo Finance")) return;
  put(trade.id, { status: "loading", candles: [], source: null, baseTimeframe: "1m", fetching: true, signature });
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
